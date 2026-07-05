// Tier-3 E2E: long-audio chunking + overlap stitching, exercised end to end in a
// real headless Chromium. The chunk/stitch path (ParakeetModel.transcribeChunked)
// only engages when the audio is longer than one chunk, which the short happy-
// path fixtures never trigger, so it had no in-browser coverage (only the tier-1
// chunk-stitch unit test). Here we shrink the chunk window to 10 s (the minimum
// allowed) and feed the ~11 s JFK clip, forcing >1 chunk, then assert the
// stitched transcript recovered the spoken content.
//
// Reuses the WASM-int8 local-model setup of transcription.spec.js (serve.mjs
// serves the weights at /models; seedSettings forces local source + wasm). The
// 10 s chunk duration is seeded directly into the settings DB; it sits at the
// UI's input floor, so it is read back verbatim on load (the load-time clamp
// leaves in-range values untouched).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/jfk.mp3');
// The golden is the clean single-pass transcript (default 20 s, no chunking on
// this ~11 s clip): the stitched 10 s-chunk output must recover the same words,
// proving the chunk/overlap path did not drop or mangle content at the seams.
const GOLDEN = readFileSync(resolve(here, '../fixtures/jfk.expected.txt'), 'utf-8').trim();

test('chunks long audio at a 10 s window and stitches it back together', async ({ page }) => {
  const errors = [];
  // The app logs "[Transcribe] Completed chunk N/total" once per chunk whenever
  // there is more than one chunk; capture the totals so we can prove chunking
  // actually engaged (and how many chunks ran).
  const chunkTotals = new Set();
  let chunkLogs = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    const mt = m.text();
    const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(mt);
    if (hit) { chunkLogs += 1; chunkTotals.add(Number(hit[2])); }
  });

  // First load creates the settings DB/store. chunkDuration is persisted via
  // usePersistedSetting, so the app writes its default (20) back to the DB right
  // after the initial settings restore; if we seed before that write lands it is
  // clobbered and the reload reads 20. So wait until the restore is done (the
  // load-model button only renders once settings are loaded), let the default
  // write flush, THEN seed our 10 s window (the minimum allowed), then reload.
  // 10 s is small enough to split this ~11 s clip into >1 chunk.
  // (modelSource/backend are not auto-persisted, which is why the other specs can
  // seed immediately; chunkDuration is the one that needs this ordering.)
  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500); // let the first-load default-persist effects flush
  await seedSettings(page, { chunkDuration: 10 });
  await page.reload();

  // Fail loudly (not silently single-pass) if the seed did not survive the
  // reload's own restore/persist cycle.
  const persisted = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('parakeetweb-settings-db', 1);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return new Promise((res, rej) => {
      const tx = db.transaction(['settings-store'], 'readonly');
      const r = tx.objectStore('settings-store').get('parakeetweb_chunkDuration');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
  expect(persisted, 'seeded chunkDuration did not survive reload').toBe(10);

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Upload the ~11 s clip; uploads transcribe immediately.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  // The per-chunk callback appends a transient " [transcribing...]" suffix while
  // running; wait for it to clear so we read the final stitched transcript.
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // Chunking really engaged: more than one chunk, and every chunk reported in.
  const total = [...chunkTotals][0];
  expect(chunkTotals.size, `saw inconsistent chunk totals: ${[...chunkTotals]}`).toBe(1);
  expect(total, 'expected the 11 s clip at a 10 s window to split into >1 chunk').toBeGreaterThan(1);
  expect(chunkLogs, `expected ${total} chunk-complete logs, saw ${chunkLogs}`).toBe(total);

  // The stitched transcript recovered the spoken content (robust to the casing/
  // punctuation/boundary differences a chunked run introduces).
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `stitched "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // Guard against runaway boundary duplication: a broken stitch that re-emits
  // whole overlapped chunks would still pass the overlap check above (every
  // golden word is present, just repeated), so cap the length too. Some seam
  // repetition at a 10 s window is expected; 2x the golden word count is the
  // ceiling that a healthy stitch stays well under.
  const got = (await historyText.innerText()).trim();
  expect(words(got).length,
    `stitched output is ${words(got).length} words vs golden ${words(GOLDEN).length}; runaway seam duplication?`)
    .toBeLessThanOrEqual(words(GOLDEN).length * 2);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
