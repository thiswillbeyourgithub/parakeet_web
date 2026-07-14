// Tier-3 E2E for the "requested quant not available from ANY source" guard. The
// user picks WASM fp32, but neither the configured HF repo (istupakov, single
// 2.4 GB sidecar, no <2 GB shards) NOR the local /models mirror ships the shards.
// hub.js used to silently fall back to the int8 pin here, which made it
// impossible to tell which precision actually loaded. It now throws
// QuantUnavailableError instead, and the UI surfaces a clear banner and a Failed
// status rather than quietly transcribing with int8.
//
// This is the negative counterpart to transcription-fp32-wasm-autoupgrade.spec.js
// (where the local mirror DOES have the shards and the load switches to it). Here
// we 404 the local shard probes so no source can satisfy fp32, and assert the
// load fails loudly. It needs no model weights (the throw happens at quant
// resolution, before any download), so it never skips and runs fast.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings } from './seed.mjs';

// The real istupakov file set: single-file fp32 encoder, int8 variants, vocab.
// Crucially NO encoder-model.onnx.data.NNN shards, so WASM fp32 cannot load.
const ISTUPAKOV_FILES = [
  'config.json',
  'decoder_joint-model.int8.onnx',
  'decoder_joint-model.onnx',
  'encoder-model.int8.onnx',
  'encoder-model.onnx',
  'encoder-model.onnx.data',
  'nemo128.onnx',
  'vocab.txt',
];

test('WASM fp32 fails loudly (no silent int8 downgrade) when no source ships the shards', async ({ page }) => {
  const logs = [];
  let transcribeRuns = 0;
  page.on('console', (m) => {
    const text = m.text();
    logs.push(text);
    if (text.includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });

  // Stay on the default 'hf' source so App passes localUpgradeBaseUrl='/models'.
  await page.addInitScript(() => {
    window.__CONFIG__ = {
      VITE_MODEL_SOURCE: 'hf',
      VITE_MODEL_REPO: 'istupakov/parakeet-tdt-0.6b-v3-onnx',
    };
  });

  // HF lists the shard-less istupakov set; abort any HF file download.
  await page.route('**/huggingface.co/api/**', (route) =>
    route.fulfill({ json: ISTUPAKOV_FILES.map((path) => ({ type: 'file', path })) }));
  await page.route(/https:\/\/(huggingface\.co|cdn-lfs[^/]*\.huggingface\.co)\/(?!api\/).*/, (route) =>
    route.abort());
  // The local mirror has NO shards either: 404 every /models probe so the
  // auto-upgrade cannot rescue the fp32 request.
  await page.route('**/models/**', (route) =>
    route.fulfill({ status: 404, body: 'not found' }));

  // int8 is the default; fp32 is an opt-in on WASM. Seed it directly (rather
  // than driving the settings UI) to exercise the fp32-on-WASM request that must
  // fail cleanly (no silent int8 downgrade) when no source can serve it.
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'fp32' });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // The load must fail with the explicit "can't serve this quant" banner, NOT
  // silently succeed on int8.
  await expect(page.locator('.fallback-prompt')).toContainText('fp32', { timeout: 60 * 1000 });
  await expect(page.locator('.app-header__status')).toContainText('Failed', { timeout: 60 * 1000 });

  // hub.js threw rather than pinning to int8, and nothing was transcribed.
  expect(logs.some((l) => l.includes('pinned to int8')),
    'fp32 request must NOT silently fall back to the int8 pin').toBe(false);
  expect(transcribeRuns, 'no transcription should run after a failed load').toBe(0);
});
