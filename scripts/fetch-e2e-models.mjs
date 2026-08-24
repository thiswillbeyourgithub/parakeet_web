// Download the model files the tier-3 E2E needs from HuggingFace into the E2E
// model dir (flat layout, matching hub.js getLocalModelFile and serve.mjs).
// Local dev already has the ASR weights in ./fallback_models; this exists so CI
// can populate a cached dir without the full 3 GB weight set. Two model sets:
//   - the SmoothQuant int8 ASR weights (both encoders + decoder + vocab),
//   - the two speaker-diarization models (pyannote segmentation + CAM++
//     embedding) that transcription-diarization.spec.js needs; that spec
//     self-skips when they are absent, so this download is what gives it CI
//     coverage. They sit flat alongside the ASR files (distinct filenames, so
//     no collision) because diarizationModels.js requests /models/<filename>.
//
// Usage:  PARAKEET_E2E_MODEL_DIR=/path node scripts/fetch-e2e-models.mjs
// Skips any file already present (so an actions/cache restore is a no-op).
//
// Built with Claude Code.

import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each entry is a { repo, file } HuggingFace descriptor, all served flat under
// /models. The int8 set matches App.jsx's pinned default repo (the SmoothQuant
// int8 the app actually ships, not the upstream istupakov plain int8), so the
// tier-3 e2e exercises the same weights users get. The diarization set matches
// diarizationModels.js's un-gated csukuangfj defaults.
const REVISION = 'main';
const ASR_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
export const MODELS = [
  { repo: ASR_REPO, file: 'encoder-model.int8.onnx' },
  // The lite int8 encoder (same SmoothQuant calibration, --exclude-worst 0.05,
  // so 11 MatMuls stay fp32 instead of 18). It is the ONE precision alternative
  // headless Chromium can actually run, so fetching it is what gives
  // transcription-int8-lite-wasm.spec.js CI coverage instead of a permanent
  // strict-weights skip. Costs ~793 MB on a cache miss; the cache is keyed on
  // this file, so adding it here re-keys and re-bakes automatically.
  { repo: ASR_REPO, file: 'encoder-model.int8.lite.onnx' },
  { repo: ASR_REPO, file: 'decoder_joint-model.int8.onnx' },
  { repo: ASR_REPO, file: 'vocab.txt' },
  // No variant filenames: the model repo's graph work (folded encoder, decoder
  // with the in-graph log-partition + top-K outputs) ships INSIDE the two files
  // above. Whether the fetched revision actually carries the decoder outputs is
  // reported by parakeet.js at load, and the two specs that depend on them skip
  // against a revision that predates the promotion.
  { repo: 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0', file: 'model.onnx' },
  { repo: 'csukuangfj/speaker-embedding-models', file: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx' },
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
export async function download({ repo, file, optional = false }, modelDir = MODEL_DIR) {
  const dest = join(modelDir, file);
  if (await exists(dest)) {
    console.log(`[e2e:models] ${file} already present, skipping`);
    return true;
  }
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
  console.log(`[e2e:models] saved ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

async function main() {
  await mkdir(MODEL_DIR, { recursive: true });
  console.log(`[e2e:models] target dir: ${MODEL_DIR}`);
  for (const entry of MODELS) {
    try {
      await download(entry);
    } catch (e) {
      await rm(join(MODEL_DIR, `${entry.file}.partial`), { force: true });
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
