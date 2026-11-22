// E2E for the curated phrase-boost default: a fresh visitor can have a curated
// list pre-selected via the ?phrase_boost=<name> query param (a shareable link)
// or the operator's VITE_PHRASE_BOOST_DEFAULT env default. Per the product
// decision, NEITHER overrides a returning user's saved boost choice; they only
// seed the default when no choice is saved yet.
//
// Model-free: it only exercises the boost source selection on load, served from
// the test/e2e/fixtures/boost-phrases/ fixtures via serve.mjs.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection, seedSettings } from './seed.mjs';

// The boost source <select> is the one carrying the Custom sentinel option.
const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

// The editable phrase textarea, located by its (unique) placeholder attribute so
// the locator is independent of the value it currently holds.
const boostTextarea = (page) =>
  page.locator('textarea[placeholder^="One phrase per line"]');

test('?phrase_boost= pre-selects a curated list for a fresh visitor', async ({ page }) => {
  // Fresh profile (no seeded settings) + a shareable link naming the list by its
  // bare name (no .txt). The app should normalise it, select it, and load it.
  await page.goto('/?phrase_boost=clinical-cjk');
  await page.locator('.settings-toggle').click();
  // The boost controls live in the (collapsed) Phrase boosting section.
  await expandSettingsSection(page, 'Phrase boosting');

  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt', { timeout: 15 * 1000 });
  // The fetched list text is loaded into the boost textarea.
  await expect(boostTextarea(page)).toHaveValue(/venlafaxine/, { timeout: 15 * 1000 });
});

test('VITE_PHRASE_BOOST_DEFAULT pre-selects a curated list for a fresh visitor', async ({ page }) => {
  // Simulate the operator's env default by injecting the runtime config the
  // docker entrypoint would write (window.__CONFIG__), before any app script
  // runs. No URL param, fresh profile: the env default should be selected.
  await page.addInitScript(() => {
    window.__CONFIG__ = { VITE_PHRASE_BOOST_DEFAULT: 'clinical-cjk' };
  });
  await page.goto('/');
  await page.locator('.settings-toggle').click();
  // The boost controls live in the (collapsed) Phrase boosting section.
  await expandSettingsSection(page, 'Phrase boosting');

  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveValue(/venlafaxine/, { timeout: 15 * 1000 });
});

test('the Disabled choice turns boosting off, hides the textarea, and persists', async ({ page }) => {
  // Start with a curated list selected (its phrases loaded into the textarea),
  // then pick the Disabled option. Boosting must switch off: the editable
  // textarea is replaced by the disabled hint, and the choice survives a reload.
  await page.goto('/?phrase_boost=clinical-cjk');
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');

  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveValue(/venlafaxine/, { timeout: 15 * 1000 });

  // Switch to Disabled. The textarea disappears and the off-hint shows.
  await boostSelect(page).selectOption('__disabled__');
  await expect(boostSelect(page)).toHaveValue('__disabled__');
  await expect(boostTextarea(page)).toHaveCount(0);
  await expect(page.getByText(/Phrase boosting is turned off/)).toBeVisible();

  // The choice persists across a reload (and does not fall back to a curated
  // list / Custom): still Disabled, still no boost textarea.
  await page.reload();
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(boostSelect(page)).toHaveValue('__disabled__', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveCount(0);
});

test('?phrase_boost= does NOT override a returning user\'s saved choice', async ({ page }) => {
  // First load creates the DB; seed a saved Custom choice with custom text, then
  // reload WITH the query param. The saved choice must win.
  await page.goto('/');
  // A returning Custom user's live textarea is restored from boostPhrases, so
  // the saved text goes in both keys.
  await seedSettings(page, {
    boostSource: '__custom__',
    boostCustomText: 'mysavedword',
    boostPhrases: 'mysavedword',
  });
  await page.goto('/?phrase_boost=clinical-cjk');
  await page.locator('.settings-toggle').click();
  // The boost controls live in the (collapsed) Phrase boosting section.
  await expandSettingsSection(page, 'Phrase boosting');

  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  // The saved custom text is retained; the curated list's phrases were NOT loaded.
  await expect(boostTextarea(page)).toHaveValue('mysavedword', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).not.toHaveValue(/venlafaxine/);
});
