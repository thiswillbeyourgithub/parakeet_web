// E2E for the auto-coupled beam width default (app/ui/src/lib/beamWidth.js +
// the App.jsx wiring): while the user has never chosen a width, it follows the
// phrase-boost state (greedy with no list, the device-tier default with one,
// per the 2026-08 French-medical sweep where the beam effect flips sign with
// the lexical prior); an explicit edit ends the coupling for good, and a
// legacy profile's non-default width is honoured as a deliberate choice.
//
// Runs entirely pre-model (no weights downloaded): the coupling is plain
// settings plumbing plus the parse-time phrase count, independent of the
// tokenizer/trie build.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection, readSetting, deleteSetting } from './seed.mjs';

const beamRow = (page) => page.locator('.setting-row', { hasText: 'Beam Width' });
const beamInput = (page) => beamRow(page).locator('input[type="number"]');
const boostTextarea = (page) => page.locator('textarea[placeholder^="One phrase per line"]');

test('beam width follows the boost state until the user sets it by hand', async ({ page }) => {
  await page.goto('/');
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');

  // Fresh install, no phrase list: greedy, marked as automatic.
  const beam = beamInput(page);
  await expect(beam).toHaveValue('1');
  await expect(beamRow(page)).toContainText('(auto)');

  // Typing a phrase list widens the beam to the device-tier default (above 1
  // on any desktop-class machine, which headless Chromium reports as).
  await expandSettingsSection(page, 'Phrase boosting');
  await boostTextarea(page).fill('venlafaxine:5');
  await expect.poll(async () => Number(await beam.inputValue())).toBeGreaterThan(1);

  // Clearing the list drops back to greedy.
  await boostTextarea(page).fill('');
  await expect(beam).toHaveValue('1');

  // An explicit edit ends the coupling: the hint disappears, the flag
  // persists as false, and the boost state no longer moves the width.
  await beam.fill('3');
  await expect.poll(() => readSetting(page, 'beamWidthAuto')).toBe(false);
  await expect(beamRow(page)).not.toContainText('(auto)');
  await boostTextarea(page).fill('venlafaxine:5');
  // The min-p knob renders only once the phrase list is live, so its presence
  // proves the boost state propagated; the width must not have followed.
  await expect(page.locator('.setting-row', { hasText: 'Min-p gate override' })).toHaveCount(1);
  await expect(beam).toHaveValue('3');

  // The choice survives a reload.
  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(beamInput(page)).toHaveValue('3');
  await expect(beamRow(page)).not.toContainText('(auto)');
});

test('legacy profile: a persisted non-default width is honoured, not coupled', async ({ page }) => {
  await page.goto('/');
  // Pre-feature profile: a beamWidth but no beamWidthAuto flag. 7 matches no
  // device tier, so it must be treated as a deliberate choice. The first boot
  // above already stamped the flag (the default-persist storm writes every
  // known key), so delete it to make the DB shape truly pre-feature.
  await seedSettings(page, { beamWidth: 7 });
  await deleteSetting(page, 'beamWidthAuto');
  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(beamInput(page)).toHaveValue('7');
  await expect(beamRow(page)).not.toContainText('(auto)');
});
