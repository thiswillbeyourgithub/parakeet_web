// Tier-3 multilingual regression E2E: transcribe a committed set of FLEURS
// validation clips (10 English + 10 French) end to end in real headless
// Chromium on the WASM int8 model, and assert each transcript against TWO
// goldens carried in test/fixtures/fleurs/manifest.json:
//   - `expected`: this repo's own int8 pipeline transcript (a tight regression
//     anchor: a decoder/beam/mel change that drifts the output trips it),
//   - `reference`: the FLEURS human label (a looser quality floor: the model
//     must still recover most of what was actually said).
// Both are compared on the normalised word set (text-overlap.mjs), robust to the
// casing/accent/punctuation differences between runs.
//
// Unlike transcription.spec.js (one test per fixture, one model load each), this
// loads the model ONCE and then loops every clip through the file input, so 20
// clips cost one model load. The fixtures are produced by
// scripts/gen-fleurs-fixtures.mjs; see ARCHITECTURE.md.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FX = resolve(here, '../fixtures/fleurs');
const manifest = JSON.parse(readFileSync(resolve(FX, 'manifest.json'), 'utf-8'));

// Looser than `expected` because the FLEURS human label and the model can
// legitimately differ on a few words; the generator already guarantees a high
// reference overlap at fixture-build time, so this floor has plenty of margin.
const EXPECTED_FLOOR = 0.7; // browser output vs this repo's committed int8 golden
const REFERENCE_FLOOR = 0.6; // browser output vs the FLEURS human label

test('transcribes the FLEURS en+fr clips against model golden and human reference', async ({ page }) => {
  // One model load + 20 short transcriptions; well over the default per-test cap.
  test.setTimeout(20 * 60 * 1000);

  const errors = [];
  // The pipeline logs this once per completed run; counting it is a deterministic
  // completion signal independent of any transient UI.
  let runs = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().includes('[Transcribe] Total time for entire audio')) runs += 1;
  });

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  const historyText = page.locator('.history-text').first();

  for (let i = 0; i < manifest.clips.length; i++) {
    const clip = manifest.clips[i];
    const before = runs;

    // Uploads transcribe immediately. New entries are prepended, so the newest
    // is always .history-text first().
    await page.locator('#audio-file-input').setInputFiles(resolve(FX, clip.audio));
    await expect.poll(() => runs, { timeout: 6 * 60 * 1000 }).toBeGreaterThan(before);
    await expect(page.locator('.history-item')).toHaveCount(i + 1);
    // The per-chunk callback can leave a transient " [transcribing...]" suffix;
    // wait for it to clear before reading the final transcript.
    await expect(historyText).not.toContainText('transcribing', { timeout: 60 * 1000 });

    const got = (await historyText.innerText()).trim();
    const oExp = overlap(words(clip.expected), words(got));
    expect(oExp, `${clip.lang}/${clip.id}: "${got}" vs golden "${clip.expected}" overlap ${oExp.toFixed(2)}`)
      .toBeGreaterThanOrEqual(EXPECTED_FLOOR);
    const oRef = overlap(words(clip.reference), words(got));
    expect(oRef, `${clip.lang}/${clip.id}: "${got}" vs reference "${clip.reference}" overlap ${oRef.toFixed(2)}`)
      .toBeGreaterThanOrEqual(REFERENCE_FLOOR);
  }

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
