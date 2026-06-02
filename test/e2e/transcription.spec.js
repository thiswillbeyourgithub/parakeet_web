// Tier-3 happy-path E2E: load the WASM int8 model in a real headless Chromium
// and transcribe a short fixture clip end to end, asserting the transcript
// against a committed golden produced by the same int8 model (scripts/
// transcribe.mjs). This is the slow, realistic tier; it is NOT run pre-push.
//
// The static server (serve.mjs) serves the weights locally at /models, so the
// model source is forced to 'local' (seeded into the app's IndexedDB settings)
// and the backend to 'wasm' (headless Chromium has no WebGPU and the int8
// encoder is the only one that fits the blob-fetch cap; see CLAUDE.md).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/sample.aac');
const GOLDEN = readFileSync(resolve(here, '../fixtures/sample.expected.txt'), 'utf-8').trim();

// Normalize for a diacritic/punctuation/case-insensitive word comparison so the
// assertion is robust to trivial rendering differences but still pins the words.
function words(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function overlap(a, b) {
  const setB = new Set(b);
  const hit = a.filter((w) => setB.has(w)).length;
  return hit / Math.max(a.length, 1);
}

// Seed the app's settings DB so it loads the model from /models with WASM.
async function seedSettings(page) {
  await page.evaluate(async () => {
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
      os.put('local', PREFIX + 'modelSource');
      os.put('wasm', PREFIX + 'backend');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
}

test('transcribes a short clip with the WASM int8 model', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // First load creates the settings DB/store; seed it, then reload so the app
  // picks up local model source + wasm backend.
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Kick off the model load. The button carries the umami event hook used by
  // the README screenshot recipe.
  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the app renders a ✔ once weights are loaded and initialised.
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Feed the fixture clip into the hidden file input; autoTranscribe is on by
  // default, so transcription starts on its own.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  // The transcript renders into the newest .history-text block.
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  // Give the text a moment to settle, then compare to the golden transcript.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
