#!/usr/bin/env node
// Grid-search WER benchmark for the Parakeet web pipeline over NeMo manifest(s).
//
// It reuses parakeet_web's own decoding code unchanged (the exact model +
// phrase-boosting trie the web app / scripts/transcribe.mjs build) so the
// transcripts, beam search and phrase boosting match production. Only the
// harness around it is new: it loops one or more NeMo jsonl manifests,
// transcribes each utterance, and reports word error rate (WER) and Levenshtein
// distance against the manifest's reference text. No audio preprocessing is done
// beyond ffmpeg decode to 16 kHz mono float32 (same as transcribe.mjs).
//
// The point is to measure how much the decoding knobs move WER, so it SWEEPS a
// grid: quant x beam-width x (no-boost baseline + each boost strength x each
// boost depth-scaling x each boost min-p) and prints one row per combination in
// the accuracy table (quant/beam/boost knobs + corpus WER %, CER %, RTF and the
// per-dataset decode-time-to-audio-length ratio "decode/aud"),
// followed by a top-5-by-CER and a top-5-by-WER shortlist. --quant takes a
// comma-separated list (e.g. "int8,fp16,fp32"); each quant is the OUTER sweep
// dimension, loaded once with its own model + encoder cache (the encoder output
// is quant-specific). --decoder-quants takes a comma-separated list too and is
// swept as an INNER dimension nested under each encoder quant: the encoder output
// is cached per encoder quant and reused across every decoder quant beneath it, so
// a decoder sweep pays only a model reload + the cheap decode, never a re-encode.
// The heavy encoder can stay int8 while the small decoder_joint is varied (default
// int8). The min-p axis overrides the per-phrase boost gate, so one
// prebuilt trie is reused across every min-p value (no re-encode per value);
// depth-scaling, by contrast, is baked into the trie at build time, so each value
// rebuilds the trie (one per strength x depth-scaling, per quant).
// Rows are sorted by the cell's corpus-level (micro-averaged) CER by default, or
// WER with --sort-by wer (best first). It APPENDS those tables to a .md file
// (successive runs accumulate, separated by a dated rule) and writes every
// per-sample/per-run record (including the full per-utterance WER spread and
// per-phase timings) to a JSON Lines file.
//
// --manifest is repeatable: pass it several times to run the SAME grid over
// several datasets at once. Each manifest is one "dataset" (named after its file
// basename) and the accuracy table breaks every grid cell down per dataset,
// plus an "overall" row pooling all utterances when more than one is given. This
// is how you check that a phrase boost tuned for one domain does not degrade WER
// on unrelated data.
//
// Audio is decoded once and cached across every row (decode is quant- and
// knob-independent), and the encoder output is cached too WITHIN a quant: for a
// given quant only the decoding (beam width / phrase boost) changes between grid
// cells, so each utterance is run through preprocessing + the encoder a single
// time per quant (model.encode()) and that cacheable result is decoded once per
// cell. Since the encoder dominates runtime, this makes a multi-cell sweep
// roughly as fast as one full pass per quant plus the (cheap) extra decodes. The
// encoder cache resets when a new ENCODER quant's model is loaded (the encoder
// output is encoder-quant-specific) and is reused across every decoder quant nested
// under that encoder quant. The reported preproc/encode timings are the shared one-time
// cost; the per-cell wall time / RTF reflect just the decode work (the encoder is
// amortized away).
//
// Example (two datasets at once):
//   node grid_search_benchmark.mjs \
//     --manifest ./perso/oli_spoken_dataset/nemo_manifest_ordered_uncapitaliazedDCI.json \
//     --manifest ./perso/general_dataset/nemo_manifest.json \
//     --audio-root "$NEMO_ROOT" \
//     --model-dir  ./perso/onnx_export \
//     --beam-width 1,2,4 \
//     --phrase-boost ./phrase_boosting/medical.txt \
//     --boost-strength 1,2 \
//     --boost-minp 0.01,0.05,0.1
//
// This script lives in parakeet_web/scripts/, so it imports the reusable
// helpers from its sibling transcribe.mjs by default. Set PARAKEET_WEB (or
// --parakeet-web DIR) to point at a different parakeet_web checkout.
//
// Built with Claude Code.

