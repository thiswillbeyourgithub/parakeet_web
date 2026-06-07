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
import { expandSettingsSection } from './seed.mjs';

// The boost source <select> is the one carrying the Custom sentinel option.
const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

// The editable phrase textarea, located by its (unique) placeholder attribute so
// the locator is independent of the value it currently holds.
const boostTextarea = (page) =>
  page.locator('textarea[placeholder^="One phrase per line"]');

// Wait for the app's first-load boot to finish: it purges a fresh/mismatched DB
// and writes the `version` key. Seeding before this lands races the purge (which
// would wipe the seed); poll for the key so the subsequent seed sticks.
async function waitForBoot(page) {
  await page.waitForFunction(async () => {
    const DB = 'parakeetweb-settings-db', STORE = 'settings-store';
    try {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if (!db.objectStoreNames.contains(STORE)) return false;
      return await new Promise((res) => {
        const tx = db.transaction([STORE], 'readonly');
        const g = tx.objectStore(STORE).get('parakeetweb_version');
        g.onsuccess = () => res(g.result != null);
        g.onerror = () => res(false);
      });
    } catch { return false; }
  }, null, { timeout: 15 * 1000 });
}

// Seed a saved boost choice into the settings DB (to prove it isn't overridden).
async function seedSavedBoost(page, source, customText) {
  await page.evaluate(async ({ source, customText }) => {
    const DB = 'parakeetweb-settings-db', STORE = 'settings-store', PREFIX = 'parakeetweb_';
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction([STORE], 'readwrite');
      const os = tx.objectStore(STORE);
      os.put(source, PREFIX + 'boostSource');
      if (customText !== undefined) {
        os.put(customText, PREFIX + 'boostCustomText');
        // A returning Custom user's live textarea is restored from boostPhrases.
        os.put(customText, PREFIX + 'boostPhrases');
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, { source, customText });
}

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

test('?phrase_boost= does NOT override a returning user\'s saved choice', async ({ page }) => {
  // First load creates the DB; seed a saved Custom choice with custom text, then
  // reload WITH the query param. The saved choice must win.
  await page.goto('/');
  await waitForBoot(page);
  await seedSavedBoost(page, '__custom__', 'mysavedword');
  await page.goto('/?phrase_boost=clinical-cjk');
  await page.locator('.settings-toggle').click();
  // The boost controls live in the (collapsed) Phrase boosting section.
  await expandSettingsSection(page, 'Phrase boosting');

  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  // The saved custom text is retained; the curated list's phrases were NOT loaded.
  await expect(boostTextarea(page)).toHaveValue('mysavedword', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).not.toHaveValue(/venlafaxine/);
});
