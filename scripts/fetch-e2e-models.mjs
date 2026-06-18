// Download the model files the tier-3 E2E needs from HuggingFace into the E2E
// model dir (flat layout, matching hub.js getLocalModelFile and serve.mjs).
// Local dev already has the ASR weights in ./fallback_models; this exists so CI
// can populate a cached dir without the full 3 GB weight set. Two model sets:
//   - the SmoothQuant int8 ASR weights (encoder + decoder + vocab), and
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

// Each entry is a { repo, file } HuggingFace descriptor, all served flat under
// /models. The int8 set matches App.jsx's pinned default repo (the SmoothQuant
// int8 the app actually ships, not the upstream istupakov plain int8), so the
// tier-3 e2e exercises the same weights users get. The diarization set matches
// diarizationModels.js's un-gated csukuangfj defaults.
const REVISION = 'main';
const ASR_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx';
const MODELS = [
  { repo: ASR_REPO, file: 'encoder-model.int8.onnx' },
  { repo: ASR_REPO, file: 'decoder_joint-model.int8.onnx' },
  { repo: ASR_REPO, file: 'vocab.txt' },
  { repo: 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0', file: 'model.onnx' },
  { repo: 'csukuangfj/speaker-embedding-models', file: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx' },
];

const MODEL_DIR = resolve(process.env.PARAKEET_E2E_MODEL_DIR || join(process.cwd(), 'fallback_models'));

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(repo, file) {
  const dest = join(MODEL_DIR, file);
  if (await exists(dest)) {
    console.log(`[e2e:models] ${file} already present, skipping`);
    return;
  }
  const url = `https://huggingface.co/${repo}/resolve/${REVISION}/${file}?download=true`;
  console.log(`[e2e:models] downloading ${file} from ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`fetch ${file} failed: ${res.status} ${res.statusText}`);
  const tmp = `${dest}.partial`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, dest);
  const { size } = await stat(dest);
  console.log(`[e2e:models] saved ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  await mkdir(MODEL_DIR, { recursive: true });
  console.log(`[e2e:models] target dir: ${MODEL_DIR}`);
  for (const { repo, file } of MODELS) {
    try {
      await download(repo, file);
    } catch (e) {
      await rm(join(MODEL_DIR, `${file}.partial`), { force: true });
      throw e;
    }
  }
  console.log('[e2e:models] done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
