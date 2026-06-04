// Tier-3 happy-path E2E: load the WASM int8 model in a real headless Chromium
// and transcribe a short fixture clip end to end, asserting the transcript
// against a committed golden produced by the same int8 model (scripts/
// transcribe.mjs). This is the slow, realistic tier; it is NOT run pre-push.
//
// It runs over a list of fixtures so the model is exercised on more than one
// language/container: a short French clinical clip (AAC) and the public-domain
// JFK inaugural excerpt (English, MP3). Add a fixture by dropping <clip> +
// <clip>.expected.txt into test/fixtures and appending to FIXTURES below.
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
const fixture = (name) => resolve(here, '../fixtures', name);

// Each fixture pairs an audio clip with the golden transcript the int8 model
// produces for it (generated with scripts/transcribe.mjs).
const FIXTURES = [
  { label: 'French clinical (AAC)', audio: 'sample.aac', golden: 'sample.expected.txt' },
  { label: 'JFK English (MP3)', audio: 'jfk.mp3', golden: 'jfk.expected.txt' },
];

for (const fx of FIXTURES) {
  test(`transcribes ${fx.label} with the WASM int8 model`, async ({ page }) => {
    const FIXTURE_AUDIO = fixture(fx.audio);
    const GOLDEN = readFileSync(fixture(fx.golden), 'utf-8').trim();

    const errors = [];
    // The shared transcription pipeline logs this line once per completed run
    // (initial upload + each "Transcribe again"); counting it is a deterministic
    // completion signal that does not depend on any transient UI.
    let transcribeRuns = 0;
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
      if (m.text().includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
    });

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

    // "Transcribe again" lives in the per-entry kebab (⋮) "More actions" menu.
    // Open the menu, then click it to re-run the pipeline on the stored audio;
    // the re-run replaces the entry's text in place (no new entry is appended).
    // The click also dismisses the kebab (a global click handler closes it), so
    // the menu item is gone immediately; track the run via the header spinner,
    // which is shown only while a transcription is in flight.
    const before = (await historyText.innerText()).trim();
    const runsBefore = transcribeRuns;
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('button', { name: 'Transcribe again' }).first().click();
    // Wait for the pipeline to log a second completion (the re-run finished).
    await expect.poll(() => transcribeRuns, { timeout: 6 * 60 * 1000 }).toBeGreaterThan(runsBefore);
    await expect(page.locator('.history-item')).toHaveCount(1);
    await expect(historyText).not.toBeEmpty();
    const after = (await historyText.innerText()).trim();
    expect(overlap(words(before), words(after)),
      `re-transcribe "${after}" vs first "${before}"`).toBeGreaterThanOrEqual(0.7);

    expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
}
