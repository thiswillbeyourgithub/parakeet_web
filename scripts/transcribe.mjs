#!/usr/bin/env node
// CLI transcription harness for testing the in-browser Parakeet pipeline from
// the terminal. It reuses the project's own modules unchanged (parakeet.js,
// mel.js, tokenizer.js, bpeEncoder.js, phraseBoost.js) so the transcript and the
// phrase-boosting behaviour match what the web app produces; only the runtime
// glue is different:
//   - ONNX Runtime: the vendored onnxruntime-web *Node* build (WASM backend),
//     so no native binary and the same engine family as production. We bypass
//     the browser-only backend.js / ParakeetModel.fromUrls() path and construct
//     ParakeetModel directly with sessions we create here.
//   - Audio decode: ffmpeg (any format -> 16 kHz mono float32 PCM).
//   - File loading: a tiny global fetch() shim lets tokenizer.fromUrl() and
//     loadBpeEncoder() read local files, so we reuse them verbatim.
//
// Use it to feed a tricky recording through the model and compare runs with and
// without phrase boosting, e.g.:
//   node scripts/transcribe.mjs tricky.mp3 --phrase-boost="venlafaxine:5,truc:-5"
//   node scripts/transcribe.mjs tricky.mp3 --phrase-boost=./phrases.txt --beam-width=4
//   node scripts/transcribe.mjs tricky.mp3 --beam-width=8 --maes-expansion-gamma=3.0
//
// Built with Claude Code.

import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import * as ortmod from '../app/ui/vendor/onnxruntime-web/dist/ort.node.min.mjs';
import { ParakeetModel } from '../app/src/parakeet.js';
import { ParakeetTokenizer } from '../app/src/tokenizer.js';
import { JsPreprocessor } from '../app/src/mel.js';
import { loadBpeEncoder } from '../app/src/bpeEncoder.js';
import { BoostingTrie, peelTrailingNumber, DEFAULT_BOOST_TOPK } from '../app/src/phraseBoost.js';
import { getModelConfig, DEFAULT_MODEL, listModels } from '../app/src/models.js';

const ort = ortmod.default || ortmod;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BPE_MERGES = resolve(ROOT, 'app/ui/public/tokenizer/bpe-merges.json');

// --- tiny local-file fetch() shim ----------------------------------------
// tokenizer.js / bpeEncoder.js fetch their assets. In Node we point them at
// local paths and return a real Response so .text()/.json() work unchanged.
const _realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https?:/.test(u)) return _realFetch(url, opts);
  const p = u.startsWith('file://') ? fileURLToPath(u) : u;
  try {
    return new Response(await readFile(p), { status: 200 });
  } catch (e) {
    return new Response(null, { status: 404, statusText: e.message });
  }
};

// --- arg parsing ----------------------------------------------------------
function parseArgs(argv) {
  const a = {
    audio: null,
    boosts: [],            // raw --phrase-boost strings or file paths (repeatable)
    strength: 1,
    beamWidth: 1,          // 1 = greedy; >1 = MAES beam search
    maesNumSteps: 2,       // MAES: max symbols emitted per frame
    maesExpansionBeta: 2,  // MAES: over-generate top-(beamWidth+beta) tokens
    maesExpansionGamma: 2.3, // MAES: log-prob prune threshold
    model: DEFAULT_MODEL,
    modelDir: null,
    quant: 'int8',
    threads: 0,            // 0 => ORT default
    timestamps: false,
    json: false,
    verbose: false,
    ffmpeg: null,
  };
  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${name}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inlineVal = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = (name) => { if (inlineVal !== null) return inlineVal; i++; return need(i - 1, name); };
    switch (flag) {
      case '-h': case '--help': printHelp(); process.exit(0); break;
      case '-b': case '--phrase-boost': a.boosts.push(val(flag)); break;
      case '-s': case '--boost-strength': a.strength = Number(val(flag)); break;
      case '-w': case '--beam-width': a.beamWidth = parseInt(val(flag), 10); break;
      case '--maes-num-steps': a.maesNumSteps = parseInt(val(flag), 10); break;
      case '--maes-expansion-beta': a.maesExpansionBeta = parseInt(val(flag), 10); break;
      case '--maes-expansion-gamma': a.maesExpansionGamma = Number(val(flag)); break;
      case '--model': a.model = val(flag); break;
      case '--model-dir': a.modelDir = val(flag); break;
      case '--quant': a.quant = val(flag); break;
      case '--threads': a.threads = parseInt(val(flag), 10); break;
      case '--ffmpeg': a.ffmpeg = val(flag); break;
      case '--timestamps': a.timestamps = true; break;
      case '--json': a.json = true; break;
      case '-v': case '--verbose': a.verbose = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (a.audio) throw new Error(`Unexpected extra argument: ${arg}`);
        a.audio = arg;
    }
  }
  if (!a.audio) throw new Error('No audio file given. See --help.');
  if (a.quant !== 'int8' && a.quant !== 'fp32') throw new Error(`--quant must be int8 or fp32 (got ${a.quant})`);
  if (!Number.isFinite(a.strength)) throw new Error('--boost-strength must be a number');
  if (!Number.isInteger(a.beamWidth) || a.beamWidth < 1 || a.beamWidth > 25) throw new Error('--beam-width must be an integer in [1, 25]');
  if (!Number.isInteger(a.maesNumSteps) || a.maesNumSteps < 1) throw new Error('--maes-num-steps must be an integer >= 1');
  if (!Number.isInteger(a.maesExpansionBeta) || a.maesExpansionBeta < 0) throw new Error('--maes-expansion-beta must be an integer >= 0');
  if (!Number.isFinite(a.maesExpansionGamma) || a.maesExpansionGamma <= 0) throw new Error('--maes-expansion-gamma must be a positive number');
  return a;
}

