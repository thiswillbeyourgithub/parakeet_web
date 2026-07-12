// Tier-3 E2E proving cross-recording speaker matching (session-only): when the
// user names a speaker in one recording, the SAME voice in a later recording is
// auto-labelled with that name. The vendored diarization WASM returns no
// embeddings, so the app computes CAM++ voice embeddings itself (shared
// app/src/fbank.js + onnxruntime-web) and matches them by cosine similarity
// (app/ui/src/lib/speakerMatch.js). The pure pieces are unit-tested (fbank,
// speaker-match) and the embedding quality is validated by
// scripts/speaker-embedding-check.mjs; this is the in-browser proof the whole
// chain works end to end.
//
// The trick: upload the SAME two-speaker clip twice. Recording 1's first speaker
// (JFK) is renamed "Alice". Recording 2 is the identical audio, so its JFK
// speaker embeds near-identically and must auto-match "Alice" WITHOUT the user
// renaming it again, while the other (un-named) speaker stays a default label.
//
// Embeddings live in memory only (voiceprints are biometric, never persisted),
// so this works within one session, which is exactly what is asserted here.
//
// The two diarization models are served locally at /models by serve.mjs; absent,
// the spec SKIPS itself (HEAD-probe), mirroring transcription-diarization.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

const MODEL_PROBE = '/models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';

test('reuses a renamed speaker label across recordings by voice match (WASM)', async ({ page, request, baseURL }) => {
  const head = await request.head(MODEL_PROBE).catch(() => null);
  requireWeightsOrSkip(test, !head || !head.ok(),
    `no diarization models at ${baseURL}${MODEL_PROBE} (run \`npm run e2e:models\` to fetch them)`);

  const FIXTURE_AUDIO = fixture('two-speakers.wav');

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // --- Recording 1: upload, transcribe, diarize, name the first speaker. ---
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  const firstItem = page.locator('.history-item').first();
  await expect(firstItem.locator('.history-text')).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  await firstItem.locator('.history-modes button', { hasText: 'Speakers' }).click();
  await expect(firstItem.locator('.diar-turns .diar-turn').first()).toBeVisible({ timeout: 3 * 60 * 1000 });

  // Rename recording 1's first speaker (JFK) to "Alice".
  await firstItem.locator('.diar-turns .diar-speaker-label').first().click();
  const nameInput = firstItem.locator('.diar-turns .diar-speaker-input').first();
  await expect(nameInput).toBeVisible({ timeout: 10 * 1000 });
  await nameInput.fill('Alice');
  await nameInput.press('Enter');
  await expect(firstItem.locator('.diar-turns .diar-speaker-label').first()).toHaveText('Alice', { timeout: 10 * 1000 });

  // --- Recording 2: identical audio uploaded again (prepends to the top). ---
  // The new entry is only inserted once its transcription finishes, so the count
  // does not reach 2 until recording 2 is fully transcribed (CPU/WASM is slow).
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  await expect(page.locator('.history-item')).toHaveCount(2, { timeout: 6 * 60 * 1000 });
  const newItem = page.locator('.history-item').first(); // newest = recording 2
  await expect(newItem.locator('.history-text')).not.toBeEmpty({ timeout: 30 * 1000 });

  // Diarize recording 2: it must regroup into speaker turns AND, once the voice
  // embeddings are matched against recording 1's, auto-label its JFK speaker
  // "Alice" with no manual rename.
  await newItem.locator('.history-modes button', { hasText: 'Speakers' }).click();
  await expect(newItem.locator('.diar-turns .diar-turn').first()).toBeVisible({ timeout: 3 * 60 * 1000 });

  // The label starts as a default "Speaker N" then flips to "Alice" when the
  // (async) embedding + match completes, so poll for it.
  await expect(newItem.locator('.diar-turns .diar-speaker-label').first())
    .toHaveText('Alice', { timeout: 60 * 1000 });

  // The OTHER speaker in recording 2 was never named, so it must NOT be "Alice":
  // only the matched voice reuses the label.
  const labels = await newItem.locator('.diar-turns .diar-speaker-label').allInnerTexts();
  const distinct = new Set(labels.map((s) => s.trim()));
  expect(distinct.has('Alice'), `labels: ${[...distinct].join(', ')}`).toBe(true);
  expect([...distinct].some((l) => l !== 'Alice'), `expected a non-Alice speaker too: ${[...distinct].join(', ')}`).toBe(true);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
