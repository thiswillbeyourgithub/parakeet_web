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
//   node scripts/transcribe.mjs tricky.mp3 --phrase-boost=./phrases.pwc  # precompiled
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
import { loadBpeEncoder, vocabSignature } from '../app/src/bpeEncoder.js';
import { BoostingTrie, parseBoostFields, parseBoostDirectives, expandAugmentations, isDirectiveLine, DEFAULT_BOOST_TOPK } from '../app/src/phraseBoost.js';
import { artifactMatchesVocab, readPwc } from '../app/src/boostCompile.js';
import { getModelConfig, DEFAULT_MODEL, listModels } from '../app/src/models.js';

const ort = ortmod.default || ortmod;

// Resolve the ORT module for the requested backend. 'wasm' (default) uses the
// vendored onnxruntime-web Node build, the same engine family as the browser,
// so the CLI and the tier-3 e2e behave identically. 'node' uses the native
// onnxruntime-node binding (a devDependency): same JS Tensor/InferenceSession
// API, so parakeet.js runs unchanged, but 64-bit memory, so it can load the
// fp16 (~1.2 GB) and fp32 (~2.4 GB external) encoders that overflow the 32-bit
// WASM heap. Native CPU upcasts fp16 to fp32 for compute, so it is a faithful
// proxy for fp16 *quality* (the WebGPU path users would actually hit), not for
// WASM memory limits. Lazy-imported so the default path never requires the
// native package.
async function getOrt(backend) {
  if (backend === 'node') {
    const m = await import('onnxruntime-node');
    return m.default || m;
  }
  return ort;
}

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
    maesPrefixAlpha: 1,    // MAES: prefix-search length gap (0 = off)
    frameStride: 1,        // sidebar: decimate encoder frames (1 = none)
    chunking: true,        // sidebar: split long audio into chunks
    chunkDuration: 60,     // sidebar: max chunk length, seconds
    overlap: 2,            // overlap between chunks, seconds (UI hardcodes 2)
    model: DEFAULT_MODEL,
    modelDir: null,
    quant: 'int8',
    ortBackend: 'wasm',
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
      case '--maes-prefix-alpha': a.maesPrefixAlpha = parseInt(val(flag), 10); break;
      case '--frame-stride': a.frameStride = parseInt(val(flag), 10); break;
      case '--chunk-duration': a.chunkDuration = Number(val(flag)); break;
      case '--overlap': a.overlap = Number(val(flag)); break;
      case '--no-chunking': a.chunking = false; break;
      case '--model': a.model = val(flag); break;
      case '--model-dir': a.modelDir = val(flag); break;
      case '--quant': a.quant = val(flag); break;
      case '--ort': a.ortBackend = val(flag); break;
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
  if (a.quant !== 'int8' && a.quant !== 'fp16' && a.quant !== 'fp32') throw new Error(`--quant must be int8, fp16 or fp32 (got ${a.quant})`);
  if (a.ortBackend !== 'wasm' && a.ortBackend !== 'node') throw new Error(`--ort must be wasm or node (got ${a.ortBackend})`);
  if (!Number.isFinite(a.strength)) throw new Error('--boost-strength must be a number');
  if (!Number.isInteger(a.beamWidth) || a.beamWidth < 1 || a.beamWidth > 25) throw new Error('--beam-width must be an integer in [1, 25]');
  if (!Number.isInteger(a.maesNumSteps) || a.maesNumSteps < 1) throw new Error('--maes-num-steps must be an integer >= 1');
  if (!Number.isInteger(a.maesExpansionBeta) || a.maesExpansionBeta < 0) throw new Error('--maes-expansion-beta must be an integer >= 0');
  if (!Number.isFinite(a.maesExpansionGamma) || a.maesExpansionGamma <= 0) throw new Error('--maes-expansion-gamma must be a positive number');
  if (!Number.isInteger(a.maesPrefixAlpha) || a.maesPrefixAlpha < 0) throw new Error('--maes-prefix-alpha must be an integer >= 0');
  if (!Number.isInteger(a.frameStride) || a.frameStride < 1 || a.frameStride > 4) throw new Error('--frame-stride must be an integer in [1, 4]');
  if (!Number.isFinite(a.chunkDuration) || a.chunkDuration <= 0) throw new Error('--chunk-duration must be a positive number');
  if (!Number.isFinite(a.overlap) || a.overlap < 0) throw new Error('--overlap must be a non-negative number');
  return a;
}