import { readFileSync, existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, isAbsolute, join, dirname, basename } from 'node:path';
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
    manifests: [],          // repeatable: each is one dataset
    audioRoot: process.cwd(),
    parakeetWeb: process.env.PARAKEET_WEB || DEFAULT_PARAKEET_WEB,
    model: null,            // null => loadParakeetModel uses its DEFAULT_MODEL
    modelDir: null,
    quants: ['int8'],       // swept dimension: one model load per quant (encoder
                            // output is quant-specific, so its cache resets per quant)
    decoderQuants: ['int8'], // swept dimension (nested under each encoder quant):
                            // decoder_joint quant(s), chosen independently of the
                            // swept encoder quant(s) (default int8: matches fp32
                            // quality here while being smaller and faster)
    ort: null,              // null => auto per quant: 'wasm' for int8, 'node' for fp16/fp32
    beamWidths: [1],        // swept dimension
    strengths: [1],         // swept dimension (only used when --phrase-boost given)
    minps: [null],          // swept dimension: min-p gate override (null = each phrase's baked min-p)
    depthScalings: [null],  // swept dimension: trie depth-scaling (null = trie's built-in default)
    boosts: [],             // --phrase-boost specs (repeatable); inline / .txt / .pwc
    noBaseline: false,      // drop the no-boost row from the sweep
    maesNumSteps: 2,
    maesExpansionBeta: 2,
    maesExpansionGamma: 2.3,
    frameStride: 1,
    threads: 0,
    limit: 0,               // 0 => all utterances
    sortBy: 'cer',          // rank the final table by corpus 'cer' or 'wer'
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
  const strList = (s) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inlineVal = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = (name) => { if (inlineVal !== null) return inlineVal; i++; return need(i - 1, name); };
    switch (flag) {
      case '-h': case '--help': printHelp(); process.exit(0); break;
      case '--manifest': a.manifests.push(val(flag)); break;
      case '--audio-root': a.audioRoot = val(flag); break;
      case '--parakeet-web': a.parakeetWeb = val(flag); break;
      case '--model': a.model = val(flag); break;
      case '--model-dir': a.modelDir = val(flag); break;
      case '--quant': a.quants = strList(val(flag)); break;
      case '--decoder-quants': a.decoderQuants = strList(val(flag)); break;
      case '--ort': a.ort = val(flag); break;
      // Sugar for --ort cuda: force the NVIDIA GPU (native onnxruntime-node CUDA
      // EP) for every swept quant. Default is CPU (auto per quant).
      case '--cuda': a.ort = 'cuda'; break;
      case '-w': case '--beam-width': a.beamWidths = numList(val(flag)); break;
      case '-s': case '--boost-strength': a.strengths = numList(val(flag)); break;
      case '--boost-minp': a.minps = numList(val(flag)); break;
      case '--depth-scaling': a.depthScalings = numList(val(flag)); break;
      case '-b': case '--phrase-boost': a.boosts.push(val(flag)); break;
      case '--no-baseline': a.noBaseline = true; break;
      case '--maes-num-steps': a.maesNumSteps = parseInt(val(flag), 10); break;
      case '--maes-expansion-beta': a.maesExpansionBeta = parseInt(val(flag), 10); break;
      case '--maes-expansion-gamma': a.maesExpansionGamma = Number(val(flag)); break;
      case '--frame-stride': a.frameStride = parseInt(val(flag), 10); break;
      case '--threads': a.threads = parseInt(val(flag), 10); break;
      case '--limit': a.limit = parseInt(val(flag), 10); break;
      case '--sort-by': a.sortBy = val(flag).toLowerCase(); break;
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
  if (!a.manifests.length) throw new Error('No --manifest given. See --help.');
  if (a.sortBy !== 'wer' && a.sortBy !== 'cer') throw new Error(`--sort-by must be wer or cer (got ${a.sortBy})`);
  // --quant is a swept dimension: a comma-separated list (e.g. "int8,fp16,fp32")
  // benchmarks each quant in turn (one model load + encoder-cache reset apiece).
  // Dedupe while preserving order so a repeated quant can't collide on its
  // resume key or waste a re-run.
  if (!a.quants.length) throw new Error('--quant must be a comma-separated list of int8/fp16/fp32');
  for (const q of a.quants) {
    if (q !== 'int8' && q !== 'fp16' && q !== 'fp32') throw new Error(`--quant must be int8, fp16 or fp32 (got ${q})`);
  }
  a.quants = [...new Set(a.quants)];
  // --decoder-quants is a swept dimension nested under each encoder --quant: a
  // comma-separated list of decoder_joint quant(s), each applied in turn to every
  // cell, chosen independently of the swept encoder quant(s). Dedupe while
  // preserving order like --quant so a repeated value can't collide on its resume
  // key or waste a re-run.
  if (!a.decoderQuants.length) throw new Error('--decoder-quants must be a comma-separated list of int8/fp16/fp32');
  for (const q of a.decoderQuants) {
    if (q !== 'int8' && q !== 'fp16' && q !== 'fp32') throw new Error(`--decoder-quants must be int8, fp16 or fp32 (got ${q})`);
  }
  a.decoderQuants = [...new Set(a.decoderQuants)];
  // ORT backend: the WASM EP reads every weight file into a Node Buffer (capped
  // at 2 GiB per readFile) and has no fp16 CPU kernels, so the single-sidecar
  // fp32 encoder and any fp16 model can only load on the native onnxruntime-node
  // backend (it resolves external data from disk, no buffering). When --ort is
  // left to auto (null) the backend is picked PER quant at load time
  // (ortForQuant): node for fp16/fp32, wasm for int8. An explicit --ort (incl.
  // cuda, which runs the native CUDA EP on the GPU) applies to every quant.
  if (a.ort !== null && a.ort !== 'wasm' && a.ort !== 'node' && a.ort !== 'cuda') throw new Error(`--ort must be wasm, node or cuda (got ${a.ort})`);
  if (!a.beamWidths.length || a.beamWidths.some((w) => !Number.isInteger(w) || w < 1 || w > 25)) {
    throw new Error('--beam-width must be a comma-separated list of integers in [1, 25]');
  }
  if (!a.strengths.length || a.strengths.some((s) => !Number.isFinite(s))) {
    throw new Error('--boost-strength must be a comma-separated list of numbers');
  }
  if (!a.minps.length || a.minps.some((p) => p !== null && (!Number.isFinite(p) || p <= 0 || p > 1))) {
    throw new Error('--boost-minp must be a comma-separated list of numbers in (0, 1]');
  }
  if (!a.depthScalings.length || a.depthScalings.some((d) => d !== null && (!Number.isFinite(d) || d < 0))) {
    throw new Error('--depth-scaling must be a comma-separated list of numbers >= 0 (0 = flat, no per-depth growth)');
  }
  if (!Number.isInteger(a.frameStride) || a.frameStride < 1 || a.frameStride > 4) {
    throw new Error('--frame-stride must be an integer in [1, 4]');
  }
  return a;
}

