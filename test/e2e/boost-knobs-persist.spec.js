// E2E for the advanced phrase-boost knobs in the sidebar (the CLI's
// --boost-minp / --depth-scaling, exposed as "Min-p gate override" and
// "Depth scaling" in the Phrase boosting section):
//  - they render with their persisted values when a phrase list is present,
//  - they are hidden while the list is empty (they do nothing without phrases,
//    mirroring how the MAES rows hide at beam width 1),
//  - a UI edit persists across a reload.
// Runs entirely pre-model (no weights downloaded): the knobs are plain
// settings plumbing, independent of the tokenizer/trie build.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

const SETTINGS_DB = 'parakeetweb-settings-db';
const SETTINGS_STORE = 'settings-store';

// Read one (unprefixed) key back from the app's settings DB, so the spec can
// deterministically wait for a UI edit's async IDB write instead of sleeping.
function readSetting(page, key) {
  return page.evaluate(({ DB, STORE, key }) => new Promise((resolve) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction([STORE], 'readonly').objectStore(STORE).get(`parakeetweb_${key}`);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); resolve(undefined); };
    };
    req.onerror = () => resolve(undefined);
  }), { DB: SETTINGS_DB, STORE: SETTINGS_STORE, key });
}

const knobInput = (page, label) =>
  page.locator('.setting-row', { hasText: label }).locator('input[type="number"]');

test('boost min-p and depth-scaling knobs restore, gate on phrases, and persist edits', async ({ page }) => {
  // First load creates the settings DB; seed a custom phrase list plus
  // non-default knob values, then reload so the app restores them.
  await page.goto('/');
  await seedSettings(page, {
    boostSource: '__custom__',
    boostPhrases: 'venlafaxine:5',
    boostCustomText: 'venlafaxine:5',
    boostMinp: 0.3,
    boostDepthScaling: 1.5,
  });
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');

  // Both knobs are visible (a phrase list is loaded) with the seeded values.
  const minp = knobInput(page, 'Min-p gate override');
  const depth = knobInput(page, 'Depth scaling');
  await expect(minp).toHaveValue('0.3');
  await expect(depth).toHaveValue('1.5');

  // Clearing the phrase list hides the knobs (nothing to boost, so the rows
  // are inert); typing a phrase back brings them back.
  const textarea = page.getByPlaceholder(/One phrase per line/);
  await textarea.fill('');
  await expect(minp).toHaveCount(0);
  await expect(depth).toHaveCount(0);
  await textarea.fill('venlafaxine:5');
  await expect(minp).toHaveValue('0.3');

  // A UI edit persists: change both knobs, wait for the async IDB write, then
  // reload and confirm the restored inputs carry the new values.
  await minp.fill('0.5');
  await depth.fill('2');
  await expect.poll(() => readSetting(page, 'boostMinp')).toBe(0.5);
  await expect.poll(() => readSetting(page, 'boostDepthScaling')).toBe(2);

  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(knobInput(page, 'Min-p gate override')).toHaveValue('0.5');
  await expect(knobInput(page, 'Depth scaling')).toHaveValue('2');

  // Min-p is a monotonic gate now: 0 is a REAL value (boost all), not "off".
  // It must persist as 0, not snap back to a strict per-phrase default.
  const minp2 = knobInput(page, 'Min-p gate override');
  await minp2.fill('0');
  await expect.poll(() => readSetting(page, 'boostMinp')).toBe(0);

  // Clearing the field entirely = off (per-phrase gates); it persists as null
  // (distinct from 0) and restores as a blank input across a reload.
  await minp2.fill('');
  await expect.poll(() => readSetting(page, 'boostMinp')).toBe(null);
  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(knobInput(page, 'Min-p gate override')).toHaveValue('');
});
