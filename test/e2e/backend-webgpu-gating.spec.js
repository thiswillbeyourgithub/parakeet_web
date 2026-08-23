// Tier-3 E2E for how the WebGPU backend is gated.
//
// WebGPU is available app-wide (App.jsx `WEBGPU_DISABLED` defaults to false).
// WHICH backend a visitor actually gets is decided by measuring their machine
// (the autoconfigure probe, test/e2e/perf-probe.spec.js), not by a global
// constant. This spec pins the gates that survive that decision:
//   1. with an adapter present, the WebGPU radio is selectable and a persisted
//      webgpu-hybrid backend SURVIVES a reload. It used to be coerced to WASM
//      on every boot, so this is the assertion that would catch the app-wide
//      pin coming back by accident,
//   2. fp16 stays gated on the adapter's shader-f16 feature, whatever the
//      backend does: ORT's fp16 kernels emit WGSL f16, and on an adapter
//      without it they compile to nothing and the transcript comes back EMPTY,
//   3. with NO adapter, WebGPU is greyed out and WASM stays the default, which
//      is what most CI machines and many visitors actually are,
//   4. `?webgpu=0` forces WASM for that page load and coerces a persisted
//      webgpu backend back: the support/diagnostic kill switch.
//
// navigator.gpu is stubbed so each test pins one machine shape regardless of
// what the box has. It touches no model weights, so it never skips and is fast.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

// A working adapter. `features` decides fp16: ORT needs shader-f16 for it.
const adapterStub = (features = []) => `
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        features: new Set(${JSON.stringify(features)}),
        limits: {},
        info: { vendor: 'test', architecture: 'stub', device: '' },
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
`;

const NO_ADAPTER = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: async () => null, getPreferredCanvasFormat: () => 'bgra8unorm' },
  });
};

async function openPrecisionControls(page) {
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
}

test('with a GPU present, WebGPU is selectable and a persisted choice survives a reload', async ({ page }) => {
  await page.addInitScript(adapterStub(['shader-f16']));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid' });
  await page.reload();

  await openPrecisionControls(page);

  const webgpuRadio = page.locator('input[name="backend"][value="webgpu-hybrid"]');
  await expect(webgpuRadio).toBeEnabled();
  // The coercion that used to run on every boot must be gone.
  await expect(webgpuRadio).toBeChecked();
  await expect(page.locator('input[name="backend"][value="wasm"]')).not.toBeChecked();

  // On a WebGPU adapter that HAS shader-f16, fp16 is a real choice.
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toBeEnabled();
});

test('fp16 stays greyed out on an adapter without shader-f16', async ({ page }) => {
  // The failure this prevents is silent: ORT builds the session happily and
  // returns an EMPTY transcript, so the gate has to be in the UI.
  await page.addInitScript(adapterStub([]));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toBeDisabled();
  // fp32 is the fallback precision on such a GPU, so it must stay available.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
});

test('with no adapter, WebGPU is greyed out and WASM int8 stays the default', async ({ page }) => {
  await page.addInitScript(NO_ADAPTER);
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeDisabled();
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeChecked();

  const int8 = page.locator('input[name="encoderQuant"][value="int8"]');
  await expect(int8).toBeEnabled();
  await expect(int8).toBeChecked();
  // The opt-in sharded fp32 stays selectable on WASM; fp16 cannot.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toBeDisabled();
});

test('?webgpu=0 forces WASM even on a GPU machine, and coerces a persisted choice', async ({ page }) => {
  // The kill switch: one URL parameter has to be enough to put a visitor back
  // on the CPU path without touching their settings.
  await page.addInitScript(adapterStub(['shader-f16']));
  await page.goto('/?webgpu=0');
  await seedSettings(page, { backend: 'webgpu-hybrid' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeDisabled();
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toBeDisabled();
});
