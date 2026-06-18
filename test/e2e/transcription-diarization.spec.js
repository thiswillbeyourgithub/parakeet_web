// Tier-3 E2E proving the sherpa-onnx speaker-diarization path actually loads and
// runs in a real headless Chromium: load the WASM int8 ASR model, transcribe a
// two-speaker clip, click the per-entry "Speakers" button, and assert the
// transcript regroups into colour-coded Speaker turns with >= 2 distinct
// speakers. It then exercises the interactive controls: forcing a speaker count
// from the entry kebab (which re-segments: down to one turn, then back to Auto)
// and renaming a speaker inline (the label becomes a text input). Finally it
// proves persistence: with persistTranscripts on, the grouped turns + the custom
// name are written to the transcripts DB (and ONLY those, no per-word timings or
// raw segments, per F-130) and survive a full page reload, where the Speakers
// view + "Alice" reappear from disk even though the in-memory audio is gone.
// This is the in-browser proof the vendored WASM engine (its own ONNX Runtime),
// the two diarization models, and the word->speaker assignment all work end to
// end; the pure pieces are unit-tested (test/unit/speaker-assign).
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

  // Track requests for the CAM++ embedding model so we can prove the background
  // prefetch fires as soon as the ASR model is ready, BEFORE any Speakers click.
  const embModelRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('3dspeaker_speech_campplus')) embModelRequests.push(req.url());
  });

  // First boot creates the settings DB; seed local model source + wasm backend,
  // then reload so the app picks them up (and forceLocalFallback => diarization
  // models are read from /models too, never HuggingFace).
  await page.goto('/');
  // persistTranscripts on so the diarized turns + speaker names persist to the
  // transcripts DB and can be asserted to survive a reload (the tail of this
  // spec).
  await seedSettings(page, { persistTranscripts: true });
  await page.reload();

  // Load the ASR model and wait for the ready check mark.
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // The diarization models prefetch in the background the moment the ASR model
  // is ready, so the user can record and the first Speakers run is instant. The
  // embedding model must therefore already have been requested HERE, before we
  // upload anything or ever open the Speakers view.
  await expect.poll(() => embModelRequests.length, { timeout: 60 * 1000 }).toBeGreaterThan(0);

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

  // The clip is speaker A (JFK) then speaker B (a FLEURS English reader): the
  // first turn and the last turn must be attributed to different speakers.
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

  // --- Force a single speaker from the entry kebab: it must re-segment to 1 turn. ---
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.locator('.kebab-speakers select').selectOption('1');
  // Re-segmentation runs on the already-loaded engine; the diarized view collapses
  // to a single speaker turn (numClusters=1 puts every word in one cluster).
  await expect.poll(() => page.locator('.diar-turns .diar-turn').count(), { timeout: 60 * 1000 }).toBe(1);

  // --- Back to Auto from the kebab: it must re-segment to >= 2 turns again. ---
  // (Diarizing disables the kebab select, so wait for the 1-turn run above to
  // settle first; the count poll already proves diarizingId cleared.)
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.locator('.kebab-speakers select').selectOption('0');
  await expect.poll(() => page.locator('.diar-turns .diar-turn').count(), { timeout: 60 * 1000 })
    .toBeGreaterThanOrEqual(2);

  // --- Rename a speaker inline: the label is a button that becomes a text input,
  // and the rename applies to that speaker everywhere in the transcript. ---
  const firstLabel = page.locator('.diar-turns .diar-speaker-label').first();
  const originalName = (await firstLabel.innerText()).trim();
  await firstLabel.click();
  const nameInput = page.locator('.diar-turns .diar-speaker-input').first();
  await expect(nameInput).toBeVisible({ timeout: 10 * 1000 });
  await nameInput.fill('Alice');
  await nameInput.press('Enter');
  await expect(page.locator('.diar-turns .diar-speaker-label').first()).toHaveText('Alice', { timeout: 10 * 1000 });
  expect(originalName, 'rename changed the label').not.toBe('Alice');

  // --- Persistence across reload (persistTranscripts is seeded on). The grouped
  // turns + the custom name must hit disk and come back identically after a
  // reload, WITHOUT any per-word timings or raw float segments being persisted
  // (F-130). The in-memory pcm/audio is gone after reload, so the only way the
  // Speakers view + "Alice" can reappear is from the persisted turns. ---
  const TURNS_DB = 'parakeetweb-transcripts-db';
  const TURNS_STORE = 'transcripts-store';
  const readPersisted = () => page.evaluate(({ DB, STORE }) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(null); return; }
      const get = db.transaction([STORE], 'readonly').objectStore(STORE).get('transcripts');
      get.onsuccess = () => { db.close(); resolve(get.result || null); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    req.onerror = () => reject(req.error);
  }), { DB: TURNS_DB, STORE: TURNS_STORE });

  // Wait for the diarized turns + the rename to land on disk before reloading.
  await expect.poll(async () => {
    const recs = await readPersisted();
    const r = Array.isArray(recs) ? recs[0] : null;
    return !!(r && Array.isArray(r.diarTurns) && r.diarTurns.length >= 2 && r.speakerNames);
  }, { timeout: 30 * 1000 }).toBe(true);

  // F-130 regression guard: the persisted record carries ONLY the slim text
  // fields plus the opt-in diarization payload, never per-word timings, raw
  // segments, pcm, or the filename.
  const persistedRec = (await readPersisted())[0];
  expect(Object.keys(persistedRec).sort(), 'persisted record keys')
    .toEqual(['diarTurns', 'id', 'speakerNames', 'text', 'timestamp', 'wordCount']);
  for (const turn of persistedRec.diarTurns) {
    expect(Object.keys(turn).sort(), 'persisted turn keys').toEqual(['speaker', 'text']);
  }

  await page.reload();
  // The history (and with it the restored diarized view) only renders once the
  // app leaves the idle landing screen, i.e. after the model is loaded again,
  // the same gate the persisted transcript TEXT lives behind. Load the model,
  // then assert the Speakers view auto-reopened from disk (the entry's mode was
  // 'diarized' when persisted) with no in-memory audio/words available.
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  await expect(page.locator('.diar-turns .diar-turn').first()).toBeVisible({ timeout: 60 * 1000 });
  await expect.poll(() => page.locator('.diar-turns .diar-turn').count(), { timeout: 10 * 1000 })
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator('.diar-turns .diar-speaker-label').first()).toHaveText('Alice', { timeout: 10 * 1000 });
  const restoredFirstText = (await page.locator('.diar-turns .diar-turn-text').first().innerText()).trim();
  expect(restoredFirstText.length, 'restored first turn text non-empty').toBeGreaterThan(0);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
