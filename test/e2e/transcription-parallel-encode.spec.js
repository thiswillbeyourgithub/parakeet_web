// Tier-3 E2E: chunk-parallel encoding (the WASM encode-worker POOL) end to end
// in a real headless Chromium. transcribeChunked's injected-encodeChunk driver
// is unit-tested with fakes (test/unit/chunk-stitch.test.mjs); this spec proves
// the REAL plumbing: App.jsx spawns the pool (app/ui/src/lib/encode.worker.js),
// each worker builds an encoder-only ParakeetModel from the same verified
// weights, the run engages the pool, and the stitched transcript still matches
// the golden. Unlike the WebGPU decode worker (untestable headless), the pool
// is a pure-WASM feature, so headless Chromium covers it fully.
//
// This spec pins the DEFAULT WASM shape: pooled encode with in-thread decode.
// The decode worker stays WebGPU-only unless an operator opts in with
// VITE_WASM_DECODE_PIPELINE='true' (measured a wash, see that spec), so this
// run must show the pool engaged and the decode pipeline absent. The opt-in
// composed shape is covered by transcription-composed-pipeline.spec.js.
//
// Reuses the chunking.spec.js recipe: WASM-int8 local weights (serve.mjs),
// chunkDuration seeded to 10 s so the ~11 s JFK clip splits into >1 chunk (a
// single-pass clip never calls encodeChunk). The pool is hardware-gated
// (encodePoolPlan: >= 8 cores, deviceMemory >= 8 when exposed), so on machines
// that cannot pass the gate the spec SKIPS rather than false-fails, mirroring
// transcription-fp32-wasm.spec.js's self-skip precedent.
//
// The serial fallback makes a broken pool INVISIBLE in the transcript (a failed
// pooled run is retried in-thread and still produces good text), so this spec
// asserts the positive "[Encode] pool engaged" marker AND the absence of every
// pool failure/fallback log, not just output quality.
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

test('encode pool engages on a chunked run and the stitched transcript matches', async ({ page }) => {
  const errors = [];
  const chunkTotals = new Set();
  let chunkLogs = 0;
  let poolEngaged = false;
  let decodeEngaged = false;
  const poolTrouble = [];
  page.on('console', (m) => {
    const mt = m.text();
    if (m.type() === 'error') errors.push(mt);
    const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(mt);
    if (hit) { chunkLogs += 1; chunkTotals.add(Number(hit[2])); }
    if (mt.includes('[Encode] pool engaged')) poolEngaged = true;
    if (mt.includes('[Decode] pipeline engaged')) decodeEngaged = true;
    // Any of these means the pool broke and the serial fallback (or the gate)
    // masked it; the transcript below would still look healthy, so fail here.
    // Patterns are shared with the composed spec so the two cannot drift.
    if (isPipelineTrouble(mt)) poolTrouble.push(mt);
  });

  await page.goto('/');

  // The pool is hardware-gated at model load (encodePoolPlan). Skip machines
  // that cannot pass the gate instead of failing on them.
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

  // Chunking engaged (the pool only ever runs on multi-chunk clips).
  const total = [...chunkTotals][0];
  expect(chunkTotals.size, `saw inconsistent chunk totals: ${[...chunkTotals]}`).toBe(1);
  expect(total, 'expected the 11 s clip at a 10 s window to split into >1 chunk').toBeGreaterThan(1);
  expect(chunkLogs, `expected ${total} chunk-complete logs, saw ${chunkLogs}`).toBe(total);

  // The whole point of this spec: chunk-parallel encoding really ran.
  expect(poolTrouble, `pool trouble logs:\n${poolTrouble.join('\n')}`).toHaveLength(0);
  expect(poolEngaged, 'expected the "[Encode] pool engaged" marker').toBe(true);
  // ...and decode really stayed in-thread, so this is the pool-only driver and
  // not the composed one wearing its marker.
  expect(decodeEngaged,
    'without VITE_WASM_DECODE_PIPELINE=true the decode worker must stay out of the run').toBe(false);

  // Stitched transcript recovered the content (same thresholds as
  // chunking.spec.js: the pooled path must not cost quality either).
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
