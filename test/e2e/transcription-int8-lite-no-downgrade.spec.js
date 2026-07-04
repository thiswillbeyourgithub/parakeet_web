// Tier-3 E2E for the int8-lite "requested quant not available from ANY source"
// guard. The user picks the WASM "int8 lite" encoder, but neither the configured
// HF repo (istupakov, which ships no encoder-model.int8.lite.onnx) NOR the local
// /models mirror has the lite file. Rather than silently loading the DEFAULT int8
// encoder (which would hide which build actually ran), hub.js throws
// QuantUnavailableError and the UI surfaces a clear lite-specific banner and a
// Failed status.
//
// This is the lite analogue of transcription-fp32-wasm-no-downgrade.spec.js. It
// needs no model weights (the throw happens at quant resolution, before any
// download), so it never skips and runs fast.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

// The real istupakov file set: int8 + single-file fp32 + vocab, but crucially NO
// encoder-model.int8.lite.onnx, so the lite request cannot be satisfied.
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

test('WASM int8 lite fails loudly (no silent default-int8 downgrade) when no source ships the lite file', async ({ page }) => {
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

  // HF lists the lite-less istupakov set; abort any HF file download.
  await page.route('**/huggingface.co/api/**', (route) =>
    route.fulfill({ json: ISTUPAKOV_FILES.map((path) => ({ type: 'file', path })) }));
  await page.route(/https:\/\/(huggingface\.co|cdn-lfs[^/]*\.huggingface\.co)\/(?!api\/).*/, (route) =>
    route.abort());
  // The local mirror has NO lite file either: 404 every /models probe so the
  // auto-upgrade cannot rescue the lite request.
  await page.route('**/models/**', (route) =>
    route.fulfill({ status: 404, body: 'not found' }));

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Opt into the lite encoder via the real encoder-precision radio (WASM-only).
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const liteRadio = page.locator('input[name="encoderQuant"][value="int8-lite"]');
  await liteRadio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await liteRadio.check();
  await expect(liteRadio).toBeChecked();
  await page.locator('.settings-sidebar-close').click();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // The load must fail with the explicit lite "can't serve this quant" banner,
  // NOT silently succeed on the default int8 encoder.
  await expect(page.locator('.fallback-prompt')).toContainText('lite', { timeout: 60 * 1000 });
  await expect(page.locator('.app-header__status')).toContainText('Failed', { timeout: 60 * 1000 });

  // hub.js threw rather than pinning to int8, and nothing was transcribed.
  expect(logs.some((l) => l.includes('pinned to int8')),
    'lite request must NOT silently fall back to the default int8 encoder').toBe(false);
  expect(transcribeRuns, 'no transcription should run after a failed load').toBe(0);
});