function printHelp() {
  console.log(`Transcribe an audio file with the Parakeet web pipeline (Node + WASM).

Usage:
  node scripts/transcribe.mjs <audio> [options]

Arguments:
  <audio>                  Path to an audio file (any format ffmpeg can read).

Options:
  -b, --phrase-boost STR   Boost phrases as "phrase:WEIGHT" or "phrase:WEIGHT:TOPK"
                           entries, comma- or newline-separated, OR a path to a
                           text file holding such phrases (one per line is fine).
                           Repeatable; the argument is treated as a file when it
                           resolves to an existing file, otherwise as inline
                           phrases. WEIGHT defaults to 1 and may be any real
                           number for testing (negative values suppress a
                           phrase); the web UI clamps weights to a nonzero
                           [-10, 10] but this CLI does not, so you can probe the
                           full range. TOPK is the per-phrase top-k gate (a token
                           is only boosted when its raw logit is already among the
                           model's top-TOPK; positive integer, default ${DEFAULT_BOOST_TOPK}).
                           Example: --phrase-boost="venlafaxine:5,truc:-5"
                           Example: --phrase-boost="venlafaxine:5:50"
                           Example: --phrase-boost=./phrases.txt
  -s, --boost-strength N   Global boost-strength multiplier (UI slider). Default 1.
                           0 disables boosting entirely.
  -w, --beam-width N       Beam search width (integer in [1, 25]). 1 = greedy (default,
                           fastest). >1 runs MAES (Modified Adaptive Expansion
                           Search): width is the global beam cap, but the gamma
                           threshold below makes the effective width adapt per
                           token, so confident tokens stay near-greedy speed and
                           only ambiguous ones widen the search.
      --maes-num-steps N   MAES: max symbols emitted per encoder frame (integer
                           >= 1). Default 2. Only used when --beam-width > 1.
      --maes-expansion-beta N
                           MAES: over-generation budget; expands the top
                           (beamWidth + N) tokens per hypothesis (integer >= 0).
                           Default 2. Only used when --beam-width > 1.
      --maes-expansion-gamma F
                           MAES: log-prob prune threshold (positive float).
                           Expansions more than F below the best candidate are
                           dropped; smaller = more aggressive pruning / faster,
                           larger = wider search. Default 2.3. Only used when
                           --beam-width > 1.
      --model KEY          Model key (${listModels().join(', ')}).
                           Default: ${DEFAULT_MODEL}.
      --model-dir DIR      Directory holding the .onnx files + vocab.txt.
                           Defaults to the HuggingFace cache for the model.
      --quant int8|fp32    Encoder/decoder quantisation. Default int8.
      --threads N          WASM thread count (default: ORT chooses).
      --timestamps         Include word timestamps and confidences in output.
      --json               Print the full result object as JSON.
      --ffmpeg PATH        ffmpeg binary to use (else auto-detected).
  -v, --verbose            Verbose model + per-stage timing logs.
  -h, --help               Show this help.
`);
}

// --- phrase-boost parsing -------------------------------------------------
// A spec is either inline phrases or a path to a text file of phrases. When the
// (trimmed) spec resolves to an existing file we read it and treat its contents
// as the phrase text; otherwise the spec itself is the phrase text.
function expandBoostSpec(spec) {
  const trimmed = spec.trim();
  if (trimmed && existsSync(trimmed) && statSync(trimmed).isFile()) {
    return readFileSync(trimmed, 'utf-8');
  }
  return spec;
}