function printHelp() {
  console.log(`Transcribe an audio file with the Parakeet web pipeline (Node + WASM).

Usage:
  node scripts/transcribe.mjs <audio> [options]

Arguments:
  <audio>                  Path to an audio file (any format ffmpeg can read).

Options:
  -b, --phrase-boost STR   Boost phrases as "phrase:WEIGHT:TOPK:FLAG" entries
                           (every field after the phrase is optional), comma- or
                           newline-separated, OR a path to a text file holding
                           such phrases (one per line is fine). Repeatable; the
                           argument is treated as a file when it resolves to an
                           existing file, otherwise as inline phrases. WEIGHT
                           defaults to 1 and may be any real number for testing
                           (negative values suppress a phrase); the web UI clamps
                           weights to a nonzero [-10, 10] but this CLI does not,
                           so you can probe the full range. An empty WEIGHT keeps
                           the default ("phrase::40"). TOPK is the per-phrase
                           top-k gate (a token is only boosted when its raw logit
                           is already among the model's top-TOPK; positive
                           integer, default ${DEFAULT_BOOST_TOPK}). FLAG is "s"
                           (case-sensitive, default) or "i" (case-insensitive:
                           also boost the phrase's lower/UPPER/Title casings).
                           A path ending in .pwc is a precompiled list (see
                           scripts/compile-boost.mjs): its pre-encoded token ids
                           are reused with no re-encode, provided it was compiled
                           for this model (vocab signature must match).
                           Example: --phrase-boost="venlafaxine:5,truc:-5"
                           Example: --phrase-boost="venlafaxine:5:50:i"
                           Example: --phrase-boost=./phrases.txt
                           Example: --phrase-boost=./phrases.pwc
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
      --maes-prefix-alpha N
                           MAES: prefix-search recombination length gap (integer
                           >= 0). For a shorter hypothesis that is a prefix of a
                           longer one within N tokens, the longer one's score
                           absorbs the prefix's continuation probability. 0
                           disables it. Default 1. Only used when --beam-width > 1.
      --frame-stride N     Decimate encoder frames before decoding (integer in
                           [1, 4]). 1 = use every frame (default). Sidebar knob.
      --chunk-duration N   Max chunk length in seconds for long audio. Default
                           60. Long audio is split into overlapping chunks and
                           each chunk's transcript is printed as it is produced.
      --overlap N          Overlap between chunks in seconds. Default 2 (matches
                           the web UI).
      --no-chunking        Disable chunking; transcribe the whole file in one
                           pass (matches unticking the sidebar's chunking box).
      --model KEY          Model key (${listModels().join(', ')}).
                           Default: ${DEFAULT_MODEL}.
      --model-dir DIR      Directory holding the .onnx files + vocab.txt.
                           Defaults to the HuggingFace cache for the model.
      --quant int8|fp16|fp32
                           Encoder/decoder quantisation. Default int8. fp16 files
                           come from parakeet-tdt-0.6b-v3-smoothquant-onnx/quantize-fp16.py
                           (~1.2 GB encoder, near-lossless vs fp32).
      --ort wasm|node      ORT backend. Default wasm (onnxruntime-web, the engine
                           the browser/e2e use). node = native onnxruntime-node
                           (64-bit memory), required to load fp16/fp32 encoders
                           that overflow the 32-bit WASM heap.
      --threads N          WASM thread count (default: ORT chooses).
      --timestamps         Include word timestamps and confidences in output.
      --json               Print the full result object as JSON.
      --ffmpeg PATH        ffmpeg binary to use (else auto-detected).
  -v, --verbose            Verbose model + per-stage timing logs.
  -h, --help               Show this help.
`);
}

// --- phrase-boost parsing -------------------------------------------------
// A --phrase-boost spec is one of three things:
//   - a path to a precompiled .pwc artifact (scripts/compile-boost.mjs output):
//     pre-encoded token ids reused verbatim, no re-encode, once its vocab
//     signature is confirmed to match the loaded model (see main());
//   - a path to a .txt list of phrases; or
//   - inline phrase text.
// The .pwc case is detected by {@link isPwcPath} and handled separately in
// main(); the other two flow through {@link expandBoostSpec} + parseCliBoosts.

