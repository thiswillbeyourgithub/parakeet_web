// Tier-3 E2E: the encoder-precision radios describe THIS deployment, not the
// precisions the app knows how to run in the abstract.
//
// The report this pins came from a deployed instance. The visitor picked fp16 on
// the GPU, waited through a load, and was then told "this source does not host
// the encoder precision you chose in a form the GPU can execute, so the CPU
// version was loaded instead". Every word of that was true: the maintainer's
// mirror carries fp32 shards, int8 and w4a8 but no fp16, and the network there
// blocks HuggingFace, so the mirror is the only source. What was wrong is WHEN
// they learned it. The radio offered a choice the deployment could never honour,
// and the only way to discover that was to make it and lose the load.
//
// Three separate things can rule a precision out, and the app has to keep them
// apart because they point at different people: the backend cannot run it (a
// property of the build), the adapter reports no `shader-f16` (a property of the
// machine, which nobody can fix), or the source does not host the file (a
// property of the DEPLOYMENT, which the operator can fix by mirroring one more
// file). Collapsing them would tell a visitor their GPU is at fault for a file
// their operator simply never copied. So this spec stubs an adapter that DOES
// report shader-f16, which rules out the machine, and then asserts fp16 is
// greyed out for the remaining reason and named as such.
//
// Model-free on purpose: the radios are settled from the source LISTING, before
// a byte of weights is fetched, so the mirror here is stated outright rather
// than subtracted from whatever the box happens to hold. That also makes the
// spec identical on CI (no weights at all) and on a developer box.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection, seedSettings } from './seed.mjs';
import { routeSyntheticLocalMirror } from './routes.mjs';

