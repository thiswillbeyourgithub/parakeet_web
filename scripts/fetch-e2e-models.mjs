// Download just the int8 model files the tier-3 E2E needs (encoder + decoder +
// vocab) from HuggingFace into the E2E model dir. Local dev already has them in
// ./fallback_models; this exists so CI can populate a cached dir without the
// full 3 GB weight set.
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

// Matches App.jsx's pinned default repo and the int8/js-preprocessor download set:
// the SmoothQuant int8 the app actually ships (not the upstream istupakov plain int8),
// so the tier-3 e2e exercises the same weights users get.
const REPO_ID = 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx';
const REVISION = 'main';
const FILES = ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt'];

const MODEL_DIR = resolve(process.env.PARAKEET_E2E_MODEL_DIR || join(process.cwd(), 'fallback_models'));

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(file) {
  const dest = join(MODEL_DIR, file);
  if (await exists(dest)) {
    console.log(`[e2e:models] ${file} already present, skipping`);
    return;
  }
  const url = `https://huggingface.co/${REPO_ID}/resolve/${REVISION}/${file}?download=true`;
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
  for (const file of FILES) {
    try {
      await download(file);
    } catch (e) {
      await rm(join(MODEL_DIR, `${file}.partial`), { force: true });
      throw e;
    }
  }
  console.log('[e2e:models] done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
