// A second Load click during the auto perf-probe must not start a second load.
//
// The probe runs for several seconds while `status` is still 'idle', so the
// Load button stays on screen. A second click in that window used to start a
// load straight away (the probe's own in-flight guard sent it past the probe),
// and the probe then started another one when it finished. Both downloads fed
// the one progress bar, which jumped back and forth between their two
// percentages. The symptoms this pins: the encoder fetched twice, and
// console.time('LoadModel') warning that its timer already exists.
import { test, expect } from '@playwright/test';

// Same stub as perf-probe.spec.js: an adapter is enough for the probe to run;
// its GPU arm fails and the verdict lands on WASM, which is all this needs.
const FAKE_ADAPTER = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        features: new Set(['shader-f16']),
        limits: {},
        info: { vendor: 'test', architecture: 'stub', device: '' },
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
};

test('a second Load click during the probe does not start a second download', async ({ page }) => {
  await page.addInitScript(FAKE_ADAPTER);
  // Keep every encoder request pending: the count of requests is the whole
  // assertion, so no weights are needed and nothing finishes loading.
  const encoderRequests = [];
  await page.route(/encoder-model/, (route) => { encoderRequests.push(route.request().url()); });
  await page.route(/huggingface\.co/, () => { /* keep pending forever */ });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.goto('/');
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  // Let the idle prefetch of the probe assets land, as in perf-probe.spec.js.
  await page.waitForTimeout(6500);

  await loadBtn.click();
  await expect.poll(() => logs.some((t) => t.includes('[Probe] animations paused')), { timeout: 15000 }).toBe(true);
  // The window the bug lived in: probe running, button still clickable.
  if (await loadBtn.isVisible()) await loadBtn.click();

  await expect.poll(() => encoderRequests.length, { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  // A second load would reach the encoder within a moment of the first.
  await page.waitForTimeout(3000);
  expect(encoderRequests, 'encoder fetched by more than one concurrent load').toHaveLength(1);
  expect(logs.filter((t) => t.includes("Timer 'LoadModel' already exists"))).toEqual([]);
});
