// Download the model files the tier-3 E2E needs from HuggingFace into the E2E
// model dir. Each file lands under <modelDir>/<repo>/<repo-relative path>, so
// the mirror has the shape of a mount holding SEVERAL repos: the layout the app
// resolves by asking for a repo by name (hub.js resolveLocalModelBase) and the
// one a deployment offering a choice of models must use. Local dev already has
// the ASR weights in ./fallback_models; this exists so CI can populate a cached
// dir without the full 3 GB weight set. Two model sets:
//   - the int8 ASR weights (both encoders + decoder + vocab), keeping the repo's
//     own precision folders (int8/, int8-lite/) under the repo prefix, which is
//     what app/src/modelLayout.js resolves and serve.mjs serves,
//   - the two speaker-diarization models (pyannote segmentation + CAM++
//     embedding) that transcription-diarization.spec.js needs; that spec
//     self-skips when they are absent, so this download is what gives it CI
//     coverage. They come from two OTHER repos and now sit under their own
//     prefixes too, which diarizationModels.js reaches by resolving its base per
//     repo. Before that they had to sit loose at the mirror root, since the
//     local fetch addressed them by bare basename.
//
// The flat layout (everything at the root) is still supported everywhere it was
// -- it is the single-repo LOCAL_MODEL_PATH contract, and plenty of checkouts
// use it -- so the specs' HEAD probes accept either (test/e2e/model-probe.mjs).
// CI builds the nested one so the tier exercises what a multi-model deployment
// actually runs.
//
// Usage:  PARAKEET_E2E_MODEL_DIR=/path node scripts/fetch-e2e-models.mjs
// Skips any file already present (so an actions/cache restore is a no-op).
//
// Built with Claude Code.

import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each entry is a { repo, file } HuggingFace descriptor, where `file` is the
// IN-REPO path: it is both what gets requested from HF and where the file lands
// under MODEL_DIR, so the e2e mirror is a faithful copy of the repo layout
// rather than a flattened one. The int8 set matches App.jsx's pinned default
// repo (the int8 build the app actually ships, not the upstream istupakov plain
// int8), so the tier-3 e2e exercises the same weights users get. The diarization
// set matches diarizationModels.js's un-gated csukuangfj defaults, whose repos
// keep their single model at the root.
const REVISION = 'main';
export const ASR_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
// The two diarization repos, named so the specs that probe for their weights
// share this list's idea of where they came from instead of restating the ids.
export const DIARIZATION_SEG_REPO = 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0';
export const DIARIZATION_EMB_REPO = 'csukuangfj/speaker-embedding-models';
export const MODELS = [
  { repo: ASR_REPO, file: 'int8/encoder-model.int8.onnx' },
  // The lite int8 encoder (same calibration, --exclude-worst 0.05, so 11 MatMuls
  // stay fp32 instead of 18). It is the ONE precision alternative headless
  // Chromium can actually run, so fetching it is what gives
  // transcription-int8-lite-wasm.spec.js CI coverage instead of a permanent
  // strict-weights skip. Costs ~793 MB on a cache miss; the cache is keyed on
  // this file, so adding it here re-keys and re-bakes automatically.
  { repo: ASR_REPO, file: 'int8-lite/encoder-model.int8.lite.onnx' },
  { repo: ASR_REPO, file: 'int8/decoder_joint-model.int8.onnx' },
  { repo: ASR_REPO, file: 'vocab.txt' },
  // No variant filenames: the model repo's graph work (folded encoder, decoder
  // with the in-graph log-partition + top-K outputs) ships INSIDE the two files
  // above. Whether the fetched revision actually carries the decoder outputs is
  // reported by parakeet.js at load, and the two specs that depend on them skip
  // against a revision that predates the promotion.
  { repo: DIARIZATION_SEG_REPO, file: 'model.onnx' },
  { repo: DIARIZATION_EMB_REPO, file: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx' },
];

const MODEL_DIR = resolve(process.env.PARAKEET_E2E_MODEL_DIR || join(process.cwd(), 'fallback_models'));

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// `optional` tolerates a 404 instead of failing the fetch. No entry above needs
// it today (every file is required, and the lite encoder was verified live on
// HF before being listed as such), but it is the mechanism for the recurring
// window where a new file is committed to the model repo and not yet pushed to
// HF, so it stays and stays tested.
export function destPath(modelDir, repo, file) {
  return join(modelDir, repo, file);
}

/**
 * Where the ASR weights actually start inside a mirror this script wrote.
 *
 * The mirror is nested (<modelDir>/<repo>/...), but the consumers that read it
 * off the FILESYSTEM rather than over HTTP -- the batching-equivalence gate, and
 * serve.mjs's startup canary -- want the directory that behaves like a single
 * repo root, which is what every loader and `fallback_models` mean by a model
 * dir. Descending into it when it is there is the same move docker/entrypoint.sh
 * makes for a single-repo mount, and it keeps a FLAT checkout (fallback_models,
 * and any mirror written before this script nested) working untouched.
 *
 * Exported from here because this module owns the layout it writes: a reader
 * that guessed the shape separately is exactly how the batching gate would have
 * gone on self-skipping in CI, green and testing nothing.
 *
 * @param {string} modelDir The mirror root.
 * @param {string} [repo=ASR_REPO] Repo whose weights are wanted.
 * @returns {string} modelDir, or its <repo> subfolder when that is the populated one.
 */
export function asrRootIn(modelDir, repo = ASR_REPO) {
  if (existsSync(join(modelDir, 'vocab.txt'))) return modelDir;
  const nested = join(modelDir, repo);
  return existsSync(join(nested, 'vocab.txt')) ? nested : modelDir;
}

export async function download({ repo, file, optional = false }, modelDir = MODEL_DIR) {
  const rel = join(repo, file);
  const dest = destPath(modelDir, repo, file);
  if (await exists(dest)) {
    console.log(`[e2e:models] ${rel} already present, skipping`);
    return true;
  }
  // `repo` and `file` together carry the whole directory, so make it before
  // streaming into it. Cheap and idempotent.
  await mkdir(dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${repo}/resolve/${REVISION}/${file}?download=true`;
  console.log(`[e2e:models] downloading ${file} from ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    if (optional) {
      console.warn(`[e2e:models] optional ${file} not available (${res.status} ${res.statusText}), skipping (its spec self-skips)`);
      return false;
    }
    throw new Error(`fetch ${file} failed: ${res.status} ${res.statusText}`);
  }
  const tmp = `${dest}.partial`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, dest);
  const { size } = await stat(dest);
  console.log(`[e2e:models] saved ${rel} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

async function main() {
  await mkdir(MODEL_DIR, { recursive: true });
  console.log(`[e2e:models] target dir: ${MODEL_DIR}`);
  for (const entry of MODELS) {
    try {
      await download(entry);
    } catch (e) {
      await rm(`${destPath(MODEL_DIR, entry.repo, entry.file)}.partial`, { force: true });
      throw e;
    }
  }
  console.log('[e2e:models] done.');
}

// Import-safe (the unit test imports MODELS/download without side effects):
// only run the fetch loop when executed as a script, same idiom as
// scripts/transcribe.mjs.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
