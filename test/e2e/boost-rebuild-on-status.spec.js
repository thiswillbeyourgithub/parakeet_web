// Tier-3 regression E2E: the phrase-boost trie must rebuild once per real model
// change, NOT on every `status` transition. The boost rebuild effect used to
// depend on the raw `status` string, which also flips on recording start/stop,
// file transcribe, and each chunk-progress tick. On a large curated list each
// flip re-ran parseBoostPhrases + the trie rebuild and pushed fresh
// boost-warning arrays that forced the giant phrase-list textarea to reconcile,
// freezing the "My Computer" tab. The fix keys the effect on the loaded
// tokenizer's vocab signature instead, so unrelated status churn no longer
// rebuilds.
//
// This pins it end to end: with verbose logging on, "[Boost] rebuilding trie"
// is logged once per rebuild. We record the count once the model is ready, run
// a full transcription (which flips `status` through transcribing -> modelReady
// and would re-trigger the buggy effect when it lands back on modelReady), and
// assert the count did not grow. Reuses the WASM-int8 local-model setup of
// transcription.spec.js.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/sample.aac');

// Seed the settings DB so the app loads the model from /models with WASM, with
// verbose logging on and a Custom boost list present (a few phrases is enough to
// build a trie and emit the rebuild log; the bug is about *how often* it
// rebuilds, not list size).
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
      os.put(true, PREFIX + 'verboseLog');
      os.put('__custom__', PREFIX + 'boostSource');
      os.put('venlafaxine\nacetaminophen\nmetoprolol', PREFIX + 'boostPhrases');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
}

test('boost trie does not rebuild on transcribe status churn', async ({ page }) => {
  let boostRebuilds = 0;
  page.on('console', (m) => {
    if (m.type() === 'log' && m.text().includes('[Boost] rebuilding trie')) boostRebuilds += 1;
  });

  // First load creates the settings DB/store; seed it, then reload so the app
  // picks up local model source + wasm backend + the boost list.
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the app renders a ✔ once weights are loaded and initialised.
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Let the post-model-ready rebuild (and its 300ms debounce) settle, then take
  // the baseline: this is the one legitimate rebuild (the vocab became known).
  await expect.poll(() => boostRebuilds, { timeout: 30 * 1000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1000);
  const afterReady = boostRebuilds;

  // Transcribe the fixture clip. autoTranscribe is on by default, so feeding the
  // file starts it; this churns `status` (transcribing... -> modelReady) which
  // is exactly what used to re-trigger the rebuild.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  // Give any (buggy) status-driven rebuild its debounce window to fire.
  await page.waitForTimeout(1000);
  expect(
    boostRebuilds,
    `boost trie rebuilt ${boostRebuilds - afterReady} extra time(s) on transcribe status churn (expected 0)`,
  ).toBe(afterReady);
});
