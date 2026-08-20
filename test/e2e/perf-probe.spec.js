// Tier-3 E2E for the autoconfigure performance probe (App.jsx +
// app/ui/src/lib/perfProbe.js): the measurement that picks WASM or WebGPU for
// this machine instead of guessing for it.
//
// What this tier CAN prove, and why it is the half worth pinning: the probe sits
// in FRONT of the Load model button on every visit, so a regression that makes
// it fetch, run, or stall where it should not would cost every visitor time and
// bandwidth before their download even starts. All three tests below are about
// the probe staying out of the way, or failing towards WASM when it cannot
// decide honestly.
//
// What this tier CANNOT prove: a real GPU verdict. Headless Chromium has no GPU
// (the same limit that keeps fp16 and WebGPU generally out of the e2e tier), so
// the GPU arm can never win here. The decision rule itself is unit-tested in
// test/unit/perf-probe.test.mjs, and the full in-browser flow (prefetch, run on
// click, backend switched and persisted) is validated on a real GPU by the
// scripted headed check described in CLAUDE.md.
//
// navigator.gpu is stubbed rather than trusted, so each test pins one specific
// machine shape regardless of what the CI box happens to have. Model-weight
// fetches are stalled, so no test needs weights and none can skip.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';

// A machine whose browser exposes WebGPU. requestDevice is absent on purpose:
// this adapter can be enumerated but cannot actually run a graph, which is the
// realistic shape of a broken/blocklisted GPU and the case the probe must fail
// safely on. Test 1 only ever uses it to prove the app-wide kill switch wins
// even when a GPU is present.
const FAKE_ADAPTER = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        features: new Set(),
        limits: {},
        info: { vendor: 'test', architecture: 'stub', device: '' },
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
};

// A machine with no GPU at all: WebGPU is exposed but enumerates no adapter.
const NO_ADAPTER = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => null, getPreferredCanvasFormat: () => 'bgra8unorm' },
  });
};

// Watch what the probe touches: its two artifacts under /probe/ and its logs.
function watchProbe(page) {
  const assets = [];
  const logs = [];
  page.on('request', (r) => { if (r.url().includes('/probe/')) assets.push(r.url()); });
  page.on('console', (m) => { const t = m.text(); if (t.includes('[Probe]')) logs.push(t); });
  return { assets, logs };
}

// Park every model-weight fetch so loadModel() enters its loading state and
// never reaches modelReady: these tests care about what happens BEFORE the
// download, and this keeps them weight-free and fast.
async function stallWeights(page) {
  await page.route(/huggingface\.co/, () => { /* keep pending forever */ });
}

test('the probe never fetches or runs while WebGPU is disabled app-wide', async ({ page }) => {
  // The strong version of this check: the machine DOES have a GPU. Nothing may
  // happen anyway, because WEBGPU_DISABLED means no verdict could be acted on.
  await page.addInitScript(FAKE_ADAPTER);
  await stallWeights(page);
  const seen = watchProbe(page);

  await page.goto('/');
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  // Outlast the idle-prefetch deadline (requestIdleCallback timeout 5000).
  await page.waitForTimeout(6500);
  expect(seen.assets, 'probe artifacts prefetched while WebGPU is disabled').toEqual([]);

  await loadBtn.click();
  // The load must start immediately: no probe in front of it.
  await expect(page.locator('.controls')).toHaveCount(1, { timeout: 15000 });
  expect(seen.logs, 'probe ran while WebGPU is disabled').toEqual([]);
  expect(seen.assets, 'probe artifacts fetched on the load click').toEqual([]);

  // The sidebar button is hidden too: there is nothing for it to configure.
  // The section must be EXPANDED first, or its absence would prove nothing.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeVisible();
  await expect(page.locator('[data-umami-event="autoconfigure_button"]')).toHaveCount(0);
});

test('with WebGPU selectable but no adapter, the probe stays silent', async ({ page }) => {
  // Nothing to measure on a machine that cannot select WebGPU either way, so
  // the ~5 MB of artifacts must not be spent.
  await page.addInitScript(NO_ADAPTER);
  await stallWeights(page);
  const seen = watchProbe(page);

  await page.goto('/?webgpu=1');
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(6500);
  expect(seen.assets, 'probe artifacts prefetched with no adapter present').toEqual([]);

  await loadBtn.click();
  await expect(page.locator('.controls')).toHaveCount(1, { timeout: 15000 });
  expect(seen.logs, 'probe ran with no adapter present').toEqual([]);
});

test('an adapter that cannot run the graph keeps the visitor on WASM', async ({ page }) => {
  // The safety direction of the whole feature, and the one real verdict this
  // tier can reach: the adapter enumerates (so the probe does run) but no
  // device can be created from it, so the GPU arm fails. A wrong answer here
  // would send a visitor after 1.2-2.4 GB of weights their machine cannot use.
  await page.addInitScript(FAKE_ADAPTER);
  await stallWeights(page);
  const seen = watchProbe(page);

  await page.goto('/?webgpu=1');
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(6500);
  // Here the artifacts SHOULD be prefetched: this machine has something to decide.
  expect(seen.assets.length, 'both probe artifacts should be prefetched').toBe(2);

  await loadBtn.click();
  // The verdict must arrive and name wasm. The GPU arm is expected to fail at
  // session creation; if it instead hangs, perfProbe's watchdogs bound it, and
  // this assertion is what would catch that bound being lost.
  await expect
    .poll(() => seen.logs.find((l) => l.includes('wins')), { timeout: 90000 })
    .toContain('wasm wins');

  // Having failed, the probe must leave the backend alone and let the load run.
  await expect(page.locator('.controls')).toHaveCount(1, { timeout: 30000 });
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(page.locator('[data-umami-event="autoconfigure_button"]')).toHaveCount(1);
});
