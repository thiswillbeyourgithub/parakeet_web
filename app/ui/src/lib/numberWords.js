// Spelled-out numbers to digits (inverse text normalization) for English and
// French, behind the "Numbers as digits" setting.
//
// Why it exists: the model transcribes what it hears, so a dictated dose,
// dosage, date or measurement comes back as "vingt-cinq milligrammes" rather
// than "25 mg". Reading a number back out of words is exactly the kind of work
// the reader should not have to do, so the app rewrites cardinal numbers into
// digits before it shows the transcript.
//
// It is deliberately conservative. Two rules keep it from making the text
// worse:
//   1. A run of number words only converts if it forms ONE grammatical number.
//      "two two" stays "2 2" rather than becoming 4, and a word that cannot
//      legally continue the number in progress ends the run instead of being
//      folded into it.
//   2. Words that are numbers only some of the time are never converted alone:
//      English "one" ("one of them") and French "un"/"une" (the article) only
//      become digits as part of a larger number, e.g. "twenty-one", "cent un".
//
// Ordinals ("first", "premier") are out of scope: only cardinals convert.
//
// The one thing it does NOT try to be clever about is years: "nineteen
// eighty-four" is two numbers that cannot combine, so it converts as "19 84".
// That is inherent to reading digits out of words without understanding the
// sentence, and it is why the setting has an off switch.
//
// Both entry points share one core (`findNumberSpans`) so the plain-text path
// and the word-timestamp path can never disagree about what is a number.
//
// Written with the help of Claude Code.

// --- Vocabularies ------------------------------------------------------------
// `units` covers 0-19 (English teens are single words; the French 17-19 are
// hyphenated compounds handled by the "unit may follow a bare 10" rule below).
// `tens` covers 20-90. `scales` are multipliers. `joiner` is the connective
// allowed INSIDE a number ("one hundred and five", "vingt et un").

