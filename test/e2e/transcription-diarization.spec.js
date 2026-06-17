// Tier-3 E2E proving the sherpa-onnx speaker-diarization path actually loads and
// runs in a real headless Chromium: load the WASM int8 ASR model, transcribe a
// two-speaker clip, click the per-entry "Speakers" button, and assert the
// transcript regroups into colour-coded Speaker turns with >= 2 distinct
// speakers. This is the in-browser proof the vendored WASM engine (its own ONNX
// Runtime), the two diarization models, and the word->speaker assignment all
// work end to end; the pure pieces are unit-tested (test/unit/speaker-assign).
//
// The fixture two-speakers.wav is JFK's English excerpt (~11 s) followed by a
// FLEURS English clip read by a different speaker (~5 s), two acoustically very
// different voices, so the diarizer must split it into at least two speakers and
// the first turn's speaker must differ from the last turn's. It is a
// loudness-normalised lossless WAV: the browser's MP3 decoder degraded the
// quieter second speaker enough that the ASR dropped its words (segmentation,
// which is more sensitive, still fired), so an equal-loudness WAV is what makes
// BOTH speakers reliably transcribe in-browser.
//
// The two models (pyannote segmentation + CAM++ embedding) are served locally at
// /models by serve.mjs (flat layout). They are NOT committed; CI fetches them
// with `npm run e2e:models` and local dev gets them the same way. When they are
// absent the spec SKIPS itself (HEAD-probe), mirroring transcription-fp32-wasm.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

// The CAM++ embedding model is the largest, most diagnostic of the two model
// files: if it is served, both are (e2e:models fetches them together). Absent
// means no diarization coverage is possible, so skip rather than fail.
const MODEL_PROBE = '/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';

test('diarizes a two-speaker clip into colour-coded speaker turns (WASM)', async ({ page, request, baseURL }) => {
  const head = await request.head(MODEL_PROBE).catch(() => null);
  test.skip(!head || !head.ok(),
    `no diarization models at ${baseURL}${MODEL_PROBE} (run \`npm run e2e:models\` to fetch them)`);

  const FIXTURE_AUDIO = fixture('two-speakers.wav');

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // First boot creates the settings DB; seed local model source + wasm backend,
  // then reload so the app picks them up (and forceLocalFallback => diarization
  // models are read from /models too, never HuggingFace).
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Load the ASR model and wait for the ready check mark.
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Upload the clip; uploads transcribe immediately.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  // The Speakers button only renders once the entry has word timestamps (it
  // does, post-transcription). Click it to diarize this entry.
  const speakersBtn = page.locator('.history-modes button', { hasText: 'Speakers' }).first();
  await expect(speakersBtn).toBeVisible({ timeout: 30 * 1000 });
  await expect(speakersBtn).toBeEnabled();
  await speakersBtn.click();

  // Diarization runs on the WASM engine (loads glue + wasm + both models the
  // first time). The diarized view renders .diar-turns when it completes.
  const turns = page.locator('.diar-turns .diar-turn');
  await expect(turns.first()).toBeVisible({ timeout: 3 * 60 * 1000 });

  // At least two turns, and at least two DISTINCT speakers across them.
  const turnCount = await turns.count();
  expect(turnCount, 'number of speaker turns').toBeGreaterThanOrEqual(2);

  const labels = await page.locator('.diar-turns .diar-speaker-label').allInnerTexts();
  const distinct = new Set(labels.map((s) => s.trim()));
  expect(distinct.size, `distinct speaker labels: ${[...distinct].join(', ')}`).toBeGreaterThanOrEqual(2);

  // The clip is speaker A (JFK) then speaker B (French): the first turn and the
  // last turn must be attributed to different speakers.
  expect(labels[0].trim(), `first turn "${labels[0]}" vs last "${labels[labels.length - 1]}"`)
    .not.toBe(labels[labels.length - 1].trim());

  // The diarized turns must carry the actual transcript text, not be empty.
  const firstTurnText = (await page.locator('.diar-turns .diar-turn-text').first().innerText()).trim();
  expect(firstTurnText.length, 'first turn text non-empty').toBeGreaterThan(0);

  // Switching back to Raw and to Speakers again must reuse the cached result
  // (no re-run needed) and show the plain transcript in between.
  await page.locator('.history-modes button', { hasText: 'Raw' }).first().click();
  await expect(page.locator('.diar-turns')).toHaveCount(0);
  await page.locator('.history-modes button', { hasText: 'Speakers' }).first().click();
  await expect(page.locator('.diar-turns .diar-turn').first()).toBeVisible({ timeout: 10 * 1000 });

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
