// Regression E2E: a curated phrase list must never leak into the user's own
// "Custom" slot, and its text must not be persisted at all.
//
// `boostPhrases` (the live textarea contents) used to be saved unconditionally,
// curated lists included, so selecting a large clinical lexicon wrote ~2 MB to
// IndexedDB on every change. Worse, the Custom-slot migration seeded the user's
// editable text from that same key without checking which source was saved, so a
// profile that had a curated list selected before `boostCustomText` existed came
// back with the whole lexicon pasted into its Custom box. Selecting "Custom"
// then had to mount a 75k-line textarea (~1 s) and re-encode the list from
// scratch, which is what made the switch feel frozen.
//
// Model-free: it only exercises settings persistence and the boost source
// selector, served from test/e2e/fixtures/boost-phrases/ via serve.mjs.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection, readSetting, seedSettings } from './seed.mjs';

const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

const boostTextarea = (page) =>
  page.locator('textarea[placeholder^="One phrase per line"]');


test('a legacy curated-list profile does not seed the Custom slot with the list', async ({ page }) => {
  // Simulate a pre-`boostCustomText` profile that had a curated list selected:
  // the list text is in `boostPhrases` and there is no `boostCustomText`.
  await page.goto('/');
  await seedSettings(page, {
    boostSource: 'clinical-cjk.txt',
    boostPhrases: 'venlafaxine:5\nacetaminophen\nmetoprolol',
  });

  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt', { timeout: 15 * 1000 });

  // Switching to Custom must land on an EMPTY box: the curated text was never
  // the user's own, so it must not have been migrated into their slot.
  await boostSelect(page).selectOption('__custom__');
  await expect(boostSelect(page)).toHaveValue('__custom__');
  await expect(boostTextarea(page)).toHaveValue('');
});

test('a genuine legacy Custom profile still keeps its typed text', async ({ page }) => {
  // The other half of the migration: when the saved source IS Custom, the
  // pre-feature `boostPhrases` is still the user's own text and must survive.
  await page.goto('/');
  await seedSettings(page, {
    boostSource: '__custom__',
    boostPhrases: 'mytypedword',
  });

  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveValue('mytypedword', { timeout: 15 * 1000 });
});

test('selecting a curated list does not persist its text', async ({ page }) => {
  await page.goto('/?phrase_boost=clinical-cjk');
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveValue(/venlafaxine/, { timeout: 15 * 1000 });

  // The list is re-fetched from /boost-phrases/ on every load, so storing its
  // text buys nothing and costs a multi-MB IndexedDB write per selection.
  await expect.poll(() => readSetting(page, 'boostPhrases'), { timeout: 10 * 1000 })
    .toBe('');
});
