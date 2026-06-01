// Unit test for the phrase-boosting trie (app/src/phraseBoost.js) and its
// interaction with the BPE encoder. Validates phrase parsing, trie build/advance,
// the depth-scaled bonus map, and that applyBoost/restore flips a greedy argmax
// without permanently altering the logits.
//
// Run from the repo root:  node scripts/test-phrase-boost.mjs
// Requires python with tokenizers + huggingface_hub (for the vocab fixture).
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpeEncoder, buildVocabToId } from '../app/src/bpeEncoder.js';
import { BoostingTrie, parseBoostPhrases, parseBoostDirectives, encodePhrases, casingVariants, expandCasingVariants, MAX_PHRASE_WEIGHT, DEFAULT_BOOST_TOPK } from '../app/src/phraseBoost.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asset = JSON.parse(readFileSync(resolve(root, 'app/ui/public/tokenizer/bpe-merges.json'), 'utf-8'));
const fixture = JSON.parse(
  execFileSync('python', [resolve(root, 'scripts/gen-bpe-fixture.py')], {
    maxBuffer: 256 * 1024 * 1024, encoding: 'utf-8',
  }),
);
const encoder = new BpeEncoder(asset, buildVocabToId(fixture.id2token));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { console.log(`FAIL  ${name}`); failures++; }
}
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- parseBoostPhrases ---------------------------------------------------
console.log('parseBoostPhrases:');
const parsed = parseBoostPhrases(
  'acetaminophen\nibuprofen:2.5\n  spaced phrase  \nfoo:99\n\nratio 3:1\n:0.5\nbad:abc',
);
check('default weight 1', parsed[0].phrase === 'acetaminophen' && parsed[0].weight === 1);
check('explicit weight 2.5', parsed[1].phrase === 'ibuprofen' && parsed[1].weight === 2.5);
check('trims whitespace', parsed[2].phrase === 'spaced phrase' && parsed[2].weight === 1);
check('out-of-range weight clamped + warning', parsed[3].phrase === 'foo' && parsed[3].weight === 1 && !!parsed[3].warning);
check('trailing :num is a weight (documented)', parsed[4].phrase === 'ratio 3' && parsed[4].weight === 1);
check('empty phrase before colon keeps whole line', parsed[5].phrase === ':0.5');
check('non-numeric tail is not a weight', parsed[6].phrase === 'bad:abc' && parsed[6].weight === 1);
check('skips blank lines', parsed.length === 7);

// negative weights penalise (within range); zero / under-range warn back to 1
const signed = parseBoostPhrases('um:-3\nover:-99\nzero:0');
check('negative weight in range kept', signed[0].phrase === 'um' && signed[0].weight === -3 && !signed[0].warning);
check('under-range negative weight clamped + warning', signed[1].phrase === 'over' && signed[1].weight === 1 && !!signed[1].warning);
check('zero weight rejected + warning', signed[2].phrase === 'zero' && signed[2].weight === 1 && !!signed[2].warning);

// optional :weight:topk suffix; defaults; validation
const tk = parseBoostPhrases('plain\nfoo:3\nbar:3:50\nbaz:3:0\nqux:3:2.5\nratio 3:1');
check('no suffix => default weight + default topk', tk[0].phrase === 'plain' && tk[0].weight === 1 && tk[0].topk === DEFAULT_BOOST_TOPK);
check('one number is the weight, topk defaults', tk[1].phrase === 'foo' && tk[1].weight === 3 && tk[1].topk === DEFAULT_BOOST_TOPK);
check('weight:topk parsed (inner weight, outer topk)', tk[2].phrase === 'bar' && tk[2].weight === 3 && tk[2].topk === 50);
check('topk < 1 rejected + warning', tk[3].phrase === 'baz' && tk[3].weight === 3 && tk[3].topk === DEFAULT_BOOST_TOPK && !!tk[3].warning);
check('non-integer topk rejected + warning', tk[4].phrase === 'qux' && tk[4].weight === 3 && tk[4].topk === DEFAULT_BOOST_TOPK && !!tk[4].warning);
check('colon-only phrase still unaffected with topk parsing', tk[5].phrase === 'ratio 3' && tk[5].weight === 1 && tk[5].topk === DEFAULT_BOOST_TOPK);

