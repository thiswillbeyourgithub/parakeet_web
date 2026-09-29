// Tier-3 E2E regression guard for the settings SEEDER itself (test/e2e/seed.mjs).
//
// Nearly every model-loading spec establishes its premise by seeding the
// settings DB and reloading, so a seeder that silently loses its writes does not
// fail loudly: it makes the spec run on DEFAULTS and quietly assert nothing.
// That is exactly what happened. The seeder gated only on the app stamping
// `version`, but `saveSetting('version')` runs BEFORE `setSettingsLoaded(true)`,
// and each `usePersistedSetting` effect writes its CURRENT (default) value the
// moment `settingsLoaded` flips. So the seed landed in the middle of that
// default-persist storm and was overwritten key by key: a seeded
// `wasmEncoderQuant: 'fp32'` read back as `int8`, and
// transcription-fp32-wasm-no-downgrade then loaded int8 weights instead of
// reaching the unsatisfiable-quant guard it exists to assert. It failed only
// under the loaded full-suite run and passed in isolation, which is the worst
// possible failure mode.
//
// This spec pins the seeder's contract directly, with no model weights and no
// network: a seeded NON-DEFAULT value must survive the reload, both in the
// settings DB and in the UI the app actually boots with.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection, readSetting } from './seed.mjs';
import { routeSyntheticLocalMirror } from './routes.mjs';

// A mirror hosting a non-default WASM precision besides the default int8.
const MIRROR_WITH_W4A8 = [
  'vocab.txt',
  'int8/encoder-model.int8.onnx',
  'int8/decoder_joint-model.int8.onnx',
  'w4a8/encoder-model.w4a8.onnx',
];

test('a seeded non-default setting survives the first boot and the reload', async ({ page }) => {
  await page.goto('/');

  // fp32 is deliberately NOT the default (int8 is), so an overwritten seed is
  // indistinguishable from "never seeded" and the assertions below would fail.
  await seedSettings(page, { wasmEncoderQuant: 'fp32' });
  await page.reload();

  // The bytes actually survived the default-persist storm.
  expect(await readSetting(page, 'wasmEncoderQuant'),
    'seeded wasmEncoderQuant must not be clobbered by the first boot').toBe('fp32');
  // ...and the base config the seeder always writes came through too.
  expect(await readSetting(page, 'backend')).toBe('wasm');
  // modelSource is operator config, not a setting: it reaches the app through
  // window.__CONFIG__, and that is what it booted with.
  expect(await page.evaluate(() => window.__CONFIG__?.VITE_MODEL_SOURCE)).toBe('local');

  // The app BOOTED on the seeded value, not merely stored it: the WASM
  // encoder-precision radio reflects fp32.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const fp32Radio = page.locator('input[name="encoderQuant"][value="fp32"]');
  await fp32Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(fp32Radio).toBeChecked();
});

// Regression: the settings restore validated the saved WASM precision with a
// `=== 'fp32' ? 'fp32' : 'int8'` ternary, so every value except fp32 was reset
// to int8 on boot. A non-default precision therefore shipped as a radio you
// could click and which silently reverted on the next page load. The bytes were in IndexedDB
// the whole time, so only a spec that reads the RADIO after a reload catches it
// (a storage-only assertion passes on the broken build).
//
// Cheap on purpose: no model load, so it costs seconds and needs no weights.
test('a seeded non-default precision survives the reload as the selected radio', async ({ page }) => {
  // w4a8 rather than fp32: fp32 is the one value the broken ternary DID keep,
  // so it cannot catch this regression. The radios only list what the source
  // hosts, so state a mirror that hosts w4a8 (no bytes are ever fetched).
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeSyntheticLocalMirror(page, MIRROR_WITH_W4A8);
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'w4a8' });
  await page.reload();

  expect(await readSetting(page, 'wasmEncoderQuant')).toBe('w4a8');

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const w4a8Radio = page.locator('input[name="encoderQuant"][value="w4a8"]');
  await w4a8Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(w4a8Radio,
    'the restore reset the saved precision to int8 instead of honouring it').toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).not.toBeChecked();
});

// A returning visitor may still have 'int8lite' saved from before that precision
// was retired (no offered model ships it). It must boot as int8, never be
// handed to hub.js as a quant no source can serve.
test('a saved int8lite (retired precision) boots as int8', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'int8lite' });
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const int8Radio = page.locator('input[name="encoderQuant"][value="int8"]');
  await int8Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(int8Radio).toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8lite"]')).toHaveCount(0);
});

// The flip side of the whitelist: a value this build does not know about must
// land on int8 rather than be handed to hub.js as an unresolvable quant. 'fp16'
// is the real case: a GPU-only precision (it needs the adapter's shader-f16
// feature) that the WASM backend can never run, because the CPU EP has no fp16
// kernels and upcasts to fp32 at session build.
//
// This used to assert the fp16 radio did not EXIST, which held while fp16 was
// withdrawn outright. It is offered again on WebGPU, and the precision list now
// renders every row on both backends with the unrunnable ones disabled, so the
// assertion moved to what actually protects the user: on WASM fp16 is not on
// offer at all, and int8 is what the seeded GPU-only value resolved to.
test('an unknown saved precision falls back to int8 rather than being restored', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'fp16' });
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const int8Radio = page.locator('input[name="encoderQuant"][value="int8"]');
  await int8Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(int8Radio).toBeChecked();
  const fp16Radio = page.locator('input[name="encoderQuant"][value="fp16"]');
  await expect(fp16Radio,
    'fp16 has no WASM kernels, so this backend does not offer it at all').toHaveCount(0);
});

// Regression: the seeder wrote modelSource: 'local' to the settings DB long
// after the app stopped reading it there (it is VITE_MODEL_SOURCE, operator
// config), so every seeded spec actually loaded its weights from HuggingFace
// and used the local mirror only as a fallback. Nothing failed until a network
// change mid-download (ERR_NETWORK_CHANGED) failed an unrelated spec through its
// console-error check. A seeded spec must load entirely from serve.mjs.
test('a seeded spec loads its model without a single HuggingFace request', async ({ page }) => {
  // Counted from the reload on: the first goto('/') necessarily boots on the
  // build's default config (every spec seeds only after it), and its listing
  // probes are not what this guards. The seeded boot is.
  const hfRequests = [];
  let seeded = false;
  page.on('request', (r) => {
    if (seeded && /huggingface\.co|hf\.co/.test(r.url())) hfRequests.push(r.url());
  });
  await page.goto('/');
  await seedSettings(page);
  seeded = true;
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  expect(hfRequests, 'requests that left for HuggingFace').toEqual([]);
});

test('a spec can opt back into the HuggingFace source, and its own __CONFIG__ wins', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page, { modelSource: 'hf' });
  await page.reload();
  expect(await page.evaluate(() => window.__CONFIG__?.VITE_MODEL_SOURCE)).toBe('hf');
  // No settings key is minted for it: it is config, and a stored copy is what
  // hid this bug.
  expect(await readSetting(page, 'modelSource')).toBeUndefined();

  const page2 = await page.context().newPage();
  await page2.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'both' }; });
  await page2.goto('/');
  await seedSettings(page2);
  await page2.reload();
  expect(await page2.evaluate(() => window.__CONFIG__?.VITE_MODEL_SOURCE)).toBe('both');
});
