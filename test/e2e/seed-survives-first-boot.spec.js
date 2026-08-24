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
  expect(await readSetting(page, 'modelSource')).toBe('local');

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
// to int8 on boot. int8lite therefore shipped as a radio you could click and
// which silently reverted on the next page load. The bytes were in IndexedDB
// the whole time, so only a spec that reads the RADIO after a reload catches it
// (a storage-only assertion passes on the broken build).
//
// Cheap on purpose: no model load, so it costs seconds and needs no weights.
test('a seeded int8lite precision survives the reload as the selected radio', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'int8lite' });
  await page.reload();

  expect(await readSetting(page, 'wasmEncoderQuant')).toBe('int8lite');

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const liteRadio = page.locator('input[name="encoderQuant"][value="int8lite"]');
  await liteRadio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(liteRadio,
    'the restore reset the saved precision to int8 instead of honouring it').toBeChecked();
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).not.toBeChecked();
});

// The flip side of the whitelist: a value this build does not know about must
// land on int8 rather than be handed to hub.js as an unresolvable quant. 'fp16'
// is the real case (a GPU precision, withdrawn 2026-08-23, never a WASM option).
test('an unknown saved precision falls back to int8 rather than being restored', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'fp16' });
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const int8Radio = page.locator('input[name="encoderQuant"][value="int8"]');
  await int8Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await expect(int8Radio).toBeChecked();
  expect(await page.locator('input[name="encoderQuant"][value="fp16"]').count(),
    'fp16 is not a WASM precision and must not appear as a radio').toBe(0);
});