// optional empty fields (use default) and the trailing :s / :i case flag
const fl = parseBoostPhrases('a::40\nb:5:50:i\nc:s\nd:2:i\ne:5:50\nf:abc:i');
check('empty weight keeps default, explicit topk', fl[0].phrase === 'a' && fl[0].weight === 1 && fl[0].topk === 40);
check(':i flag after weight:topk parsed', fl[1].phrase === 'b' && fl[1].weight === 5 && fl[1].topk === 50 && fl[1].caseInsensitive === true);
check(':s flag alone (defaults otherwise)', fl[2].phrase === 'c' && fl[2].weight === 1 && fl[2].caseInsensitive === false);
check(':i flag right after weight (no topk)', fl[3].phrase === 'd' && fl[3].weight === 2 && fl[3].topk === DEFAULT_BOOST_TOPK && fl[3].caseInsensitive === true);
check('no flag leaves caseInsensitive undefined', fl[4].caseInsensitive === undefined);
check('non-numeric middle field is not a weight', fl[5].phrase === 'f:abc' && fl[5].weight === 1 && fl[5].caseInsensitive === true);

// --- list-level #! directives --------------------------------------------
console.log('parseBoostDirectives:');
const dirParsed = parseBoostPhrases('#!strength 3\nvenlafaxine:5\n#! a comment\namlodipine');
check('directive lines skipped, not phrases', dirParsed.length === 2
  && dirParsed[0].phrase === 'venlafaxine' && dirParsed[1].phrase === 'amlodipine');
check('strength directive parsed (space)', parseBoostDirectives('#!strength 3\nfoo').strength === 3);
check('strength directive parsed (= separator)', parseBoostDirectives('#!strength=2.5').strength === 2.5);
check('strength directive parsed (: separator)', parseBoostDirectives('#!strength:-4').strength === -4);
check('strength directive case-insensitive key', parseBoostDirectives('#!STRENGTH 1.5').strength === 1.5);
check('last strength directive wins', parseBoostDirectives('#!strength 2\n#!strength 7').strength === 7);
check('non-finite strength ignored', parseBoostDirectives('#!strength abc').strength === undefined);
check('unknown directive key ignored', Object.keys(parseBoostDirectives('#!note hello')).length === 0);
check('no directive => empty result', Object.keys(parseBoostDirectives('plain\nfoo:3')).length === 0);
check('# without ! is still a phrase', parseBoostPhrases('#hashtag').length === 1
  && parseBoostPhrases('#hashtag')[0].phrase === '#hashtag');

// --- casing expansion ----------------------------------------------------
console.log('casingVariants / expandCasingVariants:');
const cv = casingVariants('venlafaxine');
check('single word -> lower/UPPER/Sentence (Title == Sentence, deduped)',
  eqArr(cv, ['venlafaxine', 'VENLAFAXINE', 'Venlafaxine']));
const cvMulti = casingVariants('myocardial infarction');
check('multi word distinguishes Sentence from Title case',
  cvMulti.includes('Myocardial infarction') && cvMulti.includes('Myocardial Infarction'));
check('as-typed mixed casing is preserved as a variant',
  casingVariants('mRNA').includes('mRNA'));
check('empty phrase yields nothing', eqArr(casingVariants(''), []));

// Global default off (the function default): an unflagged entry passes through.
check('default off => no expansion',
  expandCasingVariants([{ phrase: 'venlafaxine', weight: 5, topk: 50 }]).length === 1);
