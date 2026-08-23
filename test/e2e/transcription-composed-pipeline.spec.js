// Tier-3 E2E: the COMPOSED WASM pipeline (encode-worker pool + decode worker)
// end to end in a real headless Chromium. transcribeChunked's composed driver
// (both encodeChunk and decodeChunk injected: pooled encodes feed worker
// decodes, the main thread only orchestrates and stitches) is unit-tested with
// fakes in test/unit/chunk-stitch.test.mjs; this spec proves the REAL plumbing:
// App.jsx spawns the encode pool AND the decode worker on the WASM backend,
// the run engages BOTH (the composed "[Decode] pipeline engaged ... (composed)"
// marker plus the "[Encode] pool engaged" marker), and the stitched transcript
// still matches the golden. Unlike the WebGPU decode pipeline (untestable
// headless), composed mode is pure WASM, so headless Chromium covers it fully.
//
// Composed mode is operator opt-in on WASM (VITE_WASM_DECODE_PIPELINE='true',
// default off after it measured as a wash on wall clock), so this spec injects
// that flag; transcription-parallel-encode.spec.js covers the default shape.
//
// Reuses the transcription-parallel-encode.spec.js recipe: WASM-int8 local
// weights (serve.mjs), chunkDuration seeded to 10 s so the ~11 s JFK clip
// splits into >1 chunk (composed mode only ever runs on multi-chunk clips).
// The decode worker on WASM is gated on the same encodePoolPlan hardware gate
// as the pool, so machines that cannot pass it SKIP rather than false-fail.
//
// The serial fallback makes a broken pipeline INVISIBLE in the transcript (a
// failed composed run is retried in-thread and still produces good text), so
// this spec asserts both positive engagement markers AND the absence of every
// pool/decode failure/fallback log, not just output quality.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';
import { isPipelineTrouble } from './pipeline-trouble.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/jfk.mp3');
const GOLDEN = readFileSync(resolve(here, '../fixtures/jfk.expected.txt'), 'utf-8').trim();

test('composed pipeline (pool encode + worker decode) engages and the stitched transcript matches', async ({ page }) => {
  const errors = [];
  const chunkTotals = new Set();
  let chunkLogs = 0;
  let poolEngaged = false;
  let composedEngaged = false;
  const trouble = [];
  page.on('console', (m) => {
    const mt = m.text();
    if (m.type() === 'error') errors.push(mt);
    const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(mt);
    if (hit) { chunkLogs += 1; chunkTotals.add(Number(hit[2])); }
    if (mt.includes('[Encode] pool engaged')) poolEngaged = true;
    if (mt.includes('[Decode] pipeline engaged: pooled encode overlapping WASM decode in worker (composed)')) {
      composedEngaged = true;
    }
    // Any of these means a stage broke and the in-thread fallback (or a gate)
    // masked it; the transcript below would still look healthy, so fail here.
    // Patterns are shared with the pool-only spec so the two cannot drift.
    if (isPipelineTrouble(mt, { decode: true })) trouble.push(mt);
  });

  // Composed mode on WASM is operator opt-in (default off: it measured as a
  // wash on wall clock). Inject the flag the way docker's entrypoint writes
  // it, before any app script runs.
  await page.addInitScript(() => {
    window.__CONFIG__ = { ...(window.__CONFIG__ || {}), VITE_WASM_DECODE_PIPELINE: 'true' };
  });

  await page.goto('/');

  // Composed mode shares the encode pool's hardware gate (encodePoolPlan).
  // Skip machines that cannot pass it instead of failing on them.
  const hw = await page.evaluate(() => ({
    cores: navigator.hardwareConcurrency || 0,
    mem: navigator.deviceMemory,
  }));
  test.skip(hw.cores < 8 || (Number.isFinite(hw.mem) && hw.mem < 8),
    `machine cannot pass the encode-pool gate (cores ${hw.cores}, deviceMemory ${hw.mem})`);

  // Same seed ordering as chunking.spec.js: let the first boot's
  // default-persist storm flush before seeding chunkDuration, or the write is
  // clobbered and the reload silently reads the default back.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, { chunkDuration: 10, parallelEncode: true });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // Chunking engaged (composed mode only ever runs on multi-chunk clips).
  const total = [...chunkTotals][0];
  expect(chunkTotals.size, `saw inconsistent chunk totals: ${[...chunkTotals]}`).toBe(1);
  expect(total, 'expected the 11 s clip at a 10 s window to split into >1 chunk').toBeGreaterThan(1);
  expect(chunkLogs, `expected ${total} chunk-complete logs, saw ${chunkLogs}`).toBe(total);

  // The whole point of this spec: BOTH stages really ran off-thread.
  expect(trouble, `pipeline trouble logs:\n${trouble.join('\n')}`).toHaveLength(0);
  expect(poolEngaged, 'expected the "[Encode] pool engaged" marker').toBe(true);
  expect(composedEngaged, 'expected the composed "[Decode] pipeline engaged ... (composed)" marker').toBe(true);

  // Stitched transcript recovered the content (same thresholds as
  // chunking.spec.js: the composed path must not cost quality either).
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `stitched "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  const got = (await historyText.innerText()).trim();
  expect(words(got).length,
    `stitched output is ${words(got).length} words vs golden ${words(GOLDEN).length}; runaway seam duplication?`)
    .toBeLessThanOrEqual(words(GOLDEN).length * 2);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
