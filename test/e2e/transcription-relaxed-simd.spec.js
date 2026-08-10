// Tier-3 E2E: the relaxed-SIMD ORT engine variant (PERF_PLAN #5) end to end in
// a real headless Chromium. The variant-selection logic is unit-tested pure
// (test/unit/ort-variant.test.mjs); this spec proves the REAL plumbing: the
// sidebar toggle persists, App.jsx pins the variant at model load
// (resolveOrtVariant over the probe + the served /ort-relaxed/ artifacts),
// initOrt sets env.wasm.wasmPaths + env.wasm.simd='relaxed', ORT actually
// initializes from the alternative engine build, and the transcript still
// matches the golden.
//
// SELF-SKIPS unless the BUILT app ships the relaxed artifacts
// (app/ui/dist/ort-relaxed/, produced by scripts/build-ort-relaxed.sh into
// app/ui/public/ort-relaxed/ and copied+manifested by the app build). The
// stock-engine deployment must stay byte-identical without them, so their
// absence is a legitimate configuration, not a failure. Mirrors the
// transcription-fp32-wasm.spec.js self-skip precedent.
//
// There is no silent-fallback trap here (unlike the encode pool): when the
// toggle is on but the variant cannot engage, the engagement marker simply
// never logs and this spec fails on the positive assertion, which is exactly
// what we want from it.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/jfk.mp3');
const GOLDEN = readFileSync(resolve(here, '../fixtures/jfk.expected.txt'), 'utf-8').trim();
const DIST_MANIFEST = resolve(here, '../../app/ui/dist/ort-relaxed/manifest.json');
const PUBLIC_DIR = resolve(here, '../../app/ui/public/ort-relaxed');

test('relaxed-SIMD engine engages when toggled and transcribes the golden clip', async ({ page }) => {
  // serve.mjs serves app/ui/dist, so dist is what decides. Distinguish "never
  // built the engine" (normal skip) from "engine present but app build stale"
  // (skip with a rebuild hint) in the skip message.
  test.skip(!existsSync(DIST_MANIFEST),
    existsSync(PUBLIC_DIR)
      ? 'app/ui/public/ort-relaxed exists but dist/ort-relaxed does not: rebuild app/ui (cd app/ui && npm run build)'
      : 'no relaxed-SIMD engine artifacts (run scripts/build-ort-relaxed.sh, then rebuild app/ui)');

  const errors = [];
  let relaxedEngaged = false;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().includes('[ORT] Relaxed-SIMD runtime variant engaged')) relaxedEngaged = true;
  });

  await page.goto('/');

  // The variant also needs the engine-side probe to pass in this browser;
  // skip (rather than fail) engines that cannot validate relaxed SIMD.
  const probe = await page.evaluate(() => WebAssembly.validate(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
    10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11,
  ])));
  test.skip(!probe, 'this browser engine does not validate relaxed SIMD');

  // Same seed ordering as chunking.spec.js: let the first boot's
  // default-persist storm flush before seeding, or the write is clobbered and
  // the reload silently reads the default back.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, { relaxedSimd: true });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // The variant is pinned during model load; the marker must already be there.
  expect(relaxedEngaged, 'expected the "[ORT] Relaxed-SIMD runtime variant engaged" marker').toBe(true);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // Relaxed kernels are allowed tiny numeric drift, never content damage:
  // same overlap bar as the stock-engine transcription specs.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `"${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('auto mode runs the micro-bench and engagement matches its pick', async ({ page }) => {
  test.skip(!existsSync(DIST_MANIFEST),
    existsSync(PUBLIC_DIR)
      ? 'app/ui/public/ort-relaxed exists but dist/ort-relaxed does not: rebuild app/ui (cd app/ui && npm run build)'
      : 'no relaxed-SIMD engine artifacts (run scripts/build-ort-relaxed.sh, then rebuild app/ui)');

  const errors = [];
  let relaxedEngaged = false;
  let autoPickLine = null;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().includes('[ORT] Relaxed-SIMD runtime variant engaged')) relaxedEngaged = true;
    const mm = /\[ORT\] Relaxed-SIMD auto-pick: (relaxed|stock)/.exec(m.text());
    if (mm) autoPickLine = mm[1];
  });

  await page.goto('/');
  const probe = await page.evaluate(() => WebAssembly.validate(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
    10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11,
  ])));
  test.skip(!probe, 'this browser engine does not validate relaxed SIMD');

  // 'auto' is the default, but seed it explicitly so this spec still tests
  // auto mode if the default ever changes.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, { relaxedSimd: 'auto' });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // The pick is hardware-dependent (V8 on AVX2 picks relaxed, but a CPU where
  // the relaxed lowering wins nothing legitimately picks stock), so the spec
  // pins CONSISTENCY: the bench must have run, and the engaged variant must
  // be exactly what it picked.
  expect(autoPickLine, 'expected the "[ORT] Relaxed-SIMD auto-pick:" marker').not.toBeNull();
  expect(relaxedEngaged, `auto-pick said "${autoPickLine}" but engagement disagrees`)
    .toBe(autoPickLine === 'relaxed');

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
