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
import { expandSettingsSection } from './seed.mjs';

const DB = 'parakeetweb-settings-db';
const STORE = 'settings-store';
const PREFIX = 'parakeetweb_';

const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

const boostTextarea = (page) =>
  page.locator('textarea[placeholder^="One phrase per line"]');

// Wait for the app's first-load boot (it purges a fresh/mismatched DB and writes
// the `version` key); seeding before that lands races the purge.
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

async function putSettings(page, entries) {
  await page.evaluate(async ({ entries, DB, STORE, PREFIX }) => {
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
      for (const [k, v] of entries) os.put(v, PREFIX + k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, { entries, DB, STORE, PREFIX });
}

function readSetting(page, key) {
  return page.evaluate(async ({ key, DB, STORE, PREFIX }) => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open(DB);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!db.objectStoreNames.contains(STORE)) return undefined;
    return await new Promise((res) => {
      const tx = db.transaction([STORE], 'readonly');
      const g = tx.objectStore(STORE).get(PREFIX + key);
      g.onsuccess = () => res(g.result);
      g.onerror = () => res(undefined);
    });
  }, { key, DB, STORE, PREFIX });
}

test('a legacy curated-list profile does not seed the Custom slot with the list', async ({ page }) => {
  // Simulate a pre-`boostCustomText` profile that had a curated list selected:
  // the list text is in `boostPhrases` and there is no `boostCustomText`.
  await page.goto('/');
  await waitForBoot(page);
  await putSettings(page, [
    ['boostSource', 'clinical-cjk.txt'],
    ['boostPhrases', 'venlafaxine:5\nacetaminophen\nmetoprolol'],
  ]);

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
  await waitForBoot(page);
  await putSettings(page, [
    ['boostSource', '__custom__'],
    ['boostPhrases', 'mytypedword'],
  ]);

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
