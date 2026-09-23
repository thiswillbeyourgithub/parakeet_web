/**
 * The ONE place that knows how the Parakeet ONNX model repos lay their files
 * out. Imported by browser code (hub.js) and by the node scripts (transcribe,
 * fetch-e2e-models, the e2e static server), so no consumer ever hard-codes a
 * directory again. Pure, dependency-free ESM: no fs, no fetch, no DOM.
 *
 * LAYOUT v2 (2026-09-03). Basenames never change; a file's DIRECTORY is a pure
 * function of its basename:
 *
 *   fp32/       encoder-model.onnx, encoder-model.onnx.data,
 *               encoder-model.onnx.data.NNN, decoder_joint-model.onnx,
 *               decoder_joint-model.onnx.data
 *   int8/       encoder-model.int8.onnx, decoder_joint-model.int8.onnx
 *   int8-lite/  encoder-model.int8.lite.onnx
 *   w4a8/       encoder-model.w4a8.onnx
 *   fp16/       encoder-model.fp16.onnx, decoder_joint-model.fp16.onnx
 *   (root)      vocab.txt, config.json, nemo128.onnx, README.md, *.nemo
 *
 * TWO LEGACY LAYOUTS STAY SUPPORTED, because they are live in the wild:
 *   (a) everything FLAT at the root: the upstream istupakov repo, older
 *       mirrors, and the e2e fixture dirs `scripts/fetch-e2e-models.mjs`
 *       used to build.
 *   (b) flat root PLUS `sharded/`: the optimized repo as published on
 *       HuggingFace before the move, where the single-sidecar fp32 encoder
 *       sits at the root and the <2 GB shard set (plus its own rewritten
 *       encoder-model.onnx graph) sits under `sharded/`.
 *
 * Resolution order for a basename is therefore: its layout dir, then the root,
 * then `sharded/`. When a listing holds the same basename in several places the
 * caller decides with `preferDir`: the fp32 encoder GRAPH must come from
 * whichever directory holds the shards (its external_data points at
 * `.data.NNN`, so the root's single-sidecar graph would mount the wrong
 * tensors); everything else takes the first hit in the order above.
 *
 * Built with Claude Code.
 */

/** Directory every layout can place a file in, in resolution order. */
const ROOT_DIR = '';
const SHARDED_DIR = 'sharded/';

// Graph-name suffix -> directory. Order matters: `.int8.lite.onnx` must be
// tested before `.int8.onnx` would be, and it is the longer match, so keeping
// the list longest-suffix-first is what makes the lite build land in
// `int8-lite/` rather than `int8/`.
const QUANT_DIRS = [
  ['.int8.lite.onnx', 'int8-lite/'],
  ['.int8.onnx', 'int8/'],
  ['.w4a8.onnx', 'w4a8/'],
  ['.fp16.onnx', 'fp16/'],
];

// The unsuffixed fp32 graphs. Matched by exact name rather than by "ends with
// .onnx and has no quant suffix", so root-level ONNX files that are not model
// weights (nemo128.onnx, the mel preprocessor) stay at the root.
const FP32_GRAPHS = new Set(['encoder-model.onnx', 'decoder_joint-model.onnx']);

// Quant name -> the graph basenames that quant is served by. This is the one
// place the CLI stack learns which quants exist and what each is called; both
// scripts/transcribe.mjs (which resolves the files) and
// scripts/grid_search_benchmark.mjs (which validates --quant before it loads
// anything) read it from here. It lives in this module rather than in
// transcribe.mjs because transcribe.mjs statically imports onnxruntime, and the
// beam harness has to validate its arguments without paying for that; this
// module is dependency-free by design, so a static import costs nothing.
//
// `decoder` is ABSENT for an encoder-only quant. w4a8 is the case that matters:
// the model repo ships w4a8/encoder-model.w4a8.onnx and nothing else in that
// folder, so a w4a8 run pairs the encoder with some other precision's
// decoder_joint, exactly as scripts/wer-quants.py does on the Python side.
//
// int8 has TWO valid encoder names: the published HF repo uses the canonical
// `encoder-model.int8.onnx`, while the model-repo working folder keeps the
// descriptive `encoder-model.int8.smoothquant.onnx`. Canonical first, so the
// published layout is unchanged and --model-dir can still point at the working
// folder.
export const QUANT_FILES = {
  int8: {
    encoder: ['encoder-model.int8.onnx', 'encoder-model.int8.smoothquant.onnx'],
    decoder: ['decoder_joint-model.int8.onnx'],
  },
  w4a8: {
    encoder: ['encoder-model.w4a8.onnx'],
  },
  fp16: {
    encoder: ['encoder-model.fp16.onnx'],
    decoder: ['decoder_joint-model.fp16.onnx'],
  },
  fp32: {
    encoder: ['encoder-model.onnx'],
    decoder: ['decoder_joint-model.onnx'],
  },
};

