#!/usr/bin/env node
// WER benchmark for the Parakeet web pipeline over a NeMo manifest.
//
// It reuses parakeet_web's own decoding code unchanged (the exact model +
// phrase-boosting trie the web app / scripts/transcribe.mjs build) so the
// transcripts, beam search and phrase boosting match production. Only the
// harness around it is new: it loops a NeMo jsonl manifest, transcribes each
// utterance, and reports word error rate (WER) and Levenshtein distance against
// the manifest's reference text. No audio preprocessing is done beyond ffmpeg
// decode to 16 kHz mono float32 (same as transcribe.mjs).
//
// The point is to measure how much the decoding knobs move WER, so it SWEEPS a
// grid: beam-width x (no-boost baseline + each boost strength) and prints one
// row per combination in two tables (accuracy + per-phase timing). Rows are
// sorted by the per-utterance median WER (best first), and the accuracy table
// reports the mean/median/stdev of the per-utterance WER alongside the
// corpus-level rate. It also writes those tables to a .md file and every
// per-sample/per-run record to a JSON Lines file.
//
// Audio is decoded once and cached across rows, and so is the encoder output:
// only the decoding (beam width / phrase boost) changes between grid cells, so
// each utterance is run through preprocessing + the encoder a single time
// (model.encode()) and that cacheable result is decoded once per cell. Since
// the encoder dominates runtime, this makes a multi-cell sweep roughly as fast
// as a single full pass plus the (cheap) extra decodes. The reported preproc/
// encode timings are the shared one-time cost; the per-cell wall time / RTF
// reflect just the decode work (the encoder is amortized away).
//
// Example:
//   node benchmark_parakeet_web.mjs \
//     --manifest ./perso/oli_spoken_dataset/nemo_manifest_ordered_uncapitaliazedDCI.json \
//     --audio-root "~/Downloads/parakeet finetuning/NeMo" \
//     --model-dir  ./perso/onnx_export \
//     --beam-width 1,2,4 \
//     --phrase-boost ~/Desktop/Olivier/parakeet_web/phrase_boosting/medical.txt \
//     --boost-strength 1,2
//
// This script lives in parakeet_web/scripts/, so it imports the reusable
// helpers from its sibling transcribe.mjs by default. Set PARAKEET_WEB (or
// --parakeet-web DIR) to point at a different parakeet_web checkout.
//
// Built with Claude Code.