// Supports the same "phrase:WEIGHT" and "phrase:WEIGHT:TOPK" suffixes as the web
// app, reusing parseBoostPhrases' own right-to-left peelTrailingNumber so the
// field-splitting stays identical. The deliberate differences: this CLI also
// accepts comma separators and does NOT clamp the weight, so negative / >10
// values can be probed here (the web app clamps to a nonzero [-10, 10]). top-k
// must still be a positive integer for the trie's gate, so it is validated.
function parseCliBoosts(specs) {
  const entries = [];
  for (const spec of specs.map(expandBoostSpec)) {
    for (const part of spec.split(/[,\n]/)) {
      const t = part.trim();
      if (!t) continue;
      let phrase = t;
      let weight = 1;
      let topk = DEFAULT_BOOST_TOPK;
      const last = peelTrailingNumber(t);
      if (last) {
        const prev = peelTrailingNumber(last.head);
        if (prev) {            // phrase:WEIGHT:TOPK (prev = weight, last = topk)
          phrase = prev.head;
          weight = prev.value;
          topk = last.value;
        } else {               // phrase:WEIGHT
          phrase = last.head;
          weight = last.value;
        }
      }
      if (!Number.isInteger(topk) || topk < 1) {
        console.error(`[transcribe] warning: top-k ${topk} invalid (integer >= 1); using ${DEFAULT_BOOST_TOPK} for "${phrase}"`);
        topk = DEFAULT_BOOST_TOPK;
      }
      if (phrase) entries.push({ phrase, weight, topk });
    }
  }
  return entries;
}

// --- model file resolution ------------------------------------------------
function resolveModelDir(cliDir, repoId) {
  if (cliDir) {
    if (!existsSync(cliDir)) throw new Error(`--model-dir not found: ${cliDir}`);
    return cliDir;
  }
  // HuggingFace cache layout: models--<owner>--<name>/snapshots/<sha>/
  const cacheRoot = process.env.HF_HOME
    ? join(process.env.HF_HOME, 'hub')
    : join(homedir(), '.cache', 'huggingface', 'hub');
  const repoDir = join(cacheRoot, 'models--' + repoId.replaceAll('/', '--'), 'snapshots');
  if (!existsSync(repoDir)) {
    throw new Error(
      `No cached model found for ${repoId} at ${repoDir}.\n` +
      `Download it first (e.g. open the web app once, or huggingface-cli download ${repoId}), ` +
      `or pass --model-dir.`,
    );
  }
  const snaps = readdirSync(repoDir).map((d) => join(repoDir, d)).filter((d) => existsSync(d));
  // Pick the first snapshot that actually contains a vocab.txt.
  const snap = snaps.find((d) => existsSync(join(d, 'vocab.txt'))) || snaps[0];
  if (!snap) throw new Error(`No snapshot dirs under ${repoDir}`);
  return snap;
}

function resolveFiles(dir, quant) {
  const enc = quant === 'int8' ? 'encoder-model.int8.onnx' : 'encoder-model.onnx';
  const dec = quant === 'int8' ? 'decoder_joint-model.int8.onnx' : 'decoder_joint-model.onnx';
  const vocab = 'vocab.txt';
  for (const f of [enc, dec, vocab]) {
    if (!existsSync(join(dir, f))) {
      throw new Error(`Missing ${f} in model dir ${dir}`);
    }
  }
  return {
    encoderPath: join(dir, enc),
    decoderPath: join(dir, dec),
    vocabPath: join(dir, vocab),
  };
}

// Create an ORT session from a model file. For fp32 encoders with external
// weights (encoder-model.onnx.data), pass the sidecar via externalData so the
// WASM runtime can resolve the tensors it references.
async function createSession(modelPath, opts) {
  const buf = await readFile(modelPath);
  const sessionOpts = { ...opts };
  const dataPath = modelPath + '.data';
  if (existsSync(dataPath)) {
    sessionOpts.externalData = [{ path: basename(dataPath), data: await readFile(dataPath) }];
  }
  return ort.InferenceSession.create(buf, sessionOpts);
}