// True when the (trimmed) spec is an existing .pwc file. Kept narrow (extension
// + real file) so an inline phrase that merely ends in ".pwc" is not mistaken
// for an artifact path.
export function isPwcPath(spec) {
  const t = spec.trim();
  return /\.pwc$/i.test(t) && existsSync(t) && statSync(t).isFile();
}

// A non-.pwc spec is either inline phrases or a path to a text file of phrases.
// When the (trimmed) spec resolves to an existing file we read it and treat its
// contents as the phrase text; otherwise the spec itself is the phrase text.
//
// One hard guard: a spec that unambiguously names a file (ends in .txt or .pwc)
// MUST resolve to a real readable file. Without this, a mistyped boost path
// (e.g. medical.txt vs french_medical.txt, or a missing .pwc) silently fell
// through to "inline phrases", producing an empty/garbage trie and a no-op boost
// that looked like the feature simply had no effect. Spoken phrases to boost do
// not end in .txt/.pwc, so the extension is a safe signal of file intent.
export function expandBoostSpec(spec) {
  const trimmed = spec.trim();
  if (trimmed && existsSync(trimmed) && statSync(trimmed).isFile()) {
    return readFileSync(trimmed, 'utf-8');
  }
  if (/\.(txt|pwc)$/i.test(trimmed)) {
    throw new Error(
      `--phrase-boost file not found: ${trimmed}\n`
      + `A spec ending in .txt or .pwc is treated as a file path and must exist `
      + `(a non-existent file is NOT silently used as an inline phrase).`,
    );
  }
  return spec;
}

// Supports the same `phrase:WEIGHT:TOPK:AUG` suffixes as the web app, reusing
// parseBoostFields so the field-splitting (and the `:AUG` augmentation flag)
// stays identical. The deliberate differences: this CLI also accepts comma
// separators and does NOT clamp the weight, so negative / >10 values can be
// probed here (the web app clamps to a nonzero [-10, 10]). top-k must still be a
// positive integer for the trie's gate, so it is validated. Returns the phrases
// AS TYPED (one entry per line, `:AUG` flag preserved but not yet applied); the
// caller runs expandAugmentations to turn each flagged phrase into its surface
// branches for the trie, while keeping these typed phrases for display.
export function parseCliBoosts(specs) {
  const entries = [];
  for (const spec of specs.map(expandBoostSpec)) {
    for (const part of spec.split(/[,\n]/)) {
      const t = part.trim();
      if (!t) continue;
      if (isDirectiveLine(t)) continue; // list-level #! directive, not a phrase
      let { phrase, weight, topk, augment } = parseBoostFields(t);
      if (!Number.isInteger(topk) || topk < 1) {
        console.error(`[transcribe] warning: top-k ${topk} invalid (integer >= 1); using ${DEFAULT_BOOST_TOPK} for "${phrase}"`);
        topk = DEFAULT_BOOST_TOPK;
      }
      if (phrase) {
        const entry = { phrase, weight, topk };
        if (augment !== undefined) entry.augment = augment;
        entries.push(entry);
      }
    }
  }
  return entries;
}