// Derived from QUANT_FILES so neither list can drift from it: every quant that
// can be an ENCODER, and the subset that also ships a decoder_joint and can
// therefore be a DECODER.
export const ENCODER_QUANTS = Object.keys(QUANT_FILES);
export const DECODER_QUANTS = ENCODER_QUANTS.filter((q) => QUANT_FILES[q].decoder);

// The encoder quants the WASM EP can actually load. Mirrors the WASM branch of
// resolveModelQuant in app/src/hub.js, which serves int8 by default and takes
// w4a8 as an opt-in "on the same terms as lite": one self-contained file, no
// sidecar and no shards. fp16 is out because the EP has no fp16 kernels, and
// fp32 because its sidecar blows the 2 GiB per-file cap.
//
// Kept here rather than in hub.js so the CLIs can read it without importing the
// browser module. If the two ever disagree, hub.js is the behaviour that ships
// and this is the copy that is wrong.
export const WASM_ENCODER_QUANTS = ['int8', 'w4a8'];

// External-data sidecars live with their graph, so strip the sidecar suffix and
// classify the graph: `encoder-model.onnx.data.007` -> `encoder-model.onnx` ->
// `fp32/`. One rule instead of one entry per sidecar shape.
const SIDECAR_RE = /\.data(\.\d+)?$/;

/**
 * The directory a file belongs in under the v2 layout, as a prefix ready to
 * concatenate ('' for the repo root, otherwise trailing-slashed).
 *
 * @param {string} basename File basename (no directory part).
 * @returns {('fp32/'|'int8/'|'int8-lite/'|'w4a8/'|'fp16/'|'')} Directory prefix.
 */
export function layoutDirFor(basename) {
  if (typeof basename !== 'string' || basename.length === 0) return ROOT_DIR;
  const graph = basename.replace(SIDECAR_RE, '');
  for (const [suffix, dir] of QUANT_DIRS) {
    if (graph.endsWith(suffix)) return dir;
  }
  return FP32_GRAPHS.has(graph) ? 'fp32/' : ROOT_DIR;
}

/**
 * Every repo-relative path a basename may legitimately sit at, in resolution
 * order: its v2 layout dir, the flat root (layout a), then `sharded/` (layout
 * b). Deduplicated, so a root-layout file yields two entries rather than a
 * repeated one.
 *
 * @param {string} basename File basename (no directory part).
 * @returns {string[]} Ordered, unique repo-relative candidate paths.
 */
export function candidatePaths(basename) {
  const ordered = [layoutDirFor(basename) + basename, basename, SHARDED_DIR + basename];
  return [...new Set(ordered)];
}

/**
 * The basename of a repo-relative path (the part after the last '/').
 *
 * @param {string} path Repo-relative path.
 * @returns {string} Basename.
 */
export function basenameOf(path) {
  return typeof path === 'string' ? path.slice(path.lastIndexOf('/') + 1) : '';
}

/**
 * Look a basename up in a repo/mirror FILE LISTING (HuggingFace tree paths, or
 * the equivalent listLocalRepoFiles builds) and return the entry to fetch, with
 * its directory intact.
 *
 * `preferDir` wins when set, which is how the fp32 encoder graph is taken from
 * the directory that actually holds the shards. After that the candidatePaths
 * order decides. A listing that carries the basename somewhere unexpected (a
 * layout neither this module nor its legacy list predicted) is still honoured
 * as a last resort, so an unusual mirror degrades to "found" rather than to a
 * silent 404 on the flat root.
 *
 * @param {string[]} repoFiles Repo-relative paths (or bare basenames).
 * @param {string} basename File basename to resolve.
 * @param {{preferDir?: string}} [opts] preferDir: directory prefix to try first
 *   (with or without its trailing slash).
 * @returns {string|null} The matching listing entry, or null when absent.
 */
export function findRepoFile(repoFiles, basename, { preferDir } = {}) {
  if (!Array.isArray(repoFiles) || typeof basename !== 'string' || !basename) return null;
  const entries = repoFiles.filter((f) => typeof f === 'string'
    && (f === basename || f.endsWith(`/${basename}`)));
  if (entries.length === 0) return null;
  const prefer = preferDir && !preferDir.endsWith('/') ? `${preferDir}/` : (preferDir || '');
  const ordered = [...new Set([...(prefer ? [prefer + basename] : []), ...candidatePaths(basename)])];
  for (const candidate of ordered) {
    const hit = entries.find((f) => f === candidate);
    if (hit) return hit;
  }
  return entries[0];
}
