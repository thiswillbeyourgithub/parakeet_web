// Tier-3 E2E: the `?reset` URL escape hatch must wipe saved settings and boot
// on defaults, so a persisted value that wedged the app can be recovered without
// reaching the in-app "Reset All" (App.jsx, the urlRequestsSettingsReset branch
// at the top of loadSettings). Model-free: it only exercises settings restore,
// so it is quick and needs no weights.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings } from './seed.mjs';

const SETTINGS_DB = 'parakeetweb-settings-db';
const SETTINGS_STORE = 'settings-store';
const SETTINGS_PREFIX = 'parakeetweb_';

// Read one settings key straight from IndexedDB (unprefixed name in, raw value
// out; undefined if absent). Used to observe the purge without touching the UI.
function readSetting(page, key) {
  return page.evaluate(({ DB, STORE, PREFIX, key }) => new Promise((resolve) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(undefined); return; }
      const get = db.transaction([STORE], 'readonly').objectStore(STORE).get(PREFIX + key);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); resolve(undefined); };
    };
    req.onerror = () => resolve(undefined);
  }), { DB: SETTINGS_DB, STORE: SETTINGS_STORE, PREFIX: SETTINGS_PREFIX, key });
}

test('?reset purges saved settings, boots on defaults, and strips the param', async ({ page }) => {
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'log') logs.push(m.text()); });

  // First boot creates the settings DB; seed a distinctive, non-default config.
  await page.goto('/');
  await seedSettings(page, { verboseLog: true, beamWidth: 7 });
  expect(await readSetting(page, 'verboseLog')).toBe(true);
  expect(await readSetting(page, 'beamWidth')).toBe(7);

  // Reload WITH ?reset: the app must purge the seeded values and boot on defaults.
  await page.goto('/?reset');

  // The app shell must be interactive (recovered, not wedged).
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  await expect(loadBtn).toBeEnabled();

  // The reset branch logs before it purges; seeing it proves the branch ran.
  await expect
    .poll(() => logs.some((l) => l.includes('URL reset requested')), {
      timeout: 15000,
      message: 'expected the ?reset branch to log that it purged settings',
    })
    .toBe(true);

  // The seeded values are gone: booting on defaults re-persists verboseLog=false
  // (its default), overwriting the seeded true. Poll to let that effect settle.
  await expect
    .poll(() => readSetting(page, 'verboseLog'), { timeout: 15000 })
    .toBe(false);
  // beamWidth must no longer be the seeded 7 (it is back to its default).
  expect(await readSetting(page, 'beamWidth')).not.toBe(7);
  // The version key is stamped so a later plain reload does not purge again.
  expect(await readSetting(page, 'version')).not.toBe(undefined);

  // The reset directive is stripped from the address bar so a plain reload (or a
  // shared/bookmarked link) does not keep re-purging on every visit.
  expect(new URL(page.url()).searchParams.has('reset')).toBe(false);
});

test('#reset hash is honoured as a fallback and then cleared', async ({ page }) => {
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'log') logs.push(m.text()); });

  await page.goto('/');
  await seedSettings(page, { verboseLog: true });
  expect(await readSetting(page, 'verboseLog')).toBe(true);

  // A hash-only change on the same document does not reload, so set the hash and
  // reload to emulate a fresh visit to /#reset (where loadSettings runs anew).
  await page.goto('/#reset');
  await page.reload();
  await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => logs.some((l) => l.includes('URL reset requested')), { timeout: 15000 })
    .toBe(true);
  await expect.poll(() => readSetting(page, 'verboseLog'), { timeout: 15000 }).toBe(false);
  // The hash directive is cleared too.
  expect((new URL(page.url()).hash || '').replace(/^#/, '')).not.toBe('reset');
});
