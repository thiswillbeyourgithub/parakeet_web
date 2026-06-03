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
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/sample.aac');
const GOLDEN = readFileSync(resolve(here, '../fixtures/sample.expected.txt'), 'utf-8').trim();

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

  // Feed the fixture clip into the hidden file input; uploads always transcribe
  // immediately, so transcription starts on its own.
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

  // The audio is attached to the entry: toggle its inline player open and
  // assert an <audio> element appears inside the entry.
  await page.locator('.history-modes button', { hasText: 'Audio' }).first().click();
  await expect(page.locator('.history-audio audio').first()).toBeVisible({ timeout: 10 * 1000 });

  // "Transcribe again" re-runs the pipeline on the stored audio and replaces
  // the entry's text in place (no new entry is appended).
  const before = (await historyText.innerText()).trim();
  await page.getByRole('button', { name: 'Transcribe again' }).first().click();
  // The button label flips to a transient "Transcribing..." while running, then
  // back; waiting for it to return proves the re-run completed.
  await expect(page.getByRole('button', { name: 'Transcribe again' }).first())
    .toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(historyText).not.toBeEmpty();
  const after = (await historyText.innerText()).trim();
  expect(overlap(words(before), words(after)),
    `re-transcribe "${after}" vs first "${before}"`).toBeGreaterThanOrEqual(0.7);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('refuses a file picked while the model is still loading', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Capture and dismiss any alert; record its message so we can assert on it.
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  // Kick off the model load, then immediately feed a file while it is still
  // loading (the int8 weights take seconds to download/init, so the input is
  // set well before the ✔ ready marker appears).
  await page.locator('[data-umami-event="load_model_button"]').click();
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  // The file must be refused with the "still loading" message, not queued.
  await expect.poll(() => dialogs.length, { timeout: 30 * 1000 }).toBeGreaterThan(0);
  expect(dialogs.some((m) => /still loading/i.test(m))).toBe(true);

  // And nothing must be transcribed: no history entry is rendered.
  await expect(page.locator('.history-item')).toHaveCount(0);
});
