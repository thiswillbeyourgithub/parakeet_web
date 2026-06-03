// Tier-3 realistic long-audio chunking E2E. chunking.spec.js stresses the
// chunk/stitch path with a tiny 5 s window on the ~11 s JFK clip; this is the
// complementary realistic case: a ~3 minute clip built by stitching the
// committed FLEURS en+fr fixtures (scripts/gen-fleurs-fixtures.mjs), run through
// the app at its DEFAULT chunk window.
//
// On the WASM backend (which headless Chromium forces, and which runs the int8
// encoder) that default is the int8-safe ~20 s window, NOT 60 s: the int8
// encoder loses long-range content past ~20 s within a single chunk, so a 60 s
// window silently drops most of a long recording (recovery ~0.69 vs ~0.85 at
// 20 s). See defaultChunkDurationForBackend in app/src/models.js and the
// chunk-default unit test. This spec leaves chunkDuration UNSEEDED so it
// exercises that backend-aware default end to end: the ~3 min clip must split
// into many chunks and the stitched transcript must recover the content.
//
// The golden (manifest.stitched.expected) is the in-order concatenation of the
// per-clip int8 goldens; each clip is an independent sentence, so the stitched
// run must recover those words across the seams.
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
const STITCHED = resolve(FX, manifest.stitched.audio);
const GOLDEN = manifest.stitched.expected;

test('chunks and stitches the long real FLEURS clip at the int8-safe default window', async ({ page }) => {
  // A few minutes of audio split into ~a dozen chunks; well over the default cap.
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

  // Seed only backend (wasm) + local model: chunkDuration is left UNSEEDED so the
  // app derives the int8-safe default from the backend.
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  await page.locator('#audio-file-input').setInputFiles(STITCHED);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // Chunking really engaged at the int8-safe (~20 s) default: a single consistent
  // total, and MANY chunks. At the old 60 s default this ~3 min clip would split
  // into only ~4 chunks; the backend-aware default pushes it to ~a dozen, so a
  // high chunk count is what proves the default actually shrank.
  const total = [...chunkTotals][0];
  expect(chunkTotals.size, `inconsistent chunk totals: ${[...chunkTotals]}`).toBe(1);
  expect(total, 'expected the int8-safe default to split the ~3 min clip into many chunks').toBeGreaterThanOrEqual(6);
  expect(chunkLogs, `expected ${total} chunk-complete logs, saw ${chunkLogs}`).toBe(total);

  // The stitched transcript recovered the spoken content across all seams. At the
  // int8-safe window recovery is ~0.85; 0.75 leaves margin for run-to-run jitter.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `stitched overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.75);
  }).toPass({ timeout: 60 * 1000 });

  // Guard against runaway boundary duplication: a broken stitch that re-emits
  // whole overlapped chunks would still pass the overlap check (every golden word
  // present, just repeated), so cap the length too.
  const got = (await historyText.innerText()).trim();
  expect(words(got).length,
    `stitched output is ${words(got).length} words vs golden ${words(GOLDEN).length}; runaway seam duplication?`)
    .toBeLessThanOrEqual(words(GOLDEN).length * 1.5);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