const EN = {
  units: {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19,
  },
  tens: { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
  scales: { hundred: 100, hundreds: 100, thousand: 1000, thousands: 1000, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9 },
  joiners: new Set(['and']),
  // Decimal separator, spoken. Only ever recognised BETWEEN two numbers, which
  // is what keeps the ordinary noun ("the point is") out of it.
  decimals: new Set(['point']),
  // Never a number on its own: "one of them".
  ambiguousAlone: new Set(['one']),
  // French-only compound rules stay off.
  compound: false,
};

const FR = {
  units: {
    zero: 0, 'zéro': 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
    six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
    treize: 13, quatorze: 14, quinze: 15, seize: 16,
  },
  tens: { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 },
  scales: {
    cent: 100, cents: 100, mille: 1000, milles: 1000, mil: 1000,
    million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9,
  },
  joiners: new Set(['et']),
  decimals: new Set(['virgule']),
  ambiguousAlone: new Set(['un', 'une']),
  // Enables "quatre-vingt" (4 + 20 = 80), "soixante-dix" (60 + 10 = 70) and
  // "dix-sept" (10 + 7 = 17), which French builds by juxtaposition.
  compound: true,
};

const VOCABS = { en: EN, fr: FR };

// A token's role in a number, or null when it is not a number word at all.
function classify(word, vocab) {
  if (Object.prototype.hasOwnProperty.call(vocab.units, word)) {
    const value = vocab.units[word];
    return { kind: value < 10 ? 'unit' : 'teen', value };
  }
  if (Object.prototype.hasOwnProperty.call(vocab.tens, word)) {
    return { kind: 'ten', value: vocab.tens[word] };
  }
  if (Object.prototype.hasOwnProperty.call(vocab.scales, word)) {
    const value = vocab.scales[word];
    return { kind: value === 100 ? 'hundred' : 'bigscale', value };
  }
  if (vocab.joiners.has(word)) return { kind: 'joiner', value: 0 };
  if (vocab.decimals.has(word)) return { kind: 'decimal', value: 0 };
  return null;
}

// Split a token on hyphens: "twenty-three" and "quatre-vingt-dix" arrive as one
// token but are several number words. A token only counts as numeric when EVERY
// piece is one (so "well-known" and "T-shirt" are left alone).
function pieces(word, vocab) {
  const parts = word.split(/[-‑–]/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const part of parts) {
    const c = classify(part, vocab);
    if (!c) return null;
    out.push({ ...c, word: part });
  }
  return out;
}

// Running number under construction. Kept as an object so the accept/apply pair
// below reads as one state machine rather than a pile of loose variables.
function newAcc() {
  return {
    total: 0,        // parts already multiplied by a scale >= 1000
    current: 0,      // the part below 1000 still being built
    last: null,      // kind of the previous piece
    lastTen: 0,      // value of the last `ten` piece (French 60/80 rules)
    unitAfterTen: false,
    lastBigScale: Infinity,
    seen: 0,         // number of numeric pieces consumed
    words: [],       // the pieces consumed, for the ambiguity guard
    // Decimals. `fraction` is null until a decimal marker is seen, then holds
    // the digits after it. The part after the separator is read out digit
    // group by digit group rather than as one number ("deux virgule zéro cinq"
    // is 2.05, not 2 and 5), so each group that cannot continue the previous
    // one is simply appended instead of ending the number.
    fraction: null,
    frac: null,      // sub-accumulator for the group being read
  };
}

// Digits of the fraction so far, including the group still under construction.
function fractionDigits(acc) {
  if (acc.fraction === null) return '';
  return acc.fraction + (acc.frac && acc.frac.seen ? String(accValue(acc.frac)) : '');
}

// Can this piece continue the number in progress? Returning false ends the run
// (the piece then starts a new one), which is what keeps "two two" as "2 2".
function accepts(acc, piece, vocab) {
  const { kind, value } = piece;
  const { last } = acc;

  // Past the decimal separator every numeric word belongs to the fraction: a
  // group that cannot continue the previous one starts a new one instead of
  // ending the number. Only a second separator is refused.
  if (acc.fraction !== null) {
    if (kind === 'decimal') return false;
    if (kind === 'joiner') return acc.frac ? accepts(acc.frac, piece, vocab) : false;
    return true;
  }

  switch (kind) {
    case 'unit':
      if (last === null || last === 'hundred' || last === 'bigscale' || last === 'joiner') return true;
      // "twenty-three", but not "twenty-three-four".
      if (last === 'ten' && !acc.unitAfterTen) return true;
      // French builds 17-19 and 77/97 on a bare ten: "dix-sept", "quatre-vingt-dix-neuf".
      if (vocab.compound && last === 'teen' && acc.lastTeenWasBare10) return true;
      return false;
    case 'teen':
      if (last === null || last === 'hundred' || last === 'bigscale') return true;
      if (last === 'joiner' && (acc.beforeJoiner === 'hundred' || acc.beforeJoiner === 'bigscale')) return true;
      // "soixante-onze" (71), "quatre-vingt-dix" (90); also via "soixante et onze".
      if (vocab.compound && (last === 'ten' || last === 'joiner') && (acc.lastTen === 60 || acc.lastTen === 80)) return true;
      return false;
    case 'ten':
      if (last === null || last === 'hundred' || last === 'bigscale') return true;
      if (last === 'joiner' && (acc.beforeJoiner === 'hundred' || acc.beforeJoiner === 'bigscale')) return true;
      // "quatre-vingt": the only unit x ten product French spells this way.
      if (vocab.compound && last === 'unit' && acc.lastUnit === 4 && value === 20) return true;
      return false;
    case 'hundred':
      // A bare "cent"/"hundred" is 100; otherwise it multiplies a unit ("two
      // hundred"). "twenty hundred" is not a number.
      return last === null || last === 'unit' || last === 'bigscale';
    case 'bigscale':
      // Scales must appear in decreasing order: "two million three thousand"
      // continues, "three thousand two million" is two numbers.
      return value < acc.lastBigScale;
    case 'joiner':
      // Only ever inside a number, and only where the language puts it.
      if (vocab.compound) return last === 'ten' && (acc.lastTen === 20 || acc.lastTen === 30 || acc.lastTen === 40 || acc.lastTen === 50 || acc.lastTen === 60 || acc.lastTen === 80);
      return last === 'hundred' || last === 'bigscale';
    case 'decimal':
      // Needs a number in front of it, so "the point is" and a bare "virgule"
      // dictated as punctuation are never read as a separator.
      return acc.seen > 0;
    default:
      return false;
  }
}

function apply(acc, piece, vocab) {
  const { kind, value } = piece;

  if (kind === 'decimal') {
    acc.fraction = '';
    acc.frac = newAcc();
    acc.last = 'decimal';
    return;
  }

  // In fraction mode the pieces feed the sub-accumulator; a piece it cannot
  // take closes that digit group and opens the next ("zéro cinq" -> "05").
  if (acc.fraction !== null) {
    if (acc.frac.seen && !accepts(acc.frac, piece, vocab)) {
      acc.fraction += String(accValue(acc.frac));
      acc.frac = newAcc();
    }
    apply(acc.frac, piece, vocab);
    if (piece.kind !== 'joiner') {
      acc.seen += 1;
      acc.words.push(piece.word);
    }
    return;
  }

  if (kind === 'joiner') {
    // Remember what the joiner attached to: "and" only carries a number
    // forward after a scale ("a hundred and twelve"), never after a bare unit.
    acc.beforeJoiner = acc.last;
    acc.last = 'joiner';
    return;
  }
  acc.seen += 1;
  acc.words.push(piece.word);
  switch (kind) {
    case 'unit':
      acc.current += value;
      acc.lastUnit = value;
      if (acc.last === 'ten') acc.unitAfterTen = true;
      acc.last = 'unit';
      break;
    case 'teen':
      // Remember whether this was a bare "dix", the only teen French can put a
      // unit after ("dix-sept", "soixante-dix-huit").
      acc.lastTeenWasBare10 = vocab.compound && value === 10;
      acc.current += value;
      acc.last = 'teen';
      break;
    case 'ten':
      if (vocab.compound && acc.last === 'unit' && acc.lastUnit === 4 && value === 20) {
        acc.current = acc.current - 4 + 80;   // quatre-vingt, on top of any hundreds
        acc.lastTen = 80;
      } else {
        acc.current += value;
        acc.lastTen = value;
      }
      acc.unitAfterTen = false;
      acc.last = 'ten';
      break;
    case 'hundred':
      acc.current = (acc.current || 1) * 100;
      acc.unitAfterTen = false;
      acc.last = 'hundred';
      break;
    case 'bigscale':
      acc.total += (acc.current || 1) * value;
      acc.current = 0;
      acc.lastBigScale = value;
      acc.unitAfterTen = false;
      acc.last = 'bigscale';
      break;
    default:
      break;
  }
}

function accValue(acc) {
  return acc.total + acc.current;
}

// A finished run is only worth converting if it is unambiguously a number: a
// single "one"/"un"/"une" is far more often a word than a digit.
function worthConverting(acc, vocab) {
  if (acc.seen === 0) return false;
  if (acc.seen === 1 && vocab.ambiguousAlone.has(acc.words[0])) return false;
  return true;
}

/**
 * Find the maximal runs of tokens that spell one number.
 *
 * @param {string[]} tokens Cleaned, lowercased words (no surrounding punctuation).
 * @param {string} lang 'en' or 'fr'.
 * @returns {{start:number,end:number,digits:string}[]} half-open [start,end) token ranges.
 */
export function findNumberSpans(tokens, lang) {
  const vocab = VOCABS[lang];
  if (!vocab || !Array.isArray(tokens) || !tokens.length) return [];

  const spans = [];
  let acc = newAcc();
  let start = -1;
  let end = -1;          // index after the last NUMERIC token (a trailing joiner is not part of the span)

  const flush = () => {
    if (start >= 0 && worthConverting(acc, vocab)) {
      const frac = fractionDigits(acc);
      spans.push({ start, end, digits: String(accValue(acc)) + (frac ? `.${frac}` : '') });
    }
    acc = newAcc();
    start = -1;
    end = -1;
  };

  for (let i = 0; i < tokens.length; i++) {
    const parts = pieces(tokens[i], vocab);
    if (!parts) { flush(); continue; }

    // A joiner or a decimal separator only ever lives INSIDE a number. On its
    // own ("give me five and six", "the point is") it is an ordinary word, so
    // it must not open a run, and a trailing one must stay in the text.
    const joinerOnly = parts.every(p => p.kind === 'joiner' || p.kind === 'decimal');
    if (joinerOnly && start < 0) { flush(); continue; }

    // A hyphenated token is all-or-nothing: if any piece cannot continue the
    // run, the run ends BEFORE the token and the token starts a fresh one.
    const trial = { ...acc, words: [...acc.words] };
    let ok = true;
    for (const part of parts) {
      if (!accepts(trial, part, vocab)) { ok = false; break; }
      apply(trial, part, vocab);
    }
    if (!ok) {
      flush();
      if (joinerOnly) continue;
      for (const part of parts) {
        if (!accepts(acc, part, vocab)) { acc = newAcc(); }
        apply(acc, part, vocab);
      }
      start = i;
      end = i + 1;
      continue;
    }

    Object.assign(acc, trial);
    if (start < 0) start = i;
    // Tokens that are only joiners ("and") do not extend the span on their own:
    // a trailing "and" must stay in the text.
    if (parts.some(p => p.kind !== 'joiner' && p.kind !== 'decimal')) end = i + 1;
  }
  flush();
  return spans;
}

// Letters, marks, apostrophes and hyphens: one "word" for tokenizing purposes.
const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’‑–-]*/gu;

