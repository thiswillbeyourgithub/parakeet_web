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
//   2. on WebGPU the int8 precision is greyed out and fp32 is the default (the
//      GPU EP has no int8 encoder kernel), while fp16 is offered only on an
//      adapter that reports the `shader-f16` feature: without it ORT builds an
//      fp16 session and then returns an EMPTY transcript, so the radio has to
//      be greyed out rather than merely discouraged,
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

// A working adapter. `features` decides whether fp16 is offered, which is what
// the two precision tests below pin from either side.
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

  // fp32 is the GPU default (w4a8 is the only other precision the GPU path
  // offers, and it is opt-in), so it is what is selected.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeDisabled();
});

test('on WebGPU without shader-f16, fp16 is greyed out and fp32 is what loads', async ({ page }) => {
  // The failure this prevents is the nastiest one in the app: on an adapter
  // without shader-f16, ORT builds the fp16 session, runs it, and returns an
  // EMPTY transcript with no error anywhere. So the radio must be disabled, and
  // a preference of 'fp16' carried over from another machine must resolve to
  // fp32 rather than silently transcribing nothing.
  await page.addInitScript(adapterStub([]));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeEnabled();
  const fp16 = page.locator('input[name="encoderQuant"][value="fp16"]');
  await expect(fp16).toBeDisabled();
  await expect(fp16).not.toBeChecked();
  // The precision that will actually load is the one shown as selected.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeDisabled();
});

test('on WebGPU with shader-f16, fp16 is selectable and a saved choice is restored', async ({ page }) => {
  await page.addInitScript(adapterStub(['shader-f16']));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16' });
  await page.reload();

  await openPrecisionControls(page);

  const fp16 = page.locator('input[name="encoderQuant"][value="fp16"]');
  await expect(fp16).toBeEnabled();
  await expect(fp16).toBeChecked();
  // fp16 is a GPU-only build; the CPU EP has no fp16 kernels at all.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeDisabled();
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
  // fp16 has a row on every backend but is only ever runnable on WebGPU.
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
  // Back on the CPU path, int8 is selectable again.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeEnabled();
});

test('the greyed-out WebGPU tooltip stays fully readable', async ({ page }) => {
  // The label of a greyed-out option carries `.disabled-option` (opacity 0.5),
  // and the help popup used to render INSIDE it, so the ancestor opacity
  // multiplied into the popup and the explanation of why the option is greyed
  // out came out half transparent. The popup is portalled into <body> now, so
  // its effective opacity has to be exactly 1.
  await page.addInitScript(NO_ADAPTER);
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await openPrecisionControls(page);

  const label = page.locator('.setting-options label', { has: page.locator('input[value="webgpu-hybrid"]') });
  await expect(label).toHaveClass(/disabled-option/);
  await label.locator('.info-help-button').click();

  const popup = page.locator('.info-help-text');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('WebGPU');

  // The popup fades in (`animation: fadeIn 0.15s`), so a reading taken the
  // instant it becomes visible catches a mid-animation frame (0.62 rather than
  // 1) and fails for the wrong reason. Settle the animation first: what is
  // being pinned is the ancestor-opacity bug, not the fade.
  await popup.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

  // Effective opacity = product over the popup and every ancestor.
  const effectiveOpacity = await popup.evaluate((el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      o *= parseFloat(getComputedStyle(n).opacity);
    }
    return o;
  });
  expect(effectiveOpacity).toBeCloseTo(1, 5);

  // And it must not have landed back inside the dimmed label.
  await expect(label.locator('.info-help-text')).toHaveCount(0);
});
