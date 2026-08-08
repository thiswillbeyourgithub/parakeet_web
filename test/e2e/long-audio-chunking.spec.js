// Tier-3 realistic long-audio chunking E2E. chunking.spec.js stresses the
// chunk/stitch path with a tiny 10 s window on the ~11 s JFK clip; this is the
// complementary realistic case: a ~3 minute continuous speech run through the
// app at a seam-dense 20 s chunk window.
//
// The clip is the first 3 minutes of JFK's "We choose to go to the Moon" Rice
// University address (1962, public domain), cropped + transcribed by
// scripts/gen-jfk-moon-fixtures.mjs. It replaced the stitched-FLEURS fixture
// this spec used to feed: that clip was independent sentences glued together
// with silence between them, so its seams fell on convenient sentence
// boundaries; one continuous speech makes the chunk/overlap stitcher recover
// content across seams that land mid-sentence, a more honest stress. (The
// stitched FLEURS clip is still used as the default WER-bench subject; only this
// e2e was repointed.)
//
// The app's default chunk window is 60 s with a 10-90 s range (see
// app/src/models.js). This spec SEEDS a deliberately smaller 20 s window: the
// 3 min clip then splits into ~10 chunks (instead of 3 at the default) and the
// stitched transcript must recover the content across many seams that land
// mid-sentence.
//
// The golden (jfk-moon-3min.expected.txt) is this repo's own int8 pipeline
// transcript of the same crop at that same 20 s window
// (scripts/gen-jfk-moon-fixtures.mjs, STITCH_STRESS_CHUNK_SEC), so the live WASM
// run must reproduce it across the seams. Keep the seeded window here in sync with
// the window that script uses.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FX = resolve(here, '../fixtures');
const AUDIO = resolve(FX, 'jfk-moon-3min.mp3');
const GOLDEN = readFileSync(resolve(FX, 'jfk-moon-3min.expected.txt'), 'utf-8').trim();

test('chunks and stitches the 3 min JFK moon speech at a seeded 20 s window', async ({ page }) => {
  // A few minutes of audio split into ~a dozen chunks at the seeded window.
  test.setTimeout(20 * 60 * 1000);

  const errors = [];
  // "[Transcribe] Completed chunk N/total" fires once per chunk when there is
  // more than one; capture the totals to prove chunking actually engaged.
  const chunkTotals = new Set();
  let chunkLogs = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(m.text());
    if (hit) { chunkLogs += 1; chunkTotals.add(Number(hit[2])); }
  });

  // Seed backend (wasm) + local model + a 20 s chunk window (well below the
  // 60 s default, matching the golden's generation window), which gives many
  // seams on a 3 min clip.
  await page.goto('/');
  // chunkDurationMigrated: 20 s is the LEGACY default, and the app's one-time
  // migration (lib/chunkDuration.js) rescues an unmigrated 20 to 60, which
  // would collapse this clip to ~3 chunks. The first boot (pre-seed) already
  // stamps the flag, but seeding it too makes the deliberate 20 s choice
  // independent of that ordering detail, like a real user re-picking 20.
  await seedSettings(page, { chunkDuration: 20, chunkDurationMigrated: true });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  await page.locator('#audio-file-input').setInputFiles(AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // Chunking really engaged at the seeded 20 s window: a single consistent total,
  // and MANY chunks. A 3 min clip at a 20 s window splits into ~10 chunks, so a
  // high chunk count proves the window actually took effect.
  const total = [...chunkTotals][0];
  expect(chunkTotals.size, `inconsistent chunk totals: ${[...chunkTotals]}`).toBe(1);
  expect(total, 'expected the seeded 20 s window to split the 3 min clip into many chunks').toBeGreaterThanOrEqual(6);
  expect(chunkLogs, `expected ${total} chunk-complete logs, saw ${chunkLogs}`).toBe(total);

  // The stitched transcript recovered the spoken content across all seams. Golden
  // and live run are both the int8 pipeline at the same window, so recovery is
  // high; 0.75 leaves margin for wasm-node (golden) vs wasm-browser (app) jitter.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `stitched overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.75);
  }).toPass({ timeout: 60 * 1000 });

  // Guard against runaway boundary duplication: a broken stitch that re-emits
  // whole overlapped chunks would still pass the overlap check (every golden word
  // present, just repeated), so cap the length too. The golden already carries
  // the normal seam repetition, so 1.5x it is a healthy ceiling.
  const got = (await historyText.innerText()).trim();
  expect(words(got).length,
    `stitched output is ${words(got).length} words vs golden ${words(GOLDEN).length}; runaway seam duplication?`)
    .toBeLessThanOrEqual(words(GOLDEN).length * 1.5);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