function clean(word) {
  return word.toLowerCase().replace(/^[-'’‑–]+|[-'’‑–]+$/g, '');
}

/**
 * Rewrite spelled-out cardinal numbers in a plain string as digits.
 * Returns the input unchanged for an unsupported language or empty text.
 */
export function numberWordsToDigits(text, lang) {
  if (!text || typeof text !== 'string' || !VOCABS[lang]) return text;

  const matches = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text)) !== null) {
    matches.push({ raw: m[0], index: m.index });
  }
  if (!matches.length) return text;

  const spans = findNumberSpans(matches.map(x => clean(x.raw)), lang);
  if (!spans.length) return text;

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const first = matches[span.start];
    const last = matches[span.end - 1];
    out += text.slice(cursor, first.index) + span.digits;
    cursor = last.index + last.raw.length;
  }
  return out + text.slice(cursor);
}

/**
 * Same conversion over a word-timestamp array ({text, start_time, end_time,
 * confidence}, as produced by the decoder). A number spelled over several words
 * collapses into ONE word spanning the whole run, so the speaker view and the
 * plain transcript always show the same digits.
 */
export function numberWordsToDigitsInWords(words, lang) {
  if (!Array.isArray(words) || !words.length || !VOCABS[lang]) return words;

  // Keep whatever punctuation hangs off each word so "twenty-five." survives.
  const parsed = words.map((w) => {
    const raw = typeof w?.text === 'string' ? w.text : '';
    const match = raw.match(WORD_RE);
    const core = match ? match[0] : '';
    const at = core ? raw.indexOf(core) : 0;
    return { prefix: raw.slice(0, at), suffix: core ? raw.slice(at + core.length) : raw, core: clean(core) };
  });

  const spans = findNumberSpans(parsed.map(p => p.core), lang);
  if (!spans.length) return words;

  const out = [];
  let i = 0;
  for (const span of spans) {
    for (; i < span.start; i++) out.push(words[i]);
    const first = words[span.start];
    const last = words[span.end - 1];
    const confidences = words.slice(span.start, span.end)
      .map(w => (typeof w.confidence === 'number' ? w.confidence : null))
      .filter(c => c !== null);
    out.push({
      ...first,
      text: parsed[span.start].prefix + span.digits + parsed[span.end - 1].suffix,
      end_time: last.end_time,
      // The merged word is only as trustworthy as its least certain piece.
      ...(confidences.length ? { confidence: Math.min(...confidences) } : {}),
    });
    i = span.end;
  }
  for (; i < words.length; i++) out.push(words[i]);
  return out;
}
