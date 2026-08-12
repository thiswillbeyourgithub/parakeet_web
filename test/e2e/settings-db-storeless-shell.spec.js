// Tier-3 E2E: the app must recover from a settings DB that exists WITHOUT its
// object store, and seeding must survive booting into that state.
//
// How that state arises for real: a bare `indexedDB.open(name)` (no version)
// racing the first-boot purge's deleteDatabase recreates the DB as an empty
// version-1 shell with no store. A versioned open then never fires
// onupgradeneeded again, so before the fix every settings transaction threw
// `NotFoundError: One of the specified object stores was not found` forever:
// the app could not persist anything and test/e2e/seed.mjs crashed exactly
// there when driven by scripts/transcribe-browser.mjs (which seeds right after
// goto, inside the purge window). Two fixes cover it: openIdb (app/src/idb.js)
// self-heals by bumping the DB version to force an upgrade that creates the
// missing store, and seed.mjs no longer creates the shell in the first place
// (existence-gated storm poll, versionless retrying writer).
//
// We plant the poisoned shell deterministically before any app code runs by
// navigating to a script-free same-origin document (/favicon.svg), creating
// the shell from there, and only then loading the app. Needs no model weights,
// so it is quick. Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, readSetting } from './seed.mjs';

const SETTINGS_DB = 'parakeetweb-settings-db';

test('self-heals a store-less settings DB shell and still seeds + persists', async ({ page }) => {
  // A same-origin document that runs none of the app's scripts (the static
  // server SPA-falls-back to index.html for unknown paths, so a made-up URL
  // would boot the app; the favicon does not).
  await page.goto('/favicon.svg');
  await page.evaluate((dbName) => new Promise((resolve, reject) => {
    // Versionless open of a nonexistent DB: creates the empty version-1 shell
    // (the default onupgradeneeded creates no store), the exact poisoned state
    // the purge race leaves behind.
    const req = indexedDB.open(dbName);
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  }), SETTINGS_DB);

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });

  // Seeding used to die here (NotFoundError inside the storm-wait / writer):
  // with the shell planted, the app could never write version + sentinel, and
  // the writer's transaction threw. Now the app self-heals and this completes.
  await seedSettings(page, { verboseLog: true });

  // The seeded value must survive a reload (i.e. persistence really works
  // again: the store exists and the app reads it back).
  await page.reload();
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  await expect.poll(() => readSetting(page, 'verboseLog'), {
    timeout: 15000,
    message: 'expected the seeded setting to be readable back after reload',
  }).toBe(true);

  // No settings transaction may have blown up anywhere along the way.
  const idbErrors = pageErrors.filter((m) => m.includes('NotFoundError'));
  expect(idbErrors).toEqual([]);
});
