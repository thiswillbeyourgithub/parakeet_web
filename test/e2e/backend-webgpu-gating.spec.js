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
//   2. on WebGPU the int8 precision is greyed out and fp32 is what is actually
//      selected, whatever the adapter reports: the GPU EP has no int8 encoder
//      kernel, and the fp16 build that used to be the GPU default was withdrawn
//      on 2026-08-23, so fp32 is the only precision the GPU path has left,
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

// A working adapter. `features` no longer influences precision (it decided fp16
// until that build was withdrawn), which is exactly what test 2 below pins.
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

  // fp32 is the only precision the GPU path has, so it is what is selected.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeDisabled();
});

test('on WebGPU the precision is fp32 regardless of what the adapter reports', async ({ page }) => {
  // fp16 used to be the GPU default and was gated on the adapter's shader-f16
  // feature (without it ORT built the session happily and returned an EMPTY
  // transcript). That build is withdrawn, so an adapter WITHOUT shader-f16 must
  // now behave exactly like one with it: fp32, selected, no other GPU option.
  await page.addInitScript(adapterStub([]));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeDisabled();
  // The withdrawn precision must not have left a radio behind.
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toHaveCount(0);
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
  // The opt-in sharded fp32 stays selectable on WASM.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
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
  // Back on the CPU path, int8 is selectable again.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeEnabled();
});