// A GPU that can run fp16 perfectly well. The point of the stub: with
// shader-f16 present, "fp16 is unavailable" cannot be blamed on the hardware,
// so any greying out has to come from the source listing.
const ADAPTER_WITH_F16 = () => {
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

// The same stub with the feature MISSING, which is what most GPUs report here.
// Pairs with MIRROR_WITH_FP16 to pin the other direction: the file is served,
// the adapter cannot run it, and the row must say so instead of disappearing.
const ADAPTER_WITHOUT_F16 = () => {
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

// The maintainer's mirror, as its model-manifest.json really lists it: fp32 in
// shards (the only fp32 layout WebGPU can load), int8, w4a8, and no fp16.
const MIRROR_WITHOUT_FP16 = [
  'vocab.txt',
  'int8/encoder-model.int8.onnx',
  'int8/decoder_joint-model.int8.onnx',
  'w4a8/encoder-model.w4a8.onnx',
  'fp32/encoder-model.onnx',
  'fp32/encoder-model.onnx.data.000',
  'fp32/encoder-model.onnx.data.001',
];

// The same mirror after the operator published the fp16 encoder, which is the
// change that started all of this: the file appears on the server and the app
// has to notice. Identical to the list above plus one entry, so a test using it
// isolates exactly that.
const MIRROR_WITH_FP16 = [...MIRROR_WITHOUT_FP16, 'fp16/encoder-model.fp16.onnx'];

// Every assertion here is about a radio the app has already rendered, so none of
// them is worth the config's 6-minute expect budget (which exists for real
// transcriptions): a wrong one should report in seconds, not stall the run.
const FAST = 15 * 1000;

const precisionRadio = (page, value) => page.locator(`input[name="encoderQuant"][value="${value}"]`);
const precisionLabel = (page, value) =>
  page.locator('.setting-options label', { has: precisionRadio(page, value) });

async function openEngineSettings(page) {
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  await expandSettingsSection(page, 'Model and performance');
}

test('a precision this source does not host is not offered at all, before it is picked', async ({ page }) => {
  await page.addInitScript(ADAPTER_WITH_F16);
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeSyntheticLocalMirror(page, MIRROR_WITHOUT_FP16);

  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', backendUserPicked: true });
  await page.reload();
  await openEngineSettings(page);

  // fp16: offered by the backend, runnable by this GPU, absent from the source.
  // A precision this deployment does not host describes somebody else's
  // deployment, so it gets no row: the list is meant to read as "what this
  // model server can do", which is also what lets it follow any ONNX repo.
  await expect(precisionRadio(page, 'fp16')).toHaveCount(0, { timeout: 15 * 1000 });
  // And the absence must NOT be blamed on the adapter, which is the whole
  // reason the stub reports shader-f16. The companion test below is the other
  // half: same missing-vs-refused distinction, opposite direction.
  // Scoped to the precision rows: the BACKEND group mentions shader-f16 too,
  // legitimately, and matching that would make this pass for the wrong reason.
  const blamedOnAdapter = page.locator('.setting-options label', {
    has: page.locator('input[name="encoderQuant"]'),
    hasText: 'shader-f16',
  });
  await expect(blamedOnAdapter).toHaveCount(0, { timeout: FAST });

  // And the positive statement, which is the one worth having: the list is
  // exactly what this mirror can serve on this backend, in size order. An
  // assertion about what is missing passes just as well when the whole probe
  // failed and emptied the column.
  // toHaveValues is for a single multi-select, not a radio group, so read the
  // values off the group itself and poll while the listing probe settles.
  await expect.poll(
    () => page.locator('input[name="encoderQuant"]').evaluateAll((els) => els.map((e) => e.value)),
    { timeout: FAST },
  ).toEqual(['w4a8', 'fp32']);

  // The gate has to be about this one file, not a blanket refusal: the two
  // precisions the mirror DOES host stay pickable. Without this half, a probe
  // that simply failed and greyed everything out would pass the assertion above.
  await expect(precisionRadio(page, 'fp32')).toBeEnabled({ timeout: FAST });
  await expect(precisionRadio(page, 'w4a8')).toBeEnabled({ timeout: FAST });
});

test('the same mirror drops nothing it does host on the CPU backend', async ({ page }) => {
  // The listing is read once and answered per backend, so an over-eager gate
  // would show up here as a WASM precision greyed out for a GPU-only reason.
  // int8 and w4a8 are both hosted and both runnable on WASM, so both must be
  // offered; fp16 is a WebGPU-only precision and is expected to stay out.
  await page.addInitScript(ADAPTER_WITH_F16);
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeSyntheticLocalMirror(page, MIRROR_WITHOUT_FP16);

  await page.goto('/');
  await seedSettings(page, { backend: 'wasm', backendUserPicked: true });
  await page.reload();
  await openEngineSettings(page);

  await expect(precisionRadio(page, 'int8')).toBeEnabled({ timeout: 15 * 1000 });
  await expect(precisionRadio(page, 'w4a8')).toBeEnabled({ timeout: FAST });
  // fp16 has no usable WASM kernel, so on this backend it is not a choice that
  // exists and gets no row. It used to sit here greyed as "unavailable on
  // WASM", and that row is precisely what got read as "the fp16 file is
  // missing from the server" by someone who had just published it.
  await expect(precisionRadio(page, 'fp16')).toHaveCount(0, { timeout: FAST });

  // int8lite is the interesting one: the app offers it on WASM, this mirror
  // does not carry it, so it must be gone for the SOURCE reason. That is the
  // same failure as the fp16 report, on the backend most visitors use.
  await expect(precisionRadio(page, 'int8lite')).toHaveCount(0, { timeout: FAST });
  // Absence has to be specific, not a probe that failed and emptied the list.
  await expect(precisionLabel(page, 'int8')).toContainText('int8', { timeout: FAST });
});

test('a precision the source hosts but the adapter cannot run keeps its row and its reason', async ({ page }) => {
  // The other half of the distinction the first test makes. Missing from the
  // server and refused by your GPU are different problems with different
  // people to talk to, so they must not collapse into one another: the file
  // being absent removes the row, and the adapter being unable to run a file
  // that IS there leaves the row on screen saying exactly that. Without this,
  // hiding on source-absence could quietly grow into hiding on everything, and
  // two machines against one deployment would show different lists with
  // nothing to explain the difference.
  await page.addInitScript(ADAPTER_WITHOUT_F16);
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeSyntheticLocalMirror(page, MIRROR_WITH_FP16);

  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid', backendUserPicked: true });
  await page.reload();
  await openEngineSettings(page);

  await expect(precisionRadio(page, 'fp16')).toHaveCount(1, { timeout: 15 * 1000 });
  await expect(precisionRadio(page, 'fp16')).toBeDisabled({ timeout: FAST });
  await expect(precisionLabel(page, 'fp16')).toContainText('shader-f16', { timeout: FAST });
  // And not blamed on the server, which is serving the file perfectly well.
  await expect(precisionLabel(page, 'fp16')).not.toContainText('not hosted by this model source', { timeout: FAST });
});