// --- model file resolution ------------------------------------------------
export function resolveModelDir(cliDir, repoId) {
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

// Per-quant filename suffix. fp16 files are produced by parakeet-tdt-0.6b-v3-smoothquant-onnx/quantize-fp16.py
// from the fp32 pieces; fp32 is the plain name (with an external .onnx.data for
// the encoder); int8 is the onnxruntime-quantized variant shipped on HF.
const QUANT_SUFFIX = { int8: '.int8.onnx', fp16: '.fp16.onnx', fp32: '.onnx' };

export function resolveFiles(dir, quant) {
  const suffix = QUANT_SUFFIX[quant];
  if (!suffix) throw new Error(`Unknown quant "${quant}" (expected int8, fp16 or fp32)`);
  const enc = `encoder-model${suffix}`;
  const dec = `decoder_joint-model${suffix}`;
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

// Create an ORT session from a model file.
//   - Native ('node'): pass the file PATH so the binding resolves any external
//     encoder-model.onnx.data from disk itself, and we avoid reading multi-GB
//     weights into a JS Buffer (Node Buffers cap at 2 GB, which is exactly why
//     the fp32 encoder can't be buffered).
//   - WASM: the build can't read from disk, so it gets the bytes as a Buffer
//     plus an explicit externalData entry for the fp32 sidecar.
export async function createSession(modelPath, opts, { ortMod = ort, fromPath = false } = {}) {
  if (fromPath) {
    return ortMod.InferenceSession.create(modelPath, opts);
  }
  const buf = await readFile(modelPath);
  const sessionOpts = { ...opts };
  // External weights live either in a single <model>.data sidecar (the upstream
  // fp32 layout) or, for a sharded fp32 encoder (parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py), in
  // <model>.data.000, .001, ... each kept under 2 GB so no externalData buffer
  // trips the WASM ArrayBuffer / blob caps. Mount every matching file; the `path`
  // must equal the location string baked into the graph (the shard basename).
  const externalData = await collectExternalData(modelPath);
  if (externalData.length) sessionOpts.externalData = externalData;
  return ortMod.InferenceSession.create(buf, sessionOpts);
}

// Find the external-data file(s) sitting next to a model and read each into its
// own Buffer (every shard is < 2 GB by construction, so no single read hits the
// Node Buffer / WASM ArrayBuffer 2 GB wall). Returns ORT externalData entries
// [{ path, data }]; empty when the model has no external weights.
async function collectExternalData(modelPath) {
  const dir = dirname(modelPath);
  const stem = basename(modelPath);             // e.g. encoder-model.onnx
  const single = stem + '.data';                // encoder-model.onnx.data
  const shardRe = new RegExp(`^${stem.replace(/[.]/g, '\\.')}\\.data\\.\\d+$`);
  const names = readdirSync(dir)
    .filter((n) => n === single || shardRe.test(n))
    .sort();                                     // .data before .data.000; shards lexically ordered
  return Promise.all(
    names.map(async (n) => ({ path: n, data: await readFile(join(dir, n)) })),
  );
}

// --- audio decode ---------------------------------------------------------
export function findFfmpeg(explicit) {
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

export function decodePcm(ffmpeg, file) {
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

// --- reusable pipeline builders -------------------------------------------
// These are factored out of main() so other Node harnesses (e.g. a WER
// benchmark over a NeMo manifest) can construct the exact same model + boosting
// trie the CLI uses, without duplicating the glue. The CLI's main() below is a
// thin caller over them.

// Construct a ParakeetModel from a model key / local dir, mirroring the CLI's
// resolution and ORT-WASM configuration. Returns the model plus the resolved
// tokenizer, config and directory so callers can log or reuse them. The
// encoder/decoder ONNX sessions and tokenizer are loaded here; audio is NOT
// (decode per-file with decodePcm so one model can transcribe a whole dataset).
export async function loadParakeetModel({
  model: modelKey = DEFAULT_MODEL,
  modelDir = null,
  quant = 'int8',
  threads = 0,
  verbose = false,
  ortBackend = 'wasm',
} = {}) {
  const cfg = getModelConfig(modelKey);
  if (!cfg) throw new Error(`Unknown model "${modelKey}". Known: ${listModels().join(', ')}`);

  const dir = resolveModelDir(modelDir, cfg.repoId);
  const { encoderPath, decoderPath, vocabPath } = resolveFiles(dir, quant);

  const ortMod = await getOrt(ortBackend);
  const fromPath = ortBackend === 'node';
  const executionProviders = fromPath ? ['cpu'] : ['wasm'];

  if (ortBackend === 'wasm') {
    if (threads > 0) ortMod.env.wasm.numThreads = threads;
    ortMod.env.wasm.proxy = false;
  }
  ortMod.env.logLevel = verbose ? 'verbose' : 'error';

  const sessOpts = { executionProviders, logSeverityLevel: verbose ? 0 : 3 };
  const [encoderSession, joinerSession, tokenizer] = await Promise.all([
    createSession(encoderPath, sessOpts, { ortMod, fromPath }),
    createSession(decoderPath, sessOpts, { ortMod, fromPath }),
    ParakeetTokenizer.fromUrl(vocabPath),
  ]);

  const preprocessor = new JsPreprocessor({ nMels: cfg.featuresSize });
  const model = new ParakeetModel({
    tokenizer,
    encoderSession,
    joinerSession,
    preprocessor,
    ort: ortMod,
    subsampling: cfg.subsampling,
    windowStride: 0.01,
    verbose,
  });
  return { model, tokenizer, cfg, dir };
}

// Build the phrase-boosting trie (or null when no phrases were given) from the
// same `--phrase-boost` specs the CLI accepts: inline phrases, .txt files, and
// precompiled .pwc artifacts. `strength` is the UI slider multiplier. `quiet`
// suppresses the per-phrase listing (useful when sweeping many configs); the
// returned trie is identical either way. Reused by both the CLI and benchmarks
// so boosting behaviour can never diverge between them.
export async function buildPhraseBoost({ boosts = [], strength = 1, tokenizer, quiet = false, verbose = false }) {
  const pwcSpecs = boosts.filter(isPwcPath);
  const textSpecs = boosts.filter((s) => !isPwcPath(s));
  // `typedBoosts` are the phrases exactly as written (for display); `entries` is
  // the augmentation-expanded set actually inserted into the trie (a `:fap`
  // phrase becomes its Title/UPPER/prefixed branches). A list's own `#!augment`
  // / `#!prefixes` directives drive the default, exactly as in the web app; the
  // CLI default (no directive) is no augmentation. Per-phrase `:AUG` still wins.
  const typedBoosts = parseCliBoosts(textSpecs);
  const { augment, prefixes } = parseBoostDirectives(textSpecs.map(expandBoostSpec).join('\n'));
  const entries = expandAugmentations(typedBoosts, augment ?? '', prefixes);
  if (!entries.length && !pwcSpecs.length) return null;

  // The encoder is only needed to encode text/inline phrases; when every spec
  // is a precompiled .pwc we skip loading it and start from an empty trie.
  const encoder = entries.length ? await loadBpeEncoder(tokenizer, BPE_MERGES) : null;
  const phraseBoost = entries.length
    ? BoostingTrie.buildFromPhrases(entries, encoder, { strength })
    : new BoostingTrie({ strength });
  phraseBoost.strength = strength;

  // Precompiled .pwc lists: confirm the vocab signature matches the loaded
  // model (its ids would otherwise index a different vocab and be meaningless),
  // then insert the pre-encoded ids straight into the same trie.
  const sig = vocabSignature(tokenizer.id2token);
  for (const spec of pwcSpecs) {
    const path = spec.trim();
    let artifact;
    try {
      artifact = readPwc(path);
    } catch (e) {
      throw new Error(`failed to read .pwc ${path}: ${e.message}`);
    }
    if (!artifactMatchesVocab(artifact, sig)) {
      throw new Error(
        `.pwc ${path} was not compiled for this model (vocab signature mismatch); its token `
        + `ids would be meaningless. Recompile it: node scripts/compile-boost.mjs <list>.txt --model-dir <dir>`,
      );
    }
    for (const { ids, weight, topk } of artifact.encoded) {
      phraseBoost.insert(ids, weight ?? 1, topk ?? DEFAULT_BOOST_TOPK);
    }
    if (Array.isArray(artifact.skipped) && artifact.skipped.length) {
      phraseBoost.skipped = phraseBoost.skipped.concat(artifact.skipped);
    }
    if (!quiet) console.error(`[transcribe] reused precompiled ${path}: ${artifact.encoded.length} encoded phrase(s)`);
  }

  if (!quiet) {
    console.error(`[transcribe] phrase boost: ${phraseBoost.size} phrase(s), strength ${strength}`);
    // List the phrases AS TYPED, not their generated casing variants, and cap
    // the listing: it is handy for a handful of inline probes but floods the
    // terminal for a list of thousands. --verbose lifts the cap. (.pwc ids are
    // already summarised above.)
    const PHRASE_LIST_CAP = 20;
    const showAll = verbose || typedBoosts.length <= PHRASE_LIST_CAP;
    for (const { phrase, weight, topk } of (showAll ? typedBoosts : typedBoosts.slice(0, PHRASE_LIST_CAP))) {
      console.error(`             - "${phrase}" (weight ${weight}, top-k ${topk})  -> [${encoder.encode(phrase).join(', ')}]`);
    }
    if (!showAll) {
      console.error(`             ... and ${typedBoosts.length - PHRASE_LIST_CAP} more (pass --verbose to list all)`);
    }
    if (phraseBoost.skipped.length) {
      console.error(`[transcribe] skipped (out-of-vocab, cannot be matched): ${phraseBoost.skipped.join(', ')}`);
    }
  }
  if (phraseBoost.isEmpty) return null;
  return phraseBoost;
}

// --- main -----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { model, tokenizer, dir } = await loadParakeetModel({
    model: args.model,
    modelDir: args.modelDir,
    quant: args.quant,
    threads: args.threads,
    verbose: args.verbose,
    ortBackend: args.ortBackend,
  });
  console.error(`[transcribe] model: ${args.model} (${args.quant}, ort=${args.ortBackend})`);
  console.error(`[transcribe] dir:   ${dir}`);

  const ffmpeg = findFfmpeg(args.ffmpeg);
  console.error(`[transcribe] ffmpeg: ${ffmpeg}`);

  const tDecodeStart = Date.now();
  const pcm = await decodePcm(ffmpeg, args.audio);
  const audioSec = pcm.length / 16000;
  console.error(`[transcribe] audio:  ${audioSec.toFixed(2)}s, ${pcm.length} samples (loaded in ${((Date.now() - tDecodeStart) / 1000).toFixed(1)}s)`);

  const phraseBoost = await buildPhraseBoost({
    boosts: args.boosts,
    strength: args.strength,
    tokenizer,
    verbose: args.verbose,
  });

  if (args.beamWidth > 1) {
    console.error(`[transcribe] MAES beam search: width ${args.beamWidth}, num-steps ${args.maesNumSteps}, expansion-beta ${args.maesExpansionBeta}, expansion-gamma ${args.maesExpansionGamma}, prefix-alpha ${args.maesPrefixAlpha}`);
  }
  const willChunk = args.chunking && pcm.length > args.chunkDuration * 16000;
  if (willChunk) {
    console.error(`[transcribe] chunking: ${args.chunkDuration}s chunks, ${args.overlap}s overlap`);
  }

  // Same chunking/stitching path the web UI uses (ParakeetModel.transcribeChunked).
  // The onChunk callback streams each chunk's transcript to stdout as it lands.
  const result = await model.transcribeChunked(pcm, 16000, {
    enableChunking: args.chunking,
    chunkDurationSec: args.chunkDuration,
    overlapSec: args.overlap,
    phraseBoost,
    beamWidth: args.beamWidth,
    maesNumSteps: args.maesNumSteps,
    maesExpansionBeta: args.maesExpansionBeta,
    maesExpansionGamma: args.maesExpansionGamma,
    maesPrefixAlpha: args.maesPrefixAlpha,
    frameStride: args.frameStride,
    // Hardcoded 0 to mirror the web UI, where the temperature slider is
    // intentionally hidden and the state pinned at 0.0: temperature never
    // affects the transcript (greedy argmax is scale-invariant; MAES ranks at
    // temperature 1 regardless), it only feeds confidence scores, where any
    // value above 0 just makes them noisier. Pass 0 explicitly so we don't
    // inherit transcribe()'s 1.2 default and diverge from the UI's confidences.
    temperature: 0,
    returnTimestamps: args.timestamps,
    returnConfidences: args.timestamps,
    enableProfiling: args.verbose,
    debug: args.verbose,
  }, ({ chunkNum, totalChunks, result: chunkRes, elapsedMs }) => {
    // Only prefix when there is more than one chunk; a single-pass run prints
    // its transcript once via the final block below.
    if (totalChunks > 1) {
      console.error(`[transcribe] chunk ${chunkNum}/${totalChunks} done in ${(elapsedMs / 1000).toFixed(1)}s`);
      console.log(`[chunk ${chunkNum}/${totalChunks}] ${chunkRes.utterance_text}`);
    }
  });

  model.dispose();

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!willChunk) {
    // Single-pass: nothing was streamed above, so print the full transcript.
    console.log(result.utterance_text);
  }
}

// Only run the CLI when executed directly (node scripts/transcribe.mjs ...),
// not when this module is imported for its exported helpers (e.g. by a WER
// benchmark harness). process.argv[1] is the entry script's path.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`\n[transcribe] error: ${e.message}`);
    process.exit(1);
  });
}
