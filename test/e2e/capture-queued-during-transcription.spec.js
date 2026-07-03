// Tier-3 E2E: while a transcription is RUNNING, the capture entry points
// (upload / record / phone) must stay usable so more audio can be added to the
// capture queue; the queued clip transcribes automatically when the current
// run finishes. Previously all three were disabled for the whole run, so the
// queue could only be fed while the model was loading (Q2), never while busy.
//
// Flow: load the WASM int8 model, upload clip A (the 3-minute JFK moon
// speech: WASM inference takes minutes, so the mid-run window cannot be
// missed; the short 11 s JFK clip proved too fast on a quick machine), wait
// until A's decode/resample is done (console signal) so it is inside model
// inference, assert the three controls are still enabled, then upload clip B
// (French AAC). B must surface the queued-captures banner, wait its turn, and
// both transcripts must match their goldens in submission order (A then B).
//
// Reuses the WASM-int8 local-model setup (serve.mjs serves the weights at
// /models; seedSettings forces local source + wasm).
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
const GOLDEN_A = readFileSync(fixture('jfk-moon-3min.expected.txt'), 'utf-8').trim();
const GOLDEN_B = readFileSync(fixture('sample.expected.txt'), 'utf-8').trim();

test('a file uploaded while another transcription runs is queued and transcribed after it', async ({ page }) => {
  // Two full transcriptions (one of them the 3-minute clip) plus the model
  // load: give this test more headroom than the 8-minute default.
  test.setTimeout(12 * 60 * 1000);

  const errors = [];
  // Decode-phase completion signal for clip A: once processAudioFile logs the
  // resample as done, the clip has been handed to the queue and (with the
  // model ready and idle) runTranscription is already inside model inference.
  // Uploading B only after this guarantees the A-then-B queue order the
  // golden assertions below rely on.
  let resampleLogs = 0;
  let transcribeRuns = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().includes('[Transcribe] Resampled successfully')) resampleLogs += 1;
    if (m.text().includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Clip A starts transcribing immediately (model ready, queue empty).
  await page.locator('#audio-file-input').setInputFiles(fixture('jfk-moon-3min.mp3'));
  await expect.poll(() => resampleLogs, { timeout: 60 * 1000 }).toBeGreaterThan(0);
  await expect(page.locator('.app-header__status')).toContainText('Transcribing');

  // The crux: mid-run, all three capture entry points are still usable (they
  // used to be disabled until the run ended).
  await expect(page.locator('#audio-file-input')).toBeEnabled();
  await expect(page.locator('label[for="audio-file-input"]')).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('[data-umami-event="record_button"]')).toBeEnabled();
  await expect(page.getByRole('button', { name: /Phone Mic/i })).toBeEnabled();

  // Feed clip B while A is still running: it must decode quietly and join the
  // queue (surfacing the queued-captures banner), not clobber A's run.
  await page.locator('#audio-file-input').setInputFiles(fixture('sample.aac'));
  await expect(page.locator('.banner--info', { hasText: /queued/i })).toBeVisible({ timeout: 60 * 1000 });
  // B's decode phase must not steal the status line from A's run.
  await expect(page.locator('.app-header__status')).toContainText('jfk');

  // Both runs complete on their own: A's finally drains the queue into B.
  await expect.poll(() => transcribeRuns, { timeout: 6 * 60 * 1000 }).toBe(2);
  const entries = page.locator('.history-text');
  await expect(entries).toHaveCount(2);

  // Newest entry first: B (French AAC) on top, A (JFK) below.
  await expect(async () => {
    const gotB = (await entries.nth(0).innerText()).trim();
    const gotA = (await entries.nth(1).innerText()).trim();
    const oB = overlap(words(GOLDEN_B), words(gotB));
    const oA = overlap(words(GOLDEN_A), words(gotA));
    expect(oB, `queued "${gotB}" vs golden "${GOLDEN_B}" overlap ${oB.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
    expect(oA, `first "${gotA}" vs golden "${GOLDEN_A}" overlap ${oA.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // Queue drained: the banner is gone.
  await expect(page.locator('.banner--info', { hasText: /queued/i })).toHaveCount(0);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
