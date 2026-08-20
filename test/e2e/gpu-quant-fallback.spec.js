// Tier-3 E2E for the GPU-to-WASM fallback when a model source ships no encoder
// the GPU can run (no fp16 file, no fp32 shards).
//
// Why this matters enough to have its own spec: since WebGPU was re-enabled,
// the performance probe can put a visitor on the GPU backend without them ever
// choosing it. If the deployment's model repo cannot serve GPU weights, that
// visitor used to land on a dead "Failed" screen for a decision they did not
// make. hub.js still refuses to silently downgrade the quant (that guard is
// what makes the failure legible at all, see transcription-fp32-wasm-no-
// downgrade.spec.js); App.jsx now catches the resulting QuantUnavailableError
// on a webgpu backend, switches to WASM, and says so.
//
// The fallback is deliberately narrow, and this spec pins that too: it fires
// for a quant that cannot be SERVED, which is a property of the deployment
// known before any weight byte is fetched, and it fires at most once per load.
//
// The machine is stubbed with a WebGPU adapter so the backend is selectable
// without a GPU, and weights come from the local mirror with only the GPU
// encoders routed away, so the WASM retry is a real load with real int8 files.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection, APP_VERSION } from './seed.mjs';
import { routeLocalMirrorWithoutGpuEncoders } from './routes.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';

const ADAPTER_WITH_F16 = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        // shader-f16 present, so the app asks for fp16 FIRST and then fp32:
        // both have to come back unavailable for the fallback to be reached.
        features: new Set(['shader-f16']),
        limits: {},
        info: { vendor: 'test', architecture: 'stub', device: '' },
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
};

const INT8_PROBE = '/models/encoder-model.int8.onnx';

test('a source with no GPU encoder falls back to WASM instead of failing the load', async ({ page, request, baseURL }) => {
  test.setTimeout(8 * 60 * 1000);
  // The WASM retry is a REAL load, so it needs the int8 encoder present.
  const head = await request.head(INT8_PROBE).catch(() => null);
  requireWeightsOrSkip(test, !head || !head.ok(), `no int8 encoder at ${baseURL}${INT8_PROBE}`);

  const logs = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.addInitScript(ADAPTER_WITH_F16);
  // Serve everything from the local mirror, then take the GPU encoders away.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeLocalMirrorWithoutGpuEncoders(page);

  await page.goto('/');
  // Model the machine this fallback exists for: one the autoconfigure probe
  // already moved to the GPU, so the visitor never chose WebGPU themselves.
  // Seeding a STILL-VALID verdict is also what keeps the premise intact: with
  // no stored verdict, shouldAutoProbe() fires on the Load click, the GPU arm
  // fails against a stub adapter, and the probe puts the page back on WASM
  // before the GPU weights are ever requested (the first run of this spec
  // failed exactly that way: a green load with no fallback in sight). The
  // adapter string must match what App.jsx builds from adapter.info above.
  await seedSettings(page, {
    backend: 'webgpu-hybrid',
    perfProbeVerdict: {
      backend: 'webgpu-hybrid', speedup: 5.4, at: Date.now(),
      appVersion: APP_VERSION, adapter: 'test/stub/',
    },
  });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Assert the fallback FIRST: it happens seconds in, before any weight byte,
  // so a failure here is fast and points at the fallback rather than timing
  // out minutes later on a downstream symptom. Exactly once, because a retry
  // loop would re-download the model on every attempt.
  await expect.poll(
    () => logs.filter((l) => l.includes('no GPU-capable encoder from this source')).length,
    { timeout: 90 * 1000, message: 'the GPU-to-WASM fallback never fired' },
  ).toBe(1);

  // It must say what it did, rather than quietly running on a backend the
  // visitor did not ask for.
  await expect(
    page.locator('.fallback-prompt', { hasText: 'GPU version of the model is not available' }),
  ).toBeVisible();

  // The load must RECOVER, not fail: the check mark is the whole point.
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  await expect(page.locator('body')).not.toContainText(/Failed|Échec/);

  // And the UI must now agree with reality: WASM, with int8 actually loaded.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeChecked();
  expect(logs.some((l) => /int8/.test(l))).toBe(true);

  // Still exactly one after the whole load: the WASM retry must not re-enter.
  const attempts = logs.filter((l) => l.includes('no GPU-capable encoder from this source'));
  expect(attempts).toHaveLength(1);
});
