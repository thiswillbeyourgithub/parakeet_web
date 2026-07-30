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
import { seedSettings, expandSettingsSection } from './seed.mjs';

const SETTINGS_DB = 'parakeetweb-settings-db';
const SETTINGS_STORE = 'settings-store';

// Read a setting straight out of the app's IndexedDB, bypassing the UI.
function readSetting(page, key) {
  return page.evaluate(({ DB, STORE, k }) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(undefined); return; }
      const get = db.transaction([STORE], 'readonly').objectStore(STORE).get('parakeetweb_' + k);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }), { DB: SETTINGS_DB, STORE: SETTINGS_STORE, k: key });
}

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