// --- audio decode ---------------------------------------------------------
function findFfmpeg(explicit) {
  const candidates = (explicit
    ? [explicit]
    : [process.env.FFMPEG, 'ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  ).filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { stdio: 'ignore' });
    if (!r.error && r.status === 0) return c;
  }
  throw new Error(
    `No working ffmpeg found (tried: ${candidates.join(', ')}). ` +
    `Pass --ffmpeg <path> or set the FFMPEG env var.`,
  );
}

function decodePcm(ffmpeg, file) {
  return new Promise((res, rej) => {
    const proc = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', file,
      '-ac', '1', '-ar', '16000', '-f', 'f32le', '-',
    ]);
    const chunks = [];
    const errBuf = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => errBuf.push(d));
    proc.on('error', rej);
    proc.on('close', (code) => {
      if (code !== 0) {
        return rej(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errBuf).toString().trim()}`));
      }
      const buf = Buffer.concat(chunks);
      const samples = Math.floor(buf.byteLength / 4);
      // Copy into a fresh, 4-byte-aligned buffer before viewing as float32.
      res(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + samples * 4)));
    });
  });
}

// --- main -----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cfg = getModelConfig(args.model);
  if (!cfg) throw new Error(`Unknown model "${args.model}". Known: ${listModels().join(', ')}`);

  const dir = resolveModelDir(args.modelDir, cfg.repoId);
  const { encoderPath, decoderPath, vocabPath } = resolveFiles(dir, args.quant);
  console.error(`[transcribe] model: ${args.model} (${args.quant})`);
  console.error(`[transcribe] dir:   ${dir}`);

  // ORT WASM config.
  if (args.threads > 0) ort.env.wasm.numThreads = args.threads;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = args.verbose ? 'verbose' : 'error';

  const ffmpeg = findFfmpeg(args.ffmpeg);
  console.error(`[transcribe] ffmpeg: ${ffmpeg}`);

  // Load everything in parallel: audio, sessions, tokenizer.
  const tDecodeStart = Date.now();
  const [pcm, encoderSession, joinerSession, tokenizer] = await Promise.all([
    decodePcm(ffmpeg, args.audio),
    createSession(encoderPath, { executionProviders: ['wasm'], logSeverityLevel: args.verbose ? 0 : 3 }),
    createSession(decoderPath, { executionProviders: ['wasm'], logSeverityLevel: args.verbose ? 0 : 3 }),
    ParakeetTokenizer.fromUrl(vocabPath),
  ]);
  const audioSec = pcm.length / 16000;
  console.error(`[transcribe] audio:  ${audioSec.toFixed(2)}s, ${pcm.length} samples (loaded in ${((Date.now() - tDecodeStart) / 1000).toFixed(1)}s)`);

  const preprocessor = new JsPreprocessor({ nMels: cfg.featuresSize });
  const model = new ParakeetModel({
    tokenizer,
    encoderSession,
    joinerSession,
    preprocessor,
    ort,
    subsampling: cfg.subsampling,
    windowStride: 0.01,
    verbose: args.verbose,
  });

  // Build the phrase-boosting trie (inert when no phrases were given).
  let phraseBoost = null;
  const entries = parseCliBoosts(args.boosts);
  if (entries.length) {
    const encoder = await loadBpeEncoder(tokenizer, BPE_MERGES);
    phraseBoost = BoostingTrie.buildFromPhrases(entries, encoder, { strength: args.strength });
    phraseBoost.strength = args.strength;
    console.error(`[transcribe] phrase boost: ${phraseBoost.size} phrase(s), strength ${args.strength}`);
    for (const { phrase, weight, topk } of entries) {
      console.error(`             - "${phrase}" (weight ${weight}, top-k ${topk})  -> [${encoder.encode(phrase).join(', ')}]`);
    }
    if (phraseBoost.skipped.length) {
      console.error(`[transcribe] skipped (out-of-vocab, cannot be matched): ${phraseBoost.skipped.join(', ')}`);
    }
    if (phraseBoost.isEmpty) phraseBoost = null;
  }

  if (args.beamWidth > 1) {
    console.error(`[transcribe] MAES beam search: width ${args.beamWidth}, num-steps ${args.maesNumSteps}, expansion-beta ${args.maesExpansionBeta}, expansion-gamma ${args.maesExpansionGamma}`);
  }

  const result = await model.transcribe(pcm, 16000, {
    phraseBoost,
    beamWidth: args.beamWidth,
    maesNumSteps: args.maesNumSteps,
    maesExpansionBeta: args.maesExpansionBeta,
    maesExpansionGamma: args.maesExpansionGamma,
    returnTimestamps: args.timestamps,
    returnConfidences: args.timestamps,
    debug: args.verbose,
  });

  model.dispose();

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.utterance_text);
  }
}

main().catch((e) => {
  console.error(`\n[transcribe] error: ${e.message}`);
  process.exit(1);
});
