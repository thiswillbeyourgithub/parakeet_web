// E2E for the lazy phrase-boost editor: an oversized *Custom* list is collapsed
// to a summary card instead of being mounted in a controlled textarea, and the
// editor is only mounted when the user explicitly asks for it.
//
// Mounting a textarea holding a 75k-line list costs ~1 s of blocked main thread
// in Chromium. Custom text used to be rendered at any size, so that second was
// paid on every switch to Custom and on every reopen of the "Phrase boosting"
// section, which is what made both feel frozen. The list is still fully applied
// to transcription; only the editor is deferred.
//
// Model-free: pure settings + sidebar rendering.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';

// Comfortably past BOOST_CUSTOM_COLLAPSE_MIN_LINES (1000) in App.jsx.
const BIG_LIST = Array.from({ length: 1200 }, (_, i) => `phrase${i}`).join('\n');
const SMALL_LIST = 'venlafaxine:5\nacetaminophen';

const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

const boostTextarea = (page) =>
  page.locator('textarea[placeholder^="One phrase per line"]');

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

async function seedCustomList(page, text) {
  await page.evaluate(async (text) => {
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
      os.put('__custom__', PREFIX + 'boostSource');
      os.put(text, PREFIX + 'boostCustomText');
      os.put(text, PREFIX + 'boostPhrases');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, text);
}

async function openBoostSection(page) {
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
}

test('a large custom list is summarised, not mounted, until the editor is asked for', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await seedCustomList(page, BIG_LIST);
  await page.reload();
  await openBoostSection(page);

  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  // The summary card stands in for the editor, and reports the list size.
  await expect(page.getByText(/Large custom list \(1200 lines\)/)).toBeVisible();
  await expect(boostTextarea(page)).toHaveCount(0);
  // The list itself is untouched: still counted as active phrases.
  await expect(page.getByText(/1200 phrase\(s\) active/)).toBeVisible();

  // Asking for the editor mounts it, with the full text.
  await page.getByRole('button', { name: 'Edit as text' }).click();
  await expect(boostTextarea(page)).toHaveValue(BIG_LIST);
});

test('the editor re-collapses after switching source away and back', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await seedCustomList(page, BIG_LIST);
  await page.reload();
  await openBoostSection(page);

  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  await page.getByRole('button', { name: 'Edit as text' }).click();
  await expect(boostTextarea(page)).toHaveCount(1);

  // Away to a curated list, then back: the giant textarea must NOT come back
  // on its own, otherwise the switch pays the mount cost all over again.
  await boostSelect(page).selectOption('clinical-cjk.txt');
  await expect(boostSelect(page)).toHaveValue('clinical-cjk.txt');
  await boostSelect(page).selectOption('__custom__');
  await expect(boostSelect(page)).toHaveValue('__custom__');
  await expect(boostTextarea(page)).toHaveCount(0);
  await expect(page.getByText(/Large custom list \(1200 lines\)/)).toBeVisible();
});

test('reopening the section does not re-mount the editor', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await seedCustomList(page, BIG_LIST);
  await page.reload();
  await openBoostSection(page);

  await page.getByRole('button', { name: 'Edit as text' }).click();
  await expect(boostTextarea(page)).toHaveCount(1);

  // Collapse and reopen the settings group (its body unmounts when closed).
  const groupToggle = page.locator('.settings-group-toggle', { hasText: 'Phrase boosting' });
  await groupToggle.click();
  await expect(boostTextarea(page)).toHaveCount(0);
  await groupToggle.click();
  await expect(page.getByText(/Large custom list \(1200 lines\)/)).toBeVisible();
  await expect(boostTextarea(page)).toHaveCount(0);
});

test('an ordinary hand-written list is still editable inline', async ({ page }) => {
  // The gate must not get in the way of the normal case: a small list opens
  // straight into the textarea, with no extra click.
  await page.goto('/');
  await waitForBoot(page);
  await seedCustomList(page, SMALL_LIST);
  await page.reload();
  await openBoostSection(page);

  await expect(boostSelect(page)).toHaveValue('__custom__', { timeout: 15 * 1000 });
  await expect(boostTextarea(page)).toHaveValue(SMALL_LIST);
  await expect(page.getByText(/Large custom list/)).toHaveCount(0);
});

test('Clear empties an oversized custom list', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  await seedCustomList(page, BIG_LIST);
  await page.reload();
  await openBoostSection(page);

  await expect(page.getByText(/Large custom list \(1200 lines\)/)).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // Back to an empty, editable box, and the choice sticks across a reload.
  await expect(boostTextarea(page)).toHaveValue('');
  await page.reload();
  await openBoostSection(page);
  await expect(boostTextarea(page)).toHaveValue('', { timeout: 15 * 1000 });
});