import { readFileSync, existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, isAbsolute, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- locate parakeet_web --------------------------------------------------
// This script lives in <parakeet_web>/scripts/, so parakeet_web is its parent
// directory's parent. Deriving it from the script's own location keeps the
// sibling transcribe.mjs import working wherever the repo is checked out;
// --parakeet-web / PARAKEET_WEB still override it.
const DEFAULT_PARAKEET_WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- arg parsing ----------------------------------------------------------
function parseArgs(argv) {
  const a = {
    manifest: null,
    audioRoot: process.cwd(),
    parakeetWeb: process.env.PARAKEET_WEB || DEFAULT_PARAKEET_WEB,
    model: null,            // null => loadParakeetModel uses its DEFAULT_MODEL
    modelDir: null,
    quant: 'int8',
    beamWidths: [1],        // swept dimension
    strengths: [1],         // swept dimension (only used when --phrase-boost given)
    boosts: [],             // --phrase-boost specs (repeatable); inline / .txt / .pwc
    noBaseline: false,      // drop the no-boost row from the sweep
    maesNumSteps: 2,
    maesExpansionBeta: 2,
    maesExpansionGamma: 2.3,
    frameStride: 1,
    threads: 0,
    limit: 0,               // 0 => all utterances
    stripAccents: false,    // WER normalization: fold accents (é -> e)
    jsonl: 'benchmark_results.jsonl', // per-utterance + per-run records (one JSON/line)
    md: 'benchmark_results.md',       // summary tables in markdown
    resume: false,          // skip grid cells already completed in the jsonl
    ffmpeg: null,
    verbose: false,
  };
  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${name}`);
    return argv[i + 1];
  };
  const numList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inlineVal = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = (name) => { if (inlineVal !== null) return inlineVal; i++; return need(i - 1, name); };
    switch (flag) {
      case '-h': case '--help': printHelp(); process.exit(0); break;
      case '--manifest': a.manifest = val(flag); break;
      case '--audio-root': a.audioRoot = val(flag); break;
      case '--parakeet-web': a.parakeetWeb = val(flag); break;
      case '--model': a.model = val(flag); break;
      case '--model-dir': a.modelDir = val(flag); break;
      case '--quant': a.quant = val(flag); break;
      case '-w': case '--beam-width': a.beamWidths = numList(val(flag)); break;
      case '-s': case '--boost-strength': a.strengths = numList(val(flag)); break;
      case '-b': case '--phrase-boost': a.boosts.push(val(flag)); break;
      case '--no-baseline': a.noBaseline = true; break;
      case '--maes-num-steps': a.maesNumSteps = parseInt(val(flag), 10); break;
      case '--maes-expansion-beta': a.maesExpansionBeta = parseInt(val(flag), 10); break;
      case '--maes-expansion-gamma': a.maesExpansionGamma = Number(val(flag)); break;
      case '--frame-stride': a.frameStride = parseInt(val(flag), 10); break;
      case '--threads': a.threads = parseInt(val(flag), 10); break;
      case '--limit': a.limit = parseInt(val(flag), 10); break;
      case '--strip-accents': a.stripAccents = true; break;
      case '--jsonl': a.jsonl = val(flag); break;
      case '--md': a.md = val(flag); break;
      case '--resume': a.resume = true; break;
      case '--ffmpeg': a.ffmpeg = val(flag); break;
      case '-v': case '--verbose': a.verbose = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!a.manifest) throw new Error('No --manifest given. See --help.');
  if (a.quant !== 'int8' && a.quant !== 'fp16' && a.quant !== 'fp32') throw new Error(`--quant must be int8, fp16 or fp32 (got ${a.quant})`);
  if (!a.beamWidths.length || a.beamWidths.some((w) => !Number.isInteger(w) || w < 1 || w > 25)) {
    throw new Error('--beam-width must be a comma-separated list of integers in [1, 25]');
  }
  if (!a.strengths.length || a.strengths.some((s) => !Number.isFinite(s))) {
    throw new Error('--boost-strength must be a comma-separated list of numbers');
  }
  if (!Number.isInteger(a.frameStride) || a.frameStride < 1 || a.frameStride > 4) {
    throw new Error('--frame-stride must be an integer in [1, 4]');
  }
  return a;
}

function printHelp() {
  console.log(`Benchmark the Parakeet web pipeline (WER + Levenshtein) over a NeMo manifest.

Usage:
  node benchmark_parakeet_web.mjs --manifest <file.json> [options]

Required:
  --manifest FILE          NeMo jsonl manifest. One JSON object per line with
                           "audio_filepath" and "text" (reference). "duration"
                           is read for reporting if present.

Paths:
  --audio-root DIR         Directory that relative "audio_filepath" entries are
                           resolved against. Default: current working dir.
                           (Absolute audio_filepath entries are used as-is.)
  --parakeet-web DIR       Path to the parakeet_web repo whose pipeline is
                           reused. Default: $PARAKEET_WEB or
                           ${DEFAULT_PARAKEET_WEB}.

Model (ONNX; the web pipeline cannot read a raw .nemo):
  --model-dir DIR          Directory with the .onnx files + vocab.txt (e.g. your
                           finetuned model exported via export_onnx.py). If
                           omitted, the HuggingFace cache for --model is used.
  --model KEY              Model key for the architecture config (features /
                           subsampling). Default: the pipeline's default model.
  --quant int8|fp16|fp32   Encoder/decoder quantisation. Default int8. fp16 files
                           come from scripts/quantize-fp16.py (~1.2 GB encoder,
                           near-lossless vs fp32; native CPU upcasts to fp32 for
                           compute, a faithful proxy for WebGPU fp16 quality).

Decoding sweep (each is a comma-separated list; the grid is their product):
  -w, --beam-width LIST    Beam widths to test, e.g. "1,2,4,8". 1 = greedy.
                           Default 1.
  -b, --phrase-boost SPEC  Phrase-boost source: inline "phrase:WEIGHT:TOPK:FLAG"
                           text, a .txt list, or a precompiled .pwc. Repeatable;
                           all specs are merged into one boost set. When given,
                           the sweep adds one row per --boost-strength (plus a
                           no-boost baseline row unless --no-baseline).
  -s, --boost-strength LIST  Boost-strength multipliers to test, e.g. "1,2".
                           Only used when --phrase-boost is set. Default 1.
      --no-baseline        Drop the no-boost baseline row from the sweep.

MAES knobs (used only when a beam width > 1; defaults match NeMo's maes):
      --maes-num-steps N         Max symbols per frame. Default 2.
      --maes-expansion-beta N    Over-generation budget. Default 2.
      --maes-expansion-gamma F   Log-prob prune threshold. Default 2.3.
      --frame-stride N           Decimate encoder frames [1,4]. Default 1.

WER:
      --strip-accents      Also fold accents (é -> e) when normalizing. By
                           default text is lowercased and punctuation-stripped
                           but accents are KEPT. Whitespace is always collapsed.

Output / misc:
      --limit N            Only the first N manifest entries (quick smoke test).
      --jsonl FILE         Write results as JSON Lines (one object per line):
                           a "utterance" record per sample (with per-phase
                           timings) and a "summary" record per run (with the
                           corpus WER plus the mean/median/stdev of the
                           per-utterance WER, and the mean/median of each
                           phase). Default benchmark_results.jsonl.
      --md FILE            Write the summary tables (accuracy + per-phase
                           timing) as markdown. Default benchmark_results.md.
      --resume             Reuse an existing --jsonl: any grid cell whose
                           "summary" record is already present is skipped (and
                           still shown in the final tables). Orphan records from
                           an interrupted, never-finished run are dropped.
      --threads N          WASM thread count (default: ORT chooses).
      --ffmpeg PATH        ffmpeg binary (else auto-detected).
  -v, --verbose            Verbose model + boost logs.
  -h, --help               Show this help.
`);
}

// --- WER / Levenshtein ----------------------------------------------------
// Normalize for scoring: lowercase, strip punctuation (keep letters incl.
// accented + digits), collapse whitespace. Accents are kept unless stripAccents.
function normalizeText(s, stripAccents) {
  let t = String(s).toLowerCase();
  if (stripAccents) t = t.normalize('NFD').replace(/\p{M}+/gu, '');
  // Replace every non-letter / non-digit / non-space with a space, then collapse.
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return t;
}

// Levenshtein edit distance between two sequences (arrays or strings). Returns
// the integer number of substitutions + deletions + insertions. O(n*m) time,
// O(min) space.
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure b is the shorter one for the rolling row.
  if (b.length > a.length) { const t = a; a = b; b = t; }
  const m = b.length;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[m];
}

// Score one hypothesis vs reference: word-level edits (for WER) and char-level
// edits (for CER / raw Levenshtein distance). Empty references contribute no
// denominator but still count any inserted words/chars as errors.
function score(refNorm, hypNorm) {
  const refWords = refNorm ? refNorm.split(' ') : [];
  const hypWords = hypNorm ? hypNorm.split(' ') : [];
  const wordEdits = levenshtein(refWords, hypWords);
  const charEdits = levenshtein(refNorm, hypNorm); // string => char array
  return {
    refWords: refWords.length,
    hypWords: hypWords.length,
    wordEdits,
    refChars: refNorm.length,
    charEdits,
  };
}

// --- manifest -------------------------------------------------------------
function loadManifest(manifestPath, audioRoot, limit) {
  const raw = readFileSync(manifestPath, 'utf-8');
  const entries = [];
  let lineNo = 0;
  for (const line of raw.split('\n')) {
    lineNo++;
    const t = line.trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch (e) {
      throw new Error(`manifest line ${lineNo}: invalid JSON (${e.message})`);
    }
    const audioField = obj.audio_filepath ?? obj.audio_path ?? obj.wav ?? obj.audio;
    const text = obj.text ?? obj.transcript ?? obj.reference;
    if (!audioField) throw new Error(`manifest line ${lineNo}: missing audio_filepath`);
    if (text === undefined) throw new Error(`manifest line ${lineNo}: missing text`);
    const audioPath = isAbsolute(audioField) ? audioField : resolve(audioRoot, audioField);
    entries.push({ audioPath, text, duration: obj.duration });
    if (limit && entries.length >= limit) break;
  }
  return entries;
}

// Short content hash of the phrase-boost sources, folded into the resume key so
// that editing a boost file (or swapping it for another) invalidates the cached
// boost cells but leaves the no-boost baseline cells reusable. Each spec string
// is hashed (covers inline specs and distinguishes file paths) along with the
// file's bytes when it resolves to a file. Returns null when no boosts are set.
function boostDigest(boosts) {
  if (!boosts.length) return null;
  const h = createHash('sha1');
  for (const spec of boosts) {
    h.update('\0' + spec + '\0');
    if (existsSync(spec) && statSync(spec).isFile()) h.update(readFileSync(spec));
  }
  return h.digest('hex').slice(0, 8);
}

// --- stats ----------------------------------------------------------------
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Population standard deviation (divide by n): the spread of the observed
// per-utterance values, not an estimate of a wider population.
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
}

// The per-phase timings the model reports (key in metrics -> short column label).
const PHASES = [
  ['preprocess_ms', 'preproc'],
  ['encode_ms', 'encode'],
  ['decode_ms', 'decode'],
  ['tokenize_ms', 'tokenize'],
  ['total_ms', 'total'],
];

// --- formatting -----------------------------------------------------------
function pct(n, d) { return d > 0 ? (100 * n / d) : 0; }

// Compact mm:ss / h:mm:ss for ETAs, e.g. 75000 -> "1:15", 3725000 -> "1:02:05".
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.round(ms / 1000);
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ASCII progress bar, e.g. bar(0.4, 10) -> "[####------]".
function bar(frac, width = 12) {
  const f = Math.max(0, Math.min(1, frac));
  const filled = Math.round(f * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
}

// "done/total bar pct% ETA" where ETA extrapolates from elapsed so far.
function progress(done, total, elapsedMs) {
  const frac = total > 0 ? done / total : 0;
  const eta = done > 0 ? (elapsedMs / done) * (total - done) : NaN;
  return `${bar(frac)} ${done}/${total} ${(frac * 100).toFixed(0).padStart(3)}% ETA ${fmtDuration(eta)}`;
}

// Two renderers over the same (headers, body-of-strings) shape so the console
// (monospace, right-aligned) and the .md file (markdown) never drift apart.
function renderAligned(headers, body) {
  const widths = headers.map((h, c) => Math.max(h.length, ...body.map((row) => row[c].length)));
  const sep = '  ';
  const line = (cells) => cells.map((v, c) => v.padStart(widths[c])).join(sep);
  return [line(headers), widths.map((w) => '-'.repeat(w)).join(sep), ...body.map(line)].join('\n');
}
function renderMarkdown(headers, body) {
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const row = (cells) => '| ' + cells.map(esc).join(' | ') + ' |';
  return [row(headers), '| ' + headers.map(() => '---').join(' | ') + ' |', ...body.map(row)].join('\n');
}

// Accuracy table: one row per run (grid combination). Rows are sorted by the
// per-utterance median WER (ascending) so the best config is at the top. "WER %"
// is the corpus-level rate (total word edits / total ref words); WERmean/med/std
// summarise the spread of the individual per-utterance WERs.
const ACC_HEAD = ['beam', 'boost', 'strength', 'WER %', 'WERmean %', 'WERmed %', 'WERstd %', 'CER %', 'wordEdits', 'refWords', 'charEdits', 'refChars'];
function accuracyBody(rows) {
  return rows.map((r) => [
    String(r.beamWidth),
    r.boostLabel,
    r.strength == null ? '-' : String(r.strength),
    pct(r.wordEdits, r.refWords).toFixed(2),
    mean(r.werSamples).toFixed(2),
    median(r.werSamples).toFixed(2),
    stdev(r.werSamples).toFixed(2),
    pct(r.charEdits, r.refChars).toFixed(2),
    String(r.wordEdits),
    String(r.refWords),
    String(r.charEdits),
    String(r.refChars),
  ]);
}

// Timing table: per-phase mean/median (ms per utterance) plus wall time. Each
// phase cell is "mean/median".
const TIME_HEAD = ['beam', 'boost', 'strength', ...PHASES.map(([, label]) => label), 'rtf', 'wall s', 'n'];
function timingBody(rows) {
  return rows.map((r) => {
    const cell = (key) => `${mean(r.timings[key]).toFixed(1)}/${median(r.timings[key]).toFixed(1)}`;
    return [
      String(r.beamWidth),
      r.boostLabel,
      r.strength == null ? '-' : String(r.strength),
      ...PHASES.map(([key]) => cell(key)),
      mean(r.timings.rtf).toFixed(2),
      (r.timeMs / 1000).toFixed(1),
      String(r.timings.total_ms.length),
    ];
  });
}

// Per-run phase stats as a plain object (for the JSONL "summary" records).
function phaseStats(timings) {
  const out = {};
  for (const [key, label] of PHASES) {
    out[label] = { mean: +mean(timings[key]).toFixed(2), median: +median(timings[key]).toFixed(2) };
  }
  out.rtf = { mean: +mean(timings.rtf).toFixed(3), median: +median(timings.rtf).toFixed(3) };
  return out;
}

// --- main -----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Import parakeet_web's reusable pipeline helpers (the same ones the CLI and
  // the web app use). Dynamic import so the path can be configured at runtime.
  const transcribePath = join(args.parakeetWeb, 'scripts', 'transcribe.mjs');
  if (!existsSync(transcribePath)) {
    throw new Error(
      `Could not find parakeet_web at ${transcribePath}. ` +
      `Pass --parakeet-web <dir> or set PARAKEET_WEB.`,
    );
  }
  const pw = await import(pathToFileURL(transcribePath).href);
  const { loadParakeetModel, buildPhraseBoost, findFfmpeg, decodePcm } = pw;

  const entries = loadManifest(args.manifest, args.audioRoot, args.limit);
  console.error(`[bench] manifest: ${args.manifest} (${entries.length} utterances)`);
  console.error(`[bench] audio root: ${args.audioRoot}`);

  // Verify the audio files exist up front so a typo in --audio-root fails fast
  // rather than after loading the model.
  const missing = entries.filter((e) => !existsSync(e.audioPath));
  if (missing.length) {
    const sample = missing.slice(0, 3).map((e) => e.audioPath).join('\n  ');
    throw new Error(`${missing.length} audio file(s) not found, e.g.:\n  ${sample}\nCheck --audio-root.`);
  }

  const ffmpeg = findFfmpeg(args.ffmpeg);
  console.error(`[bench] ffmpeg: ${ffmpeg}`);

  const { model, tokenizer, dir } = await loadParakeetModel({
    model: args.model ?? undefined,
    modelDir: args.modelDir,
    quant: args.quant,
    threads: args.threads,
    verbose: args.verbose,
  });
  console.error(`[bench] model dir: ${dir} (${args.quant})`);

  // Build the boost dimension of the sweep:
  //   - always a no-boost baseline (unless --no-baseline AND boosts given), and
  //   - when --phrase-boost is set, one config per --boost-strength.
  // Each config carries a prebuilt trie so we build each trie only once and
  // reuse it across all beam widths and all utterances.
  const boostConfigs = [];
  const hasBoost = args.boosts.length > 0;
  // Content hash of the boost sources, folded into the boost cells' resume key.
  const bDigest = boostDigest(args.boosts);
  if (!hasBoost || !args.noBaseline) {
    boostConfigs.push({ label: 'none', strength: null, phraseBoost: null, boostDigest: null });
  }
  if (hasBoost) {
    for (const strength of args.strengths) {
      const phraseBoost = await buildPhraseBoost({
        boosts: args.boosts,
        strength,
        tokenizer,
        quiet: !args.verbose,
        verbose: args.verbose,
      });
      if (!phraseBoost) {
        console.error(`[bench] warning: phrase-boost produced an empty trie (no in-vocab phrases); treating strength ${strength} as no-boost.`);
      }
      boostConfigs.push({ label: 'boost', strength, phraseBoost, boostDigest: bDigest });
    }
  }

  // The full grid: beam widths x boost configs.
  const grid = [];
  for (const beamWidth of args.beamWidths) {
    for (const bc of boostConfigs) grid.push({ beamWidth, ...bc });
  }
  console.error(`[bench] sweep: ${args.beamWidths.length} beam width(s) x ${boostConfigs.length} boost config(s) = ${grid.length} run(s) over ${entries.length} utterances each\n`);

  // Decode each audio once and cache the PCM across all grid rows (only the
  // decoding changes between rows, never the audio). For very large datasets
  // this trades memory for not re-running ffmpeg per row.
  const pcmCache = new Map();
  async function getPcm(p) {
    let pcm = pcmCache.get(p);
    if (!pcm) { pcm = await decodePcm(ffmpeg, p); pcmCache.set(p, pcm); }
    return pcm;
  }

  // Encode each audio once and cache the encoder output (preprocessing + the
  // encoder), the single most expensive stage. It depends only on the audio,
  // never on the decode knobs, so the same cached result is decoded by every
  // grid cell (passed back via opts.encoded). model.encode() returns plain JS
  // memory (no live ORT tensors), so caching it is leak-free. Like pcmCache
  // this trades memory for speed; the PCM is kept too (transcribe() still reads
  // its length for RTF).
  const encCache = new Map();
  async function getEncoded(p) {
    let enc = encCache.get(p);
    if (!enc) { enc = await model.encode(await getPcm(p), 16000, { enableProfiling: true }); encCache.set(p, enc); }
    return enc;
  }

  const decodeOpts = (row) => ({
    enableChunking: false, // manifest utterances are short; one pass each
    phraseBoost: row.phraseBoost,
    beamWidth: row.beamWidth,
    maesNumSteps: args.maesNumSteps,
    maesExpansionBeta: args.maesExpansionBeta,
    maesExpansionGamma: args.maesExpansionGamma,
    frameStride: args.frameStride,
    temperature: 0,            // mirror the web UI (transcript-neutral)
    returnTimestamps: false,
    returnConfidences: false,
    enableProfiling: true,     // populate result.metrics with per-phase timings
  });

  // transcribe() logs a "[Perf]" line + console.table per call when profiling
  // is on (which we need for the metrics). Silence that per-utterance spam so it
  // doesn't drown the final tables; in --verbose mode we leave it through.
  async function transcribeQuiet(pcm, opts) {
    if (args.verbose) return model.transcribeChunked(pcm, 16000, opts, () => {});
    const origLog = console.log, origTable = console.table;
    console.log = () => {}; console.table = () => {};
    try {
      return await model.transcribeChunked(pcm, 16000, opts, () => {});
    } finally {
      console.log = origLog; console.table = origTable;
    }
  }

  // Stable per-cell key used both as the JSONL "run" field and to match a cell
  // against already-completed records when resuming. Boost cells fold in the
  // boost-source content hash so editing/swapping the boost file invalidates
  // only those cells (the no-boost baseline keeps its plain key).
  const tagOf = (row) => {
    const boostPart = row.boostDigest ? `boost#${row.boostDigest}` : row.label;
    return `beam=${row.beamWidth} ${boostPart}${row.strength == null ? '' : '@' + row.strength}`;
  };

  // Reconstruct a summary row (the shape the final tables consume) from a
  // completed run's records read back from the JSONL, so resumed cells render
  // identically to freshly-run ones.
  const rowFromRecords = (utts, s) => {
    const timings = { rtf: [] };
    for (const [key] of PHASES) timings[key] = [];
    const werSamples = [];
    let refWords = 0, wordEdits = 0, refChars = 0, charEdits = 0;
    for (const u of utts) {
      refWords += u.refWords || 0; wordEdits += u.wordEdits || 0;
      refChars += u.refChars || 0; charEdits += u.charEdits || 0;
      werSamples.push(pct(u.wordEdits || 0, u.refWords || 0));
      const m = u.metrics || {};
      for (const [key] of PHASES) timings[key].push(m[key] ?? 0);
      timings.rtf.push(m.rtf ?? 0);
    }
    return { beamWidth: s.beam, boostLabel: s.boost, strength: s.strength,
      refWords, hypWords: 0, wordEdits, refChars, charEdits, werSamples, timeMs: s.wall_ms || 0, timings };
  };

  // Computed rows keyed by cell tag; seeded with whatever --resume recovers and
  // filled in as new cells run. Emitted in grid order at the end.
  const summaryByTag = new Map();
  const completed = new Set(); // cell tags already done (skip these)

  // --- resume: recover completed cells, drop orphan partial records ---------
  // A cell counts as complete only when its "summary" record is present; an
  // interrupted run that wrote some "utterance" records but no summary is
  // dropped so it is cleanly re-run (no duplicate utterance lines).
  if (args.resume && args.jsonl && existsSync(args.jsonl)) {
    const byRun = new Map(); // run tag -> { utts:[], summary, lines:[] }
    for (const line of readFileSync(args.jsonl, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (!obj.run) continue;
      let g = byRun.get(obj.run);
      if (!g) { g = { utts: [], summary: null, lines: [] }; byRun.set(obj.run, g); }
      g.lines.push(line);
      if (obj.type === 'utterance') g.utts.push(obj);
      else if (obj.type === 'summary') g.summary = obj;
    }
    const keptLines = [];
    for (const [run, g] of byRun) {
      if (!g.summary) continue; // orphan/partial -> drop, will be re-run
      completed.add(run);
      summaryByTag.set(run, rowFromRecords(g.utts, g.summary));
      for (const l of g.lines) keptLines.push(l);
    }
    writeFileSync(args.jsonl, keptLines.length ? keptLines.join('\n') + '\n' : '');
    console.error(`[bench] resume: ${completed.size} completed run(s) reused from ${args.jsonl}`);
  } else if (args.jsonl) {
    // Fresh start: truncate any previous file so appends below build it anew.
    writeFileSync(args.jsonl, '');
  }

  // Append one JSON object per line; the file is built incrementally so a long
  // grid leaves a usable, up-to-date file even if interrupted.
  const writeJsonl = (obj) => { if (args.jsonl) appendFileSync(args.jsonl, JSON.stringify(obj) + '\n'); };

  // Only run the cells that aren't already complete.
  const pending = grid.filter((cell) => !completed.has(tagOf(cell)));
  if (completed.size) {
    console.error(`[bench] ${pending.length} run(s) left to do (${completed.size} skipped)\n`);
  }

  // Two-level progress: per-utterance within the current run, and overall
  // across every utterance of every pending run. ETAs extrapolate from elapsed.
  const totalUtts = pending.length * entries.length;
  let doneUtts = 0;
  const gridT0 = Date.now();

  for (let gi = 0; gi < pending.length; gi++) {
    const row = pending[gi];
    const tag = tagOf(row);
    let refWords = 0, hypWords = 0, wordEdits = 0, refChars = 0, charEdits = 0;
    // Per-utterance WER samples (percent) for this run's mean/median/stdev.
    const werSamples = [];
    // Per-phase timing samples (one entry per utterance) for this run.
    const timings = { rtf: [] };
    for (const [key] of PHASES) timings[key] = [];
    const t0 = Date.now();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const pcm = await getPcm(e.audioPath);
      const encoded = await getEncoded(e.audioPath);
      const result = await transcribeQuiet(pcm, { ...decodeOpts(row), encoded });
      const hyp = result.utterance_text ?? '';
      const metrics = result.metrics ?? {};
      const refNorm = normalizeText(e.text, args.stripAccents);
      const hypNorm = normalizeText(hyp, args.stripAccents);
      const sc = score(refNorm, hypNorm);
      refWords += sc.refWords; hypWords += sc.hypWords; wordEdits += sc.wordEdits;
      refChars += sc.refChars; charEdits += sc.charEdits;
      werSamples.push(pct(sc.wordEdits, sc.refWords));
      // Accumulate per-phase timings for this run's mean/median.
      for (const [key] of PHASES) timings[key].push(metrics[key] ?? 0);
      timings.rtf.push(metrics.rtf ?? 0);
      writeJsonl({
        type: 'utterance', run: tag,
        beam: row.beamWidth, boost: row.label, strength: row.strength,
        audio: e.audioPath, duration: e.duration,
        ref: e.text, hyp, refNorm, hypNorm,
        wordEdits: sc.wordEdits, refWords: sc.refWords,
        charEdits: sc.charEdits, refChars: sc.refChars,
        metrics,
      });
      // Progress on a single rewritten line: this run, then the whole grid.
      doneUtts++;
      const runP = progress(i + 1, entries.length, Date.now() - t0);
      const gridP = progress(doneUtts, totalUtts, Date.now() - gridT0);
      process.stderr.write(`\r[bench] run ${gi + 1}/${pending.length} ${tag}  ${runP}  |  all runs ${gridP}   `);
    }
    const timeMs = Date.now() - t0;
    process.stderr.write('\n');
    const r = { beamWidth: row.beamWidth, boostLabel: row.label, strength: row.strength,
      refWords, hypWords, wordEdits, refChars, charEdits, werSamples, timeMs, timings };
    summaryByTag.set(tag, r);
    writeJsonl({
      type: 'summary', run: tag,
      beam: row.beamWidth, boost: row.label, strength: row.strength,
      utterances: entries.length,
      wer_pct: +pct(wordEdits, refWords).toFixed(4),
      wer_mean_pct: +mean(werSamples).toFixed(4),
      wer_median_pct: +median(werSamples).toFixed(4),
      wer_stdev_pct: +stdev(werSamples).toFixed(4),
      cer_pct: +pct(charEdits, refChars).toFixed(4),
      wordEdits, refWords, charEdits, refChars,
      wall_ms: timeMs,
      timing_ms: phaseStats(timings),
    });
    console.error(`[bench] -> WER ${pct(wordEdits, refWords).toFixed(2)}%  CER ${pct(charEdits, refChars).toFixed(2)}%  (${(timeMs / 1000).toFixed(1)}s)`);
  }

  model.dispose();

  // Emit every cell (resumed + freshly run), sorted by per-utterance median WER
  // ascending so the best-scoring config lands at the top of both tables.
  const summary = grid.map((cell) => summaryByTag.get(tagOf(cell))).filter(Boolean);
  summary.sort((a, b) => median(a.werSamples) - median(b.werSamples));

  // Final tables: accuracy + per-phase timing (mean/median ms per utterance).
  const accText = renderAligned(ACC_HEAD, accuracyBody(summary));
  const timeText = renderAligned(TIME_HEAD, timingBody(summary));
  console.log('\nAccuracy:\n' + accText);
  console.log('\nTiming (ms per utterance, mean/median):\n' + timeText + '\n');

  if (args.jsonl) console.error(`[bench] wrote ${args.jsonl}`);
  if (args.md) {
    const md = [
      '# Parakeet web benchmark',
      '',
      `Manifest: \`${args.manifest}\` (${entries.length} utterances)  `,
      `Model: \`${dir}\` (${args.quant})`,
      '',
      '## Accuracy',
      '',
      renderMarkdown(ACC_HEAD, accuracyBody(summary)),
      '',
      '## Timing (ms per utterance, mean/median)',
      '',
      renderMarkdown(TIME_HEAD, timingBody(summary)),
      '',
      '_Built with Claude Code._',
      '',
    ].join('\n');
    writeFileSync(args.md, md);
    console.error(`[bench] wrote ${args.md}`);
  }
}

main().catch((e) => {
  process.stderr.write('\n');
  console.error(`[bench] error: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
