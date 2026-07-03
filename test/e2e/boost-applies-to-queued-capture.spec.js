// Tier-3 E2E regression for the boost-trie race: a transcription that starts
// the instant the model becomes ready (here: a file queued while the model was
// still loading; the queue drains in the very tick that publishes the vocab
// signature) must still decode WITH the configured phrase-boost trie. The trie
// is rebuilt asynchronously (300 ms debounce + BPE encode, and the rebuild
// effect only runs after the next render), so before the fix the queued first
// run raced it and silently decoded boost-less: same file, same sidebar, a
// different transcript than every later run. runTranscription now awaits
// waitForBoostReady() before decoding.
//
// Proven through the decode-debug view: the run's Debug summary lists the
// boosted-token count only when at least one emitted token carried a boost
// bonus, so "boosted" appearing there is exactly "the trie was active".
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// French clinical clip. The boost phrase is Title-case on purpose: the model
// opens the drug name with a capital ("...de la V el na f ac ine"), so the
// trie's first token IS the winner path's first token and a winner-path boost
// bonus is guaranteed whenever the trie was active, independent of whether the
// rest of the word flips (a lowercase phrase would never overlap the winner
// here and would show 0 boosted tokens even with the trie live).
const FIXTURE_AUDIO = resolve(here, '../fixtures/sample.aac');

test('a capture queued during model load transcribes with phrase boosting active', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Hold the encoder download open so the app parks in 'loadingModel' long
  // enough to upload mid-load (same recipe as capture-queued-during-load).
  await page.route('**/encoder-model.int8.onnx', async (route) => {
    await new Promise((r) => setTimeout(r, 8000));
    await route.continue();
  });

  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  // Custom boost list + the decode-debug collection (the instrument that shows
  // whether boosting was applied to a given run). Greedy keeps the run fast.
  await seedSettings(page, {
    debugDecode: true,
    beamWidth: 1,
    boostSource: '__custom__',
    boostPhrases: 'Venlafaxine:5',
    boostCustomText: 'Venlafaxine:5',
  });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Upload while still loading so the clip lands in the capture queue.
  const fileInput = page.locator('#audio-file-input');
  await fileInput.waitFor({ state: 'attached', timeout: 30 * 1000 });
  await expect(page.locator('body')).not.toContainText('✔');
  await fileInput.setInputFiles(FIXTURE_AUDIO);
  await expect(page.locator('.banner--info', { hasText: /transcrib/i })).toBeVisible({ timeout: 10 * 1000 });

  // Model ready -> queue drains on its own -> transcript appears.
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // The run carried a decode-debug payload; open the Debug view and assert the
  // summary counts boosted tokens, i.e. the trie was live for THIS run. Before
  // the fix this fails: the summary reads "greedy · N tokens" with no boosted
  // segment because the queued run started before the trie build finished.
  await page.locator('.history-modes button', { hasText: 'Debug' }).first().click();
  const summary = page.locator('.decode-debug__summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/boosted/, { timeout: 15 * 1000 });

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