// Global default on: an unflagged entry expands to all its casings.
const expanded = expandCasingVariants([{ phrase: 'venlafaxine', weight: 5, topk: 50 }], true);
check('default on => expands one entry into its casings', expanded.length === 3);
check('expanded entries carry the original weight + topk',
  expanded.every(e => e.weight === 5 && e.topk === 50));
check('expanded entries cover each casing',
  ['venlafaxine', 'Venlafaxine', 'VENLAFAXINE'].every(p => expanded.some(e => e.phrase === p)));
// Per-phrase flag overrides the global default in both directions.
check('per-phrase :i expands even when default is off',
  expandCasingVariants([{ phrase: 'venlafaxine', weight: 1, caseInsensitive: true }], false).length === 3);
check('per-phrase :s stays single even when default is on',
  expandCasingVariants([{ phrase: 'venlafaxine', weight: 1, caseInsensitive: false }], true).length === 1);
// Dedup across entries: a typed variant collides with a generated one; the
// larger-magnitude weight wins so an explicit strong phrase is not weakened.
const dedup = expandCasingVariants([
  { phrase: 'venlafaxine', weight: 2 },
  { phrase: 'Venlafaxine', weight: 8 },
], true);
check('collision keeps the larger-magnitude weight',
  dedup.find(e => e.phrase === 'Venlafaxine').weight === 8);
check('no duplicate phrase strings after expansion',
  new Set(dedup.map(e => e.phrase)).size === dedup.length);

// --- trie build + advance + bonus map ------------------------------------
console.log('BoostingTrie:');
const ids = encoder.encode('acetaminophen'); // [691,291,316,281,669,1722]
const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 2 }], encoder, { strength: 1, depthScaling: 0.5 });
check('non-empty after build', !trie.isEmpty && trie.size === 1);

trie.reset();
check('root boosts only first token', trie.childBoostFor(ids[0]) !== null && trie.childBoostFor(ids[1]) === null);
check('depth-1 bonus = weight*(1+0.5*0) = 2', trie.childBoostFor(ids[0]).bonus === 2);
check('default topk carried on the bonus', trie.childBoostFor(ids[0]).topk === DEFAULT_BOOST_TOPK);

trie.advance(ids[0]);
check('after advance: second token boosted', trie.childBoostFor(ids[1]) !== null);
check('depth-2 bonus = weight*(1+0.5*1) = 3', trie.childBoostFor(ids[1]).bonus === 3);
check('root still active: first token also boosted', trie.childBoostFor(ids[0]).bonus === 2);

trie.advance(999999); // a token not in any phrase
check('mismatch drops to root only', trie.childBoostFor(ids[1]) === null && trie.childBoostFor(ids[0]).bonus === 2);

// --- applyBoost / restore flips argmax, then restores --------------------
console.log('applyBoost / restore:');
const V = fixture.id2token.length;
const logits = new Float32Array(V); // all zero
logits[5] = 1.0;        // some other token is the unboosted winner
logits[ids[0]] = 0.5;   // the phrase token is a genuine top-k runner-up (so the
                        // gate lets it through without relying on tie-breaking
                        // among equal-valued tokens; see applyBoost top-k gate)
trie.reset();           // first phrase token (ids[0]) is now boostable
const before = logits[ids[0]];
const argmaxOf = (arr) => { let m = -Infinity, mi = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) { m = arr[i]; mi = i; } return mi; };
check('unboosted argmax is token 5', argmaxOf(logits) === 5);
const saved = trie.applyBoost(logits); // strength 1 * bonus 2 => logits[ids[0]] = 2.5
check('applyBoost returned saved pairs', Array.isArray(saved) && saved.length === 2);
check('boosted argmax is the phrase token', argmaxOf(logits) === ids[0]);
trie.restore(logits, saved);
check('restore returns original value', logits[ids[0]] === before);
check('argmax back to token 5 after restore', argmaxOf(logits) === 5);

// strength 0 disables boosting entirely
trie.strength = 0;
check('strength 0 => applyBoost is a no-op', trie.applyBoost(logits) === null);

