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
//   2. on WebGPU the int8 precision is not offered at all (the GPU EP has no
//      int8 encoder kernel) and fp16 is the default, but only on an adapter
//      that reports the `shader-f16` feature: without it ORT builds an fp16
//      session and then returns an EMPTY transcript, so the radio has to be
//      greyed out and the load has to degrade to fp32,
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

  // fp16 is the GPU default since 2026-09-11: half of fp32's bytes at the same
  // accuracy, which is why the model repos publish the file. This adapter
  // reports shader-f16 and the local mirror serves the fp16 encoder, so nothing
  // stands in the way and it is what a load would use. The two ways it can be
  // refused (no adapter feature, no file on the source) each degrade to fp32,
  // and the test below pins the first of them from the other side.
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).not.toBeChecked();
  // There is no GPU int8 encoder kernel, so int8 is not a precision this
  // backend offers and gets no row at all. Asserting absence rather than a
  // disabled row is the stronger claim: a greyed int8 under WebGPU described a
  // precision that was unavailable today rather than one that does not exist
  // here, which is how a greyed fp16 under WASM got read as a missing file.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toHaveCount(0);
});

test('on WebGPU without shader-f16, fp16 is greyed out and nothing is picked in its place', async ({ page }) => {
  // The failure this prevents is the nastiest one in the app: on an adapter
  // without shader-f16, ORT builds the fp16 session, runs it, and returns an
  // EMPTY transcript with no error anywhere. So the radio must be disabled, and
  // a preference of 'fp16' carried over from another machine must NOT silently
  // transcribe nothing.
  //
  // What it resolves to instead changed on 2026-09-11 (owner rule). It used to
  // be fp32, and that was a 2.35 GB download handed to somebody who had asked
  // for 1.2 GB; w4a8 would have been worse, the weakest encoder on long audio.
  // Neither is a decision to make on a visitor's behalf, so the app now picks
  // NOTHING on this backend and the load moves to the processor at int8. The
  // radios have to show that rather than quietly checking the biggest file.
  await page.addInitScript(adapterStub([]));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeEnabled();
  const fp16 = page.locator('input[name="encoderQuant"][value="fp16"]');
  await expect(fp16).toBeDisabled();
  await expect(fp16).not.toBeChecked();
  // Not fp32, and not w4a8: no GPU precision may be selected for someone who
  // did not ask for it. Both rows stay ON SCREEN and pickable, which is the
  // other half of the rule: they are hand picks, not forbidden.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="w4a8"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toHaveCount(0);

  // A radio group with nothing checked reads as undecided, so the app has to
  // say what a load would really do. Without this the visitor would find out
  // only from the fallback banner, after pressing the button.
  await expect(page.locator('.setting-options', { has: page.locator('input[name="encoderQuant"]') }))
    .toContainText('run on the processor at int8');
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
  // int8 has no GPU encoder kernel, so it is not offered on this backend.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toHaveCount(0);
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
  // fp16 is a GPU-only build: the CPU EP has no fp16 kernels, so it is not a
  // choice this backend has and it is not rendered. It used to sit here greyed,
  // which read as "the fp16 file is missing from the server" rather than as an
  // engine with no use for it, and that misreading is what this pins.
  await expect(page.locator('input[name="encoderQuant"][value="fp16"]')).toHaveCount(0);
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