function printHelp() {
  console.log(`Grid-search the Parakeet web pipeline (WER + Levenshtein) over NeMo manifest(s).

Usage:
  node grid_search_benchmark.mjs --manifest <file.json> [options]

Required:
  --manifest FILE          NeMo jsonl manifest. One JSON object per line with
                           "audio_filepath" and "text" (reference). "duration"
                           is read for reporting if present. Repeatable: pass it
                           several times to run the same grid over several
                           datasets at once. Each manifest is one "dataset"
                           (named after its file basename, or use "label=FILE" to
                           name it explicitly) and the accuracy table breaks
                           every grid cell down per dataset, plus an "overall"
                           row pooling all utterances when more than one is
                           given. --limit applies per manifest.

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
  --quant LIST             Encoder/decoder quantisation(s) to benchmark, a
                           comma-separated list of int8/fp16/fp32 (e.g.
                           "int8,fp16,fp32"). Default int8. Each quant is an OUTER
                           sweep dimension: the grid (beam x boost) runs once per
                           quant, loading that quant's model and resetting the
                           encoder cache (the encoder output is quant-specific).
                           The accuracy table gains a "quant" column. fp16 files
                           come from parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/quantize-fp16.py
                           (~1.2 GB encoder, near-lossless vs fp32; native CPU upcasts to fp32 for
                           compute, a faithful proxy for WebGPU fp16 quality).
  --decoder-quants LIST    DECODER/joiner quantisation(s) to benchmark, a
                           comma-separated list of int8/fp16/fp32 (e.g.
                           "int8,fp32"). Default fp32. A swept dimension nested
                           INSIDE each encoder --quant: the encoder output is cached
                           per encoder quant and reused across every decoder quant
                           beneath it, so sweeping the decoder pays only a model
                           reload + the cheap decode (never a re-encode). The fused
                           decoder_joint model is small (~70 MB fp32), so full
                           precision is cheap and avoids the int8 joiner's quality
                           loss while the encoder stays quantised; this repo has no
                           standalone joint graph, so this knob covers the decoder
                           and joint networks together. The accuracy table gains a
                           "dec" column. The chosen ORT backend follows the ENCODER
                           quant (int8 -> wasm, fp16/fp32 -> node); an fp16 decoder
                           there upcasts to fp32 for compute (faithful fp16-quality
                           proxy). Folded into the resume key only when it differs
                           from a cell's encoder quant (matched runs keep their old
                           key).
      --ort BACKEND        ORT runtime: wasm, node (native CPU) or cuda (NVIDIA
                           GPU via the native onnxruntime-node CUDA EP; needs
                           CUDA 12 + cuDNN 9 on the loader path, and FAILS loudly
                           if the CUDA library can't load). Default: auto per quant
                           (wasm for int8, node for fp16/fp32). The WASM EP reads
                           each weight file into a <2 GiB Node Buffer and has no
                           fp16 CPU kernels, so the
                           single-sidecar fp32 encoder ("File size > 2 GiB") and
                           any fp16 model need the native node backend, which
                           streams external data from disk. wasm can still load
                           fp32 if the model dir is pre-sharded
                           (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/shard-fp32.py,
                           each shard <2 GB). An explicit --ort applies to every
                           swept quant.
      --cuda               Sugar for --ort cuda: run every quant on the NVIDIA GPU
                           (native onnxruntime-node CUDA EP). Default is CPU. The
                           load fails loudly if the CUDA library can't load; once
                           it runs, confirm the GPU is actually in use via VRAM.

Decoding sweep (each is a comma-separated list; the grid is their product):
  -w, --beam-width LIST    Beam widths to test, e.g. "1,2,4,8". 1 = greedy.
                           Default 1.
  -b, --phrase-boost SPEC  Phrase-boost source: inline "phrase:WEIGHT:MINP:FLAG"
                           text, a .txt list, or a precompiled .pwc. Repeatable;
                           all specs are merged into one boost set. When given,
                           the sweep adds one row per --boost-strength (plus a
                           no-boost baseline row unless --no-baseline).
  -s, --boost-strength LIST  Boost-strength multipliers to test, e.g. "1,2".
                           Only used when --phrase-boost is set. Default 1.
      --boost-minp LIST    Per-phrase min-p gate values to sweep, e.g.
                           "0.01,0.05,0.1" (each in (0, 1]). Overrides the gate
                           baked into every boost phrase, so one trie is swept
                           across all values (cheap: no re-encode per value).
                           A token is only boosted when it is at least min-p
                           times as likely as the model's top candidate for that
                           step; lower = looser (more recall, more risk of
                           hallucinating the phrase), higher = stricter. Only used
                           when --phrase-boost is set. Default: each phrase's own
                           baked min-p (no override).
      --depth-scaling LIST  Trie depth-scaling factors to sweep, e.g. "0,0.5,1".
                           The per-token boost at trie depth d is
                           weight*(1 + depth-scaling*(d-1)), so this controls how
                           much deeper (more committed) matches are rewarded:
                           0 = flat (every depth gets the base weight, least
                           "inertia"), higher = stronger pull to complete a
                           started phrase. Unlike min-p this is baked into the
                           trie at build time, so each value rebuilds the trie
                           (one per strength x depth-scaling). Only used when
                           --phrase-boost is set. Default: the trie's built-in
                           default (no override).
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
      --limit N            Only the first N entries of EACH manifest (quick smoke
                           test).
      --sort-by cer|wer    Rank the final table (best config first) by the
                           word/char-weighted corpus CER or WER of each cell's
                           overall row, the same figure shown in the CER %/WER %
                           column. Default cer (smoother, lower-variance signal
                           than WER between close boost strengths). The
                           multi-dataset overall is the micro-average (summed
                           edits / summed refs), so each dataset is weighted by
                           its size, not averaged.
      --jsonl FILE         Write results as JSON Lines (one object per line):
                           a "utterance" record per sample (tagged with its
                           dataset, with per-phase timings) and a "summary"
                           record per run (with the overall corpus WER plus the
                           mean/median/stdev of the per-utterance WER, a
                           per-dataset breakdown, and the mean/median of each
                           phase). Default benchmark_results.jsonl.
      --md FILE            APPEND the summary tables (accuracy, top-5-by-CER,
                           top-5-by-WER) as markdown; successive runs accumulate
                           in the file, separated by a dated rule. Default
                           benchmark_results.md.
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
// A --manifest value is either a plain path, or "label=path" to give the dataset
// a readable name (handy when the file itself is generically named, e.g.
// .../fleurs/fr/validation.altered.json). The label must contain no path
// separator so a real path is never mistaken for "label=path".
function parseManifestSpec(spec) {
  const eq = spec.indexOf('=');
  if (eq > 0) {
    const label = spec.slice(0, eq);
    const path = spec.slice(eq + 1);
    if (path && !label.includes('/') && !label.includes('\\')) return { label, path };
  }
  return { label: null, path: spec };
}

// Name a dataset: an explicit "label=" wins, else the manifest's file basename
// (without extension), so the per-dataset rows are readable. Collisions get a
// "#2" suffix so two datasets that would share a name stay distinct.
function datasetNameFor(manifestPath, used, explicit) {
  let name = explicit || basename(manifestPath).replace(/\.[^.]*$/, '') || manifestPath;
  if (used.has(name)) { let n = 2; while (used.has(`${name}#${n}`)) n++; name = `${name}#${n}`; }
  used.add(name);
  return name;
}

// Load one or more NeMo manifests into a single flat list of entries, each
// tagged with its dataset name so per-dataset WER can be reported. Each spec is
// a path or "label=path" (see parseManifestSpec). --limit applies per manifest.
// Returns { entries, datasetNames } where datasetNames is in manifest
// (command-line) order.
function loadManifests(manifestSpecs, audioRoot, limit) {
  const entries = [];
  const datasetNames = [];
  const used = new Set();
  for (const spec of manifestSpecs) {
    const { label, path: manifestPath } = parseManifestSpec(spec);
    const dataset = datasetNameFor(manifestPath, used, label);
    datasetNames.push(dataset);
    const raw = readFileSync(manifestPath, 'utf-8');
    let lineNo = 0, count = 0;
    for (const line of raw.split('\n')) {
      lineNo++;
      const t = line.trim();
      if (!t) continue;
      let obj;
      try {
        obj = JSON.parse(t);
      } catch (e) {
        throw new Error(`manifest ${manifestPath} line ${lineNo}: invalid JSON (${e.message})`);
      }
      const audioField = obj.audio_filepath ?? obj.audio_path ?? obj.wav ?? obj.audio;
      const text = obj.text ?? obj.transcript ?? obj.reference;
      if (!audioField) throw new Error(`manifest ${manifestPath} line ${lineNo}: missing audio_filepath`);
      if (text === undefined) throw new Error(`manifest ${manifestPath} line ${lineNo}: missing text`);
      const audioPath = isAbsolute(audioField) ? audioField : resolve(audioRoot, audioField);
      entries.push({ audioPath, text, duration: obj.duration, dataset });
      count++;
      if (limit && count >= limit) break;
    }
  }
  return { entries, datasetNames };
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

// --- per-dataset accuracy accumulation ------------------------------------
// The name of the synthetic row that pools every dataset's utterances. Only
// emitted when more than one dataset is benchmarked.
const OVERALL = 'overall';

// A running tally of word/char edits + per-utterance WER samples for one dataset
// within one grid cell. mean/median/stdev are computed over werSamples; the
// corpus WER/CER come from the edit/ref totals. decodeMs / audioSec accumulate
// this dataset's total decode time and audio length so the table can show the
// decode-time-to-audio-length ratio (how the beam width moves decode speed).
function newAcc() {
  return { refWords: 0, hypWords: 0, wordEdits: 0, refChars: 0, charEdits: 0, werSamples: [], decodeMs: 0, audioSec: 0 };
}
// decodeMs / audioSec default to 0 so the pure scoring tests (which pass only a
// score object) keep working; live/resume callers pass the real timings.
function addScore(acc, sc, decodeMs = 0, audioSec = 0) {
  acc.refWords += sc.refWords; acc.hypWords += sc.hypWords; acc.wordEdits += sc.wordEdits;
  acc.refChars += sc.refChars; acc.charEdits += sc.charEdits;
  acc.werSamples.push(pct(sc.wordEdits, sc.refWords));
  acc.decodeMs += decodeMs; acc.audioSec += audioSec;
}

// Turn a name->accumulator map into the ordered list of dataset rows the tables
// consume. Follows datasetNames order; appends an "overall" row pooling every
// dataset when there is more than one (so single-dataset output is unchanged
// apart from naming the lone dataset).
function buildDatasets(perDs, datasetNames) {
  const datasets = datasetNames.filter((name) => perDs.has(name)).map((name) => ({ name, ...perDs.get(name) }));
  if (datasets.length > 1) {
    const all = { name: OVERALL, ...newAcc() };
    for (const d of datasets) {
      all.refWords += d.refWords; all.hypWords += d.hypWords; all.wordEdits += d.wordEdits;
      all.refChars += d.refChars; all.charEdits += d.charEdits;
      all.werSamples.push(...d.werSamples);
      all.decodeMs += d.decodeMs; all.audioSec += d.audioSec;
    }
    datasets.push(all);
  }
  return datasets;
}

// The dataset row that represents a whole grid cell for sorting/summary: the
// "overall" pool when multiple datasets, else the single dataset.
function repDataset(row) { return row.datasets[row.datasets.length - 1]; }

// The corpus (word/char-weighted, i.e. micro-averaged) WER or CER for a whole
// grid cell, read off its representative (overall) row. Because it divides
// summed edits by summed refs, datasets contribute in proportion to their
// word/char counts. This is the figure the final table is ranked by; metric is
// 'wer' or 'cer'.
function cellRate(row, metric) {
  const d = repDataset(row);
  return metric === 'cer' ? pct(d.charEdits, d.refChars) : pct(d.wordEdits, d.refWords);
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

// "done/total bar pct% ETA". ETA is the caller-supplied estimate when given
// (etaMs), else a flat elapsed/done extrapolation. The flat form assumes a
// uniform pace, which is fine within a single run but wrong across the whole
// grid (see makeEtaEstimator), so the grid-level bar passes an EMA estimate.
function progress(done, total, elapsedMs, etaMs) {
  const frac = total > 0 ? done / total : 0;
  const eta = etaMs !== undefined ? etaMs
    : done > 0 ? (elapsedMs / done) * (total - done) : NaN;
  return `${bar(frac)} ${done}/${total} ${(frac * 100).toFixed(0).padStart(3)}% ETA ${fmtDuration(eta)}`;
}

// tqdm-style stacked progress: build the bytes that redraw a multi-line "live
// region" in place on a TTY. `prevCount` is how many lines the region drew last
// time; we move the cursor up that many lines to the top of the block, then for
// each new line clear it (\x1b[2K) and rewrite from column 0 (\r). The cursor
// ends on a fresh line BELOW the block, so the next redraw moves up again (no
// accumulation) and a permanent log line printed after a `commit` lands under
// it. The line count is assumed stable while a block is live (callers reset
// prevCount to 0 to commit a block to scrollback before starting a new one), so
// this does not need to erase leftover lines when the count shrinks. Pure, so
// it is unit-testable without a real terminal; non-TTY callers skip it (ANSI
// cursor moves would only litter a piped log / CI file).
function renderLiveRegion(lines, prevCount) {
  const up = prevCount > 0 ? `\x1b[${prevCount}A` : '';
  const body = lines.map((l) => `\x1b[2K\r${l}`).join('\n');
  return `${up}${body}\n`;
}

// How fast the grid ETA forgets old steps (EMA smoothing factor in (0, 1]):
// 0.2 keeps the estimate responsive to the last ~5 steps while still smoothing
// per-utterance noise. Higher = more weight on the most recent steps.
const ETA_EMA_ALPHA = 0.2;

// Build a stateful ETA estimator for the WHOLE grid. A flat elapsed/done average
// badly mis-estimates here because the per-utterance cost is NOT uniform across
// the sweep: the first cell pays the one-time preprocess+encode for every
// utterance (afterwards encCache serves it for free), and later cells change the
// beam width, so the pace swings cell to cell. A flat average stays anchored to
// the slow early cells long after the pace has moved on. Instead we keep an
// exponential moving average of the per-step duration, so the ETA tracks the
// CURRENT pace and weights the last few iterations most. Seed `startTime` with
// the grid start so the very first step already yields an estimate. Returns a
// function (now, remaining) -> estimated ms left (NaN until the first step).
function makeEtaEstimator(alpha = ETA_EMA_ALPHA, startTime = null) {
  let ema = NaN;     // smoothed ms-per-step
  let last = startTime; // timestamp of the previous step (or the seed start)
  return (now, remaining) => {
    if (last !== null) {
      const dt = Math.max(0, now - last);
      ema = Number.isNaN(ema) ? dt : alpha * dt + (1 - alpha) * ema;
    }
    last = now;
    return Number.isNaN(ema) ? NaN : ema * remaining;
  };
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

// Accuracy table: one block per run (grid combination), expanded into one row
// per dataset (plus an "overall" row pooling all utterances when more than one
// dataset). Blocks are sorted by the cell's corpus-level (micro-averaged) CER or
// WER (see --sort-by) ascending so the best config is at the top, and a cell's
// dataset rows stay grouped together. "WER %" / "CER %" are the corpus-level
// rates (total word/char edits / total refs); "RTF" is the cell's mean
// real-time factor (decode work only; the encoder is amortized away). "decode/aud"
// is the per-DATASET ratio of total decode time to total audio length (decode
// seconds per second of audio, i.e. the standard-convention RTF for the decode
// phase only) so the beam width's impact on decode speed is visible. The
// per-utterance WER spread (mean/median/stdev) and the raw edit/ref counts are
// dropped from the table to keep it readable; they remain in the JSONL records.
const ACC_HEAD = ['beam', 'quant', 'dec', 'boost', 'strength', 'minp', 'dscale', 'dataset', 'WER %', 'CER %', 'RTF', 'decode/aud'];
// RTF is a per-cell figure (same across a cell's dataset rows); guard the timings
// lookup so synthetic rows (unit tests) without a timings field render "-".
function cellRtf(r) {
  return r.timings && r.timings.rtf && r.timings.rtf.length ? mean(r.timings.rtf).toFixed(2) : '-';
}
// Per-DATASET decode-time-to-audio-length ratio (decode seconds / audio seconds):
// summed decode_ms divided by summed audio seconds for one dataset row. Renders
// "-" when the audio length is unknown (synthetic rows / pre-audioSec records),
// matching how RTF guards its absent timings.
function datasetDecAud(d) {
  return d.audioSec > 0 ? ((d.decodeMs / 1000) / d.audioSec).toFixed(3) : '-';
}
function accuracyBody(rows) {
  const body = [];
  for (const r of rows) {
    const rtf = cellRtf(r);
    for (const d of r.datasets) {
      body.push([
        String(r.beamWidth),
        r.quant == null ? '-' : String(r.quant),
        r.decoderQuant == null ? '-' : String(r.decoderQuant),
        r.boostLabel,
        r.strength == null ? '-' : String(r.strength),
        r.minp == null ? '-' : String(r.minp),
        r.depthScaling == null ? '-' : String(r.depthScaling),
        d.name,
        pct(d.wordEdits, d.refWords).toFixed(2),
        pct(d.charEdits, d.refChars).toFixed(2),
        rtf,
        datasetDecAud(d),
      ]);
    }
  }
  return body;
}

// Top-N table: one row per grid cell (no per-dataset expansion), using the
// cell's representative (overall when multi-dataset, else the single dataset)
// row. Same columns as the accuracy table so the renderers stay shared.
function topBody(rows) {
  return rows.map((r) => {
    const d = repDataset(r);
    return [
      String(r.beamWidth),
      r.quant == null ? '-' : String(r.quant),
      r.decoderQuant == null ? '-' : String(r.decoderQuant),
      r.boostLabel,
      r.strength == null ? '-' : String(r.strength),
      r.minp == null ? '-' : String(r.minp),
      r.depthScaling == null ? '-' : String(r.depthScaling),
      d.name,
      pct(d.wordEdits, d.refWords).toFixed(2),
      pct(d.charEdits, d.refChars).toFixed(2),
      cellRtf(r),
      datasetDecAud(d),
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

  const { entries, datasetNames } = loadManifests(args.manifests, args.audioRoot, args.limit);
  console.error(`[bench] ${args.manifests.length} manifest(s) / ${datasetNames.length} dataset(s): ${datasetNames.join(', ')} (${entries.length} utterances total)`);
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

  // The model is NOT loaded up front: --quant is a swept dimension, so each quant
  // is loaded inside the grid loop (one model + its own tokenizer per quant).
  // ORT backend per quant: auto picks node for fp16/fp32 (no WASM fp16 kernels /
  // >2 GiB single-file fp32) and wasm for int8; an explicit --ort overrides all.
  const ortForQuant = (quant) => args.ort ?? (quant === 'int8' ? 'wasm' : 'node');

  // Build the boost dimension of the sweep as quant-INDEPENDENT descriptors (the
  // trie itself is built later, per quant, from that quant's tokenizer):
  //   - always a no-boost baseline (unless --no-baseline AND boosts given), and
  //   - when --phrase-boost is set, one descriptor per (strength, depth-scaling,
  //     min-p) combination.
  const hasBoost = args.boosts.length > 0;
  // Content hash of the boost sources, folded into the boost cells' resume key.
  const bDigest = boostDigest(args.boosts);
  const boostDescriptors = [];
  if (!hasBoost || !args.noBaseline) {
    boostDescriptors.push({ label: 'none', strength: null, minp: null, depthScaling: null, boostDigest: null });
  }
  if (hasBoost) {
    for (const strength of args.strengths) {
      for (const depthScaling of args.depthScalings) {
        // depth-scaling is baked into each node's bonus at insert time (unlike
        // min-p, which is a decode-time gate), so each (strength, depth-scaling)
        // pair needs its OWN trie; min-p is then swept over that one trie for free.
        for (const minp of args.minps) {
          boostDescriptors.push({ label: 'boost', strength, minp, depthScaling, boostDigest: bDigest });
        }
      }
    }
  }

  // The full grid: encoder quants x decoder quants x beam widths x boost
  // descriptors. Encoder quant is the OUTER dimension (each needs its own model
  // load + encoder-quant-specific output cache); decoder quant is nested directly
  // under it (it reloads the model but reuses the cached encoder outputs); beam/
  // boost are the cheap inner sweep.
  const grid = [];
  for (const quant of args.quants) {
    for (const decoderQuant of args.decoderQuants) {
      for (const beamWidth of args.beamWidths) {
        for (const bc of boostDescriptors) grid.push({ quant, decoderQuant, beamWidth, ...bc });
      }
    }
  }
  const minpNote = hasBoost && args.minps.some((p) => p !== null) ? ` (min-p sweep: ${args.minps.map((p) => p ?? 'baked').join(', ')})` : '';
  const depthNote = hasBoost && args.depthScalings.some((d) => d !== null) ? ` (depth-scaling sweep: ${args.depthScalings.map((d) => d ?? 'default').join(', ')})` : '';
  console.error(`[bench] sweep: ${args.quants.length} encoder quant(s) [${args.quants.join(', ')}] x ${args.decoderQuants.length} decoder quant(s) [${args.decoderQuants.join(', ')}] x ${args.beamWidths.length} beam width(s) x ${boostDescriptors.length} boost config(s) = ${grid.length} run(s) over ${entries.length} utterances each${minpNote}${depthNote}\n`);

  // Decode each audio once and cache the PCM across all grid rows (only the
  // decoding changes between rows, never the audio). For very large datasets
  // this trades memory for not re-running ffmpeg per row.
  const pcmCache = new Map();
  async function getPcm(p) {
    let pcm = pcmCache.get(p);
    if (!pcm) { pcm = await decodePcm(ffmpeg, p); pcmCache.set(p, pcm); }
    return pcm;
  }

  // The currently-loaded model (set per encoder/decoder quant inside the grid loop)
  // and its encoder-output cache. Encode each audio once and cache the encoder
  // output (preprocessing + the encoder), the single most expensive stage. Within
  // one encoder quant it depends only on the audio, never on the decode knobs OR the
  // decoder quant, so the same cached result is decoded by every grid cell of that
  // encoder quant (passed back via opts.encoded). model.encode() returns plain JS
  // memory (no live ORT tensors), so caching it is leak-free. The encoder output IS
  // encoder-quant-specific, so encCache is reset whenever a new ENCODER quant is
  // entered (below) and reused across every decoder quant nested under it. Like
  // pcmCache this trades memory for speed; the PCM is kept too (transcribe() still
  // reads its length for RTF) and the PCM cache is shared across quants (decode is
  // quant-independent).
  let model = null;
  let encCache = new Map();
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
    const minpPart = row.minp == null ? '' : '~' + row.minp;
    // null depth-scaling appends nothing, so a sweep without --depth-scaling
    // keeps the same resume key as before (existing jsonl stays reusable).
    const depthPart = row.depthScaling == null ? '' : '^' + row.depthScaling;
    // int8 (the default) appends nothing too, so an int8-only sweep keeps the
    // same resume key as before this multi-quant change; fp16/fp32 always carry
    // their quant so cells never collide across quants.
    const quantPart = row.quant === 'int8' ? '' : ' quant=' + row.quant;
    // Append the decoder quant ONLY when it differs from this cell's encoder quant:
    // that is exactly the historical "decoder matches encoder" case, so matched
    // runs keep their old resume key (pre-decoder-quant jsonl stays reusable), while
    // a mismatched decoder (e.g. the int8-encoder/fp32-decoder default, or any swept
    // decoder quant) gets a distinct key so it never falsely reuses a cell decoded
    // with a different decoder.
    const decPart = row.decoderQuant === row.quant ? '' : ' dec=' + row.decoderQuant;
    return `beam=${row.beamWidth} ${boostPart}${row.strength == null ? '' : '@' + row.strength}${minpPart}${depthPart}${quantPart}${decPart}`;
  };

  // Reconstruct a summary row (the shape the final tables consume) from a
  // completed run's records read back from the JSONL, so resumed cells render
  // identically to freshly-run ones. The per-dataset breakdown is rebuilt from
  // each utterance record's "dataset" tag (encountered order), which keeps
  // resume correct even across format tweaks. Pre-multi-dataset records have no
  // tag; they fold into a single unnamed dataset.
  const rowFromRecords = (utts, s) => {
    const timings = { rtf: [] };
    for (const [key] of PHASES) timings[key] = [];
    const perDs = new Map();
    const order = [];
    for (const u of utts) {
      const name = u.dataset ?? '(dataset)';
      if (!perDs.has(name)) { perDs.set(name, newAcc()); order.push(name); }
      const m = u.metrics || {};
      // Audio length for the decode/audio ratio: prefer the recorded audioSec,
      // else recover it from rtf*total_ms (rtf = audio/total, so the product is
      // the audio seconds) for pre-audioSec records, else fall back to duration.
      const audioSec = Number.isFinite(u.audioSec) ? u.audioSec
        : (Number.isFinite(m.rtf) && Number.isFinite(m.total_ms)) ? (m.rtf * m.total_ms) / 1000
        : (Number.isFinite(u.duration) ? u.duration : 0);
      addScore(perDs.get(name), {
        refWords: u.refWords || 0, hypWords: u.hypWords || 0, wordEdits: u.wordEdits || 0,
        refChars: u.refChars || 0, charEdits: u.charEdits || 0,
      }, m.decode_ms ?? 0, audioSec);
      for (const [key] of PHASES) timings[key].push(m[key] ?? 0);
      timings.rtf.push(m.rtf ?? 0);
    }
    // Pre-multi-quant summary records have no "quant" field; they were always
    // int8 cells (whose tag carries no quant), so default to int8 on read-back.
    // Pre-decoder-quant records have no "decoderQuant"; back then the decoder
    // matched the encoder, so default to this run's encoder quant on read-back.
    return { beamWidth: s.beam, quant: s.quant ?? 'int8', decoderQuant: s.decoderQuant ?? s.quant ?? 'int8',
      boostLabel: s.boost, strength: s.strength, minp: s.minp ?? null,
      depthScaling: s.depthScaling ?? null,
      timeMs: s.wall_ms || 0, timings, datasets: buildDatasets(perDs, order) };
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
  // EMA-smoothed grid ETA (seeded at the grid start) so the estimate follows the
  // changing per-utterance pace across cells instead of a flat average.
  const gridEta = makeEtaEstimator(ETA_EMA_ALPHA, gridT0);

  // Two stacked progress bars (tqdm-style): line 1 = the current run's
  // utterances, line 2 = the whole grid. On a TTY we redraw both in place via
  // renderLiveRegion (cursor addressing); on a non-TTY (piped log / CI) we fall
  // back to the old single \r line so ANSI cursor moves don't litter the file.
  const isTty = !!process.stderr.isTTY;
  let liveLineCount = 0;
  const drawProgress = (runLine, gridLine) => {
    if (isTty) {
      process.stderr.write(renderLiveRegion([runLine, gridLine], liveLineCount));
      liveLineCount = 2;
    } else {
      process.stderr.write(`\r${runLine}  |  ${gridLine}   `);
    }
  };
  // Commit the live region to scrollback so the next permanent log line lands
  // below it and the next run starts a fresh block. On a TTY the cursor is
  // already below the block (renderLiveRegion's trailing newline), so we just
  // stop tracking it; on a non-TTY we end the rewritten \r line with a newline.
  const commitProgress = () => {
    if (!isTty) process.stderr.write('\n');
    liveLineCount = 0;
  };

  // Model dir captured from the first (encoder, decoder) pair actually loaded (same
  // dir for every pair; null only if every cell was resumed and nothing was loaded).
  let loadedDir = null;
  let gi = 0; // 0-based index over pending cells, across every quant-pair group

  // The model-load order: encoder quant is MAJOR, decoder quant is MINOR (nested
  // under it). Iterating these (encoder, decoder) pairs in encoder-major order lets
  // the encoder-output cache and the boost tries (both encoder-quant-specific) be
  // reset once when the encoder quant changes and then reused across every decoder
  // quant beneath it: the decoder sweep reloads the model but never re-encodes.
  const quantPairs = [];
  for (const encQuant of args.quants) for (const decQuant of args.decoderQuants) quantPairs.push([encQuant, decQuant]);

  let prevEncQuant = null; // encoder quant of the previous loaded pair
  let trieByKey = null;    // boost tries for the current encoder quant (rebuilt on change)
  for (const [encQuant, decQuant] of quantPairs) {
    const cells = pending.filter((cell) => cell.quant === encQuant && cell.decoderQuant === decQuant);
    if (!cells.length) continue; // all this pair's cells resumed -> don't load

    // Entering a new encoder quant: the cached encoder outputs and boost tries (both
    // encoder-quant-specific) are stale, so drop them. Same encoder quant, new
    // decoder quant: keep both (the encoder output and tokenizer are unchanged).
    if (encQuant !== prevEncQuant) {
      encCache = new Map();
      trieByKey = null;
      prevEncQuant = encQuant;
    }

    const ortBackend = ortForQuant(encQuant);
    const loaded = await loadParakeetModel({
      model: args.model ?? undefined,
      modelDir: args.modelDir,
      quant: encQuant,
      decoderQuant: decQuant,
      ortBackend,
      threads: args.threads,
      verbose: args.verbose,
    });
    model = loaded.model;
    const tokenizer = loaded.tokenizer;
    if (!loadedDir) loadedDir = loaded.dir;
    console.error(`[bench] model dir: ${loaded.dir} (enc ${encQuant} / dec ${decQuant}, ${ortBackend})`);

    // Build one trie per (strength, depth-scaling) from the tokenizer. The vocab is
    // shared across quants, so build the tries ONCE per encoder quant (lazily, on the
    // first decoder quant that loads a model) and reuse across the decoder sweep.
    // min-p is swept over the shared trie per cell at decode time, so all min-p cells
    // reuse it.
    if (hasBoost && !trieByKey) {
      trieByKey = new Map();
      for (const strength of args.strengths) {
        for (const depthScaling of args.depthScalings) {
          const phraseBoost = await buildPhraseBoost({
            boosts: args.boosts,
            strength,
            depthScaling: depthScaling ?? undefined, // null => trie's built-in default
            tokenizer,
            quiet: !args.verbose,
            verbose: args.verbose,
          });
          if (!phraseBoost) {
            console.error(`[bench] warning: phrase-boost produced an empty trie (no in-vocab phrases); treating strength ${strength} as no-boost.`);
          }
          trieByKey.set(`${strength}|${depthScaling}`, phraseBoost ?? null);
        }
      }
    }
    for (const cell of cells) {
      cell.phraseBoost = cell.label === 'boost'
        ? (trieByKey?.get(`${cell.strength}|${cell.depthScaling}`) ?? null)
        : null;
    }

    for (const row of cells) {
      const tag = tagOf(row);
      // Apply this cell's min-p gate override to the shared per-strength trie
      // (null restores the phrases' baked min-p). Cells run sequentially, so
      // mutating the shared trie here is safe and avoids re-encoding per value.
      if (row.phraseBoost) row.phraseBoost.minpOverride = row.minp ?? null;
      // Per-dataset accuracy tallies for this run (keyed by dataset name).
      const perDs = new Map();
      const ensureDs = (name) => { let acc = perDs.get(name); if (!acc) { acc = newAcc(); perDs.set(name, acc); } return acc; };
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
        // Actual decoded audio length (the PCM is the ground truth; the manifest's
        // "duration" may be missing or rounded). Used for the decode/audio ratio.
        const audioSec = pcm.length / 16000;
        const refNorm = normalizeText(e.text, args.stripAccents);
        const hypNorm = normalizeText(hyp, args.stripAccents);
        const sc = score(refNorm, hypNorm);
        addScore(ensureDs(e.dataset), sc, metrics.decode_ms ?? 0, audioSec);
        // Accumulate per-phase timings for this run's mean/median.
        for (const [key] of PHASES) timings[key].push(metrics[key] ?? 0);
        timings.rtf.push(metrics.rtf ?? 0);
        writeJsonl({
          type: 'utterance', run: tag,
          beam: row.beamWidth, quant: row.quant, decoderQuant: row.decoderQuant, boost: row.label, strength: row.strength, minp: row.minp ?? null,
          depthScaling: row.depthScaling ?? null,
          dataset: e.dataset,
          audio: e.audioPath, duration: e.duration, audioSec: +audioSec.toFixed(3),
          ref: e.text, hyp, refNorm, hypNorm,
          wordEdits: sc.wordEdits, refWords: sc.refWords,
          charEdits: sc.charEdits, refChars: sc.refChars,
          metrics,
        });
        // Two stacked progress bars: this run, then the whole grid (one line
        // each on a TTY; folded onto one \r line when piped).
        doneUtts++;
        const now = Date.now();
        const runP = progress(i + 1, entries.length, now - t0);
        const gridP = progress(doneUtts, totalUtts, now - gridT0, gridEta(now, totalUtts - doneUtts));
        drawProgress(
          `[bench] run ${gi + 1}/${pending.length} ${tag}  ${runP}`,
          `[bench] all runs  ${gridP}`,
        );
      }
      const timeMs = Date.now() - t0;
      commitProgress();
      const datasets = buildDatasets(perDs, datasetNames);
      const r = { beamWidth: row.beamWidth, quant: row.quant, decoderQuant: row.decoderQuant, boostLabel: row.label, strength: row.strength, minp: row.minp ?? null,
        depthScaling: row.depthScaling ?? null, timeMs, timings, datasets };
      summaryByTag.set(tag, r);
      // The "overall" pool (or the single dataset) supplies the top-level corpus
      // figures; the per-dataset breakdown is listed under "datasets".
      const overall = repDataset(r);
      const dsSummary = (d) => ({
        name: d.name,
        utterances: d.werSamples.length,
        wer_pct: +pct(d.wordEdits, d.refWords).toFixed(4),
        wer_mean_pct: +mean(d.werSamples).toFixed(4),
        wer_median_pct: +median(d.werSamples).toFixed(4),
        wer_stdev_pct: +stdev(d.werSamples).toFixed(4),
        cer_pct: +pct(d.charEdits, d.refChars).toFixed(4),
        wordEdits: d.wordEdits, refWords: d.refWords, charEdits: d.charEdits, refChars: d.refChars,
        decode_ms: +d.decodeMs.toFixed(1), audio_sec: +d.audioSec.toFixed(3),
        decode_audio_ratio: d.audioSec > 0 ? +((d.decodeMs / 1000) / d.audioSec).toFixed(4) : null,
      });
      writeJsonl({
        type: 'summary', run: tag,
        beam: row.beamWidth, quant: row.quant, decoderQuant: row.decoderQuant, boost: row.label, strength: row.strength, minp: row.minp ?? null,
        depthScaling: row.depthScaling ?? null,
        utterances: entries.length,
        wer_pct: +pct(overall.wordEdits, overall.refWords).toFixed(4),
        wer_mean_pct: +mean(overall.werSamples).toFixed(4),
        wer_median_pct: +median(overall.werSamples).toFixed(4),
        wer_stdev_pct: +stdev(overall.werSamples).toFixed(4),
        cer_pct: +pct(overall.charEdits, overall.refChars).toFixed(4),
        wordEdits: overall.wordEdits, refWords: overall.refWords, charEdits: overall.charEdits, refChars: overall.refChars,
        datasets: datasets.map(dsSummary),
        wall_ms: timeMs,
        timing_ms: phaseStats(timings),
      });
      const perDsLog = datasets.length > 1
        ? '  [' + datasets.filter((d) => d.name !== OVERALL).map((d) => `${d.name} ${pct(d.wordEdits, d.refWords).toFixed(2)}%`).join(', ') + ']'
        : '';
      console.error(`[bench] -> WER ${pct(overall.wordEdits, overall.refWords).toFixed(2)}%  CER ${pct(overall.charEdits, overall.refChars).toFixed(2)}%${perDsLog}  (${(timeMs / 1000).toFixed(1)}s)`);
      gi++;
    }

    // Free this (encoder, decoder) pair's sessions before loading the next pair's
    // model. The encoder-output cache (encCache) survives so the next decoder quant
    // of the same encoder quant reuses it.
    model.dispose();
    model = null;
  }

  // Emit every cell (resumed + freshly run), sorted ascending by the cell's
  // word/char-weighted corpus CER (default) or WER (--sort-by wer) so the
  // best-scoring config lands at the top of both tables. This is the same
  // micro-averaged figure shown in the CER %/WER % column (summed edits / summed
  // refs), so the ranking matches the headline number AND the multi-dataset
  // overall weights each dataset by its size rather than averaging the two
  // rates; a cell's per-dataset rows stay grouped under it.
  const summary = grid.map((cell) => summaryByTag.get(tagOf(cell))).filter(Boolean);
  summary.sort((a, b) => cellRate(a, args.sortBy) - cellRate(b, args.sortBy));

  // The five best cells by each corpus-level (micro-averaged) rate, ranked off
  // their representative (overall) row, independent of --sort-by.
  const top5 = (metric) => [...summary].sort((a, b) => cellRate(a, metric) - cellRate(b, metric)).slice(0, 5);
  const topCer = top5('cer');
  const topWer = top5('wer');

  // Final tables: the full accuracy table plus a top-5-by-CER and top-5-by-WER
  // shortlist (one row per cell, using the overall figures).
  console.log('\nAccuracy:\n' + renderAligned(ACC_HEAD, accuracyBody(summary)));
  console.log('\nTop 5 by CER (overall):\n' + renderAligned(ACC_HEAD, topBody(topCer)));
  console.log('\nTop 5 by WER (overall):\n' + renderAligned(ACC_HEAD, topBody(topWer)) + '\n');

  if (args.jsonl) console.error(`[bench] wrote ${args.jsonl}`);
  if (args.md) {
    // Append (don't overwrite) so successive runs accumulate in one file; a
    // dated separator keeps each run's tables distinguishable. A leading blank
    // line guarantees separation from any prior content.
    const md = [
      existsSync(args.md) && statSync(args.md).size > 0 ? '\n---\n' : '',
      `# Parakeet web grid-search benchmark (${new Date().toISOString()})`,
      '',
      `Dataset(s): ${datasetNames.map((n) => '`' + n + '`').join(', ')} (${entries.length} utterances total)  `,
      `Manifest(s): ${args.manifests.map((m) => '`' + m + '`').join(', ')}  `,
      `Model: \`${loadedDir ?? '(model not loaded; all cells resumed)'}\` (encoder quant(s): ${args.quants.join(', ')}; decoder quant(s): ${args.decoderQuants.join(', ')})`,
      '',
      '## Accuracy',
      '',
      renderMarkdown(ACC_HEAD, accuracyBody(summary)),
      '',
      '## Top 5 by CER (overall)',
      '',
      renderMarkdown(ACC_HEAD, topBody(topCer)),
      '',
      '## Top 5 by WER (overall)',
      '',
      renderMarkdown(ACC_HEAD, topBody(topWer)),
      '',
      '_Built with Claude Code._',
      '',
    ].join('\n');
    appendFileSync(args.md, md);
    console.error(`[bench] appended to ${args.md}`);
  }
}

// Run main() only when invoked as a script, so the pure helpers above can be
// imported (and unit-tested) without kicking off a benchmark.
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  main().catch((e) => {
    process.stderr.write('\n');
    console.error(`[bench] error: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
}

// Exported for unit testing the pure scoring / per-dataset aggregation logic.
export {
  normalizeText, score, parseManifestSpec, datasetNameFor, loadManifests,
  newAcc, addScore, buildDatasets, repDataset, cellRate,
  ACC_HEAD, accuracyBody, topBody, OVERALL,
  makeEtaEstimator, fmtDuration, renderLiveRegion,
};
