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
//   2. on WebGPU int8 is offered as a hand pick (the shipped int8 is
//      MatMulNBits, which the GPU EP runs) and fp16 is the default, but only on an adapter
//      that reports the `shader-f16` feature: without it ORT builds an fp16
//      session and then returns an EMPTY transcript, so the radio has to be
//      greyed out and the GPU default becomes int8 (owner rule 2026-10-22), or
//      nothing at all when the source hosts no int8,
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
import { routeSyntheticLocalMirror } from './routes.mjs';

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
  // int8 runs on the GPU too (MatMulNBits), so it has a live row, but it is a
  // hand pick: the GPU default stays fp16.
  const int8 = page.locator('input[name="encoderQuant"][value="int8"]');
  await expect(int8).toBeEnabled();
  await expect(int8).not.toBeChecked();
});

test('on WebGPU without shader-f16, fp16 is greyed out and int8 is picked on the GPU instead', async ({ page }) => {
  // The failure this prevents is the nastiest one in the app: on an adapter
  // without shader-f16, ORT builds the fp16 session, runs it, and returns an
  // EMPTY transcript with no error anywhere. So the radio must be disabled, and
  // a preference of 'fp16' carried over from another machine must NOT silently
  // transcribe nothing.
  //
  // What it resolves to instead is the owner rule of 2026-10-22: int8, ON the
  // GPU. The shipped int8 is MatMulNBits, which the WebGPU EP runs, at the
  // download the visitor would have had on WASM anyway. fp32 (a 2.35 GB
  // download nobody asked for) and w4a8 (the weakest encoder on long audio)
  // stay hand picks, never substitutes.
  await page.addInitScript(adapterStub([]));
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16' });
  await page.reload();

  await openPrecisionControls(page);

  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeEnabled();
  const fp16 = page.locator('input[name="encoderQuant"][value="fp16"]');
  await expect(fp16).toBeDisabled();
  await expect(fp16).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeChecked();
  // Neither of the other two may be selected for someone who did not ask for
  // it, and both stay ON SCREEN and pickable: hand picks, not forbidden.
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="w4a8"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="w4a8"]')).toBeEnabled();
  // The load stays on the GPU, so the "would run on the processor" note that
  // the next test needs must NOT appear here.
  await expect(page.locator('.setting-options', { has: page.locator('input[name="encoderQuant"]') }))
    .not.toContainText('run on the processor at int8');
});

test('on WebGPU without shader-f16 and a source with no int8, nothing is picked and the note says so', async ({ page }) => {
  // The int8 fallback above needs the source to HOST int8. A deployment that
  // mirrored only fp32 and w4a8 leaves nothing the app may choose on the
  // visitor's behalf, so no radio is checked and a load moves to the processor
  // at int8 (QuantUnavailable -> WASM). A radio group with nothing checked
  // reads as undecided, so the app has to say what a load would really do.
  await page.addInitScript(adapterStub([]));
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeSyntheticLocalMirror(page, [
    'vocab.txt',
    'int8/decoder_joint-model.int8.onnx',
    'w4a8/encoder-model.w4a8.onnx',
    'fp32/encoder-model.onnx',
    'fp32/encoder-model.onnx.data.000',
    'fp32/encoder-model.onnx.data.001',
  ]);
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16' });
  await page.reload();

  await openPrecisionControls(page);

  // The listing settles asynchronously; the int8 row disappearing is the sign
  // it has, and without it the assertions below could pass on a default list.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toHaveCount(0);
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="fp32"]')).toBeEnabled();
  await expect(page.locator('input[name="encoderQuant"][value="w4a8"]')).not.toBeChecked();
  await expect(page.locator('input[name="encoderQuant"]:checked')).toHaveCount(0);
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
  // int8 is offered on this backend too, but a saved fp16 is what stays selected.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).not.toBeChecked();
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