// --- negative weights penalise (flip the argmax away) --------------------
console.log('penalise (negative weight):');
const penTrie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: -2 }], encoder, { strength: 1, depthScaling: 0.5 });
penTrie.reset();
check('negative bonus is stored, not lost against 0', penTrie.childBoostFor(ids[0]).bonus === -2);
const penLogits = new Float32Array(V);
penLogits[ids[0]] = 1.0;      // the phrase token would otherwise win
penLogits[5] = 0.5;           // runner-up
check('unpenalised argmax is the phrase token', argmaxOf(penLogits) === ids[0]);
const penSaved = penTrie.applyBoost(penLogits); // logits[ids[0]] += 1 * -2 => -1.0
check('penalty pushed the phrase token below the runner-up', argmaxOf(penLogits) === 5);
penTrie.restore(penLogits, penSaved);
check('restore brings the phrase token back', penLogits[ids[0]] === 1.0);

// --- top-k gating: only boost tokens already in the model's top-k -----------
console.log('top-k gating:');
const gateLogits = new Float32Array(V);
gateLogits[100] = 5; gateLogits[101] = 4; gateLogits[ids[0]] = 1; // ids[0] ranks 3rd
const gate2 = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, topk: 2 }], encoder, { strength: 1 });
gate2.reset();
check('candidate outside top-k is gated out (applyBoost no-op)', gate2.applyBoost(gateLogits) === null);
check('gated-out logit is untouched', gateLogits[ids[0]] === 1);
const gate3 = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, topk: 3 }], encoder, { strength: 1 });
gate3.reset();
const gateSaved = gate3.applyBoost(gateLogits); // ids[0] now within top-3 => +5
check('candidate inside top-k is boosted', Array.isArray(gateSaved) && gateLogits[ids[0]] === 6);
gate3.restore(gateLogits, gateSaved);
check('restore after gated boost', gateLogits[ids[0]] === 1);

// --- OOV (<unk>) phrases are skipped, not inserted -----------------------
console.log('skip <unk> phrases:');
check('東京 encodes to <unk>', encoder.encode('東京').includes(encoder.unkId));
const mixedTrie = BoostingTrie.buildFromPhrases(
  [{ phrase: 'acetaminophen', weight: 1 }, { phrase: '東京', weight: 1 }, { phrase: 'sœur', weight: 1 }],
  encoder,
);
check('clean Latin phrases inserted (accents + œ ligature)', mixedTrie.size === 2);
check('CJK phrase recorded as skipped', eqArr(mixedTrie.skipped, ['東京']));
check('skipped phrase is not boostable', !mixedTrie.root.children.has(encoder.unkId));

// --- encodePhrases / buildFromEncoded (worker split) ---------------------
// The worker calls encodePhrases off the main thread, then the main thread
// builds the trie from the pre-encoded ids via buildFromEncoded. The result
// must match the all-in-one buildFromPhrases path.
console.log('encodePhrases + buildFromEncoded:');
const splitEntries = [
  { phrase: 'acetaminophen', weight: 1 },
  { phrase: '東京', weight: 1 },
  { phrase: 'sœur', weight: 1 },
];
const { encoded, skipped } = encodePhrases(splitEntries, encoder);
check('encodePhrases drops the <unk> phrase', skipped.length === 1 && skipped[0] === '東京');
check('encodePhrases keeps the clean phrases', encoded.length === 2);
check('encoded ids match a direct encode', eqArr(encoded[0].ids, encoder.encode('acetaminophen')));
const fromEncoded = BoostingTrie.buildFromEncoded(encoded, { strength: 1 });
fromEncoded.skipped = skipped;
check('buildFromEncoded yields the same size as buildFromPhrases', fromEncoded.size === mixedTrie.size);
check('buildFromEncoded reaches the same first token', fromEncoded.root.children.has(ids[0]));

console.log(`\n${failures === 0 ? 'PASS' : failures + ' FAILED'}`);
process.exit(failures ? 1 : 0);
