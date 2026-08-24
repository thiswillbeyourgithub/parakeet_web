// Tier-3 E2E for the sidebar Benchmark section: drives the real thing end to
// end in headless Chromium (plan -> select one combination -> run -> report),
// with the model actually loaded and the clip actually transcribed through
// App.jsx's own paths, which is the whole premise of the feature (the benchmark
// must measure what a user gets, never a private copy of the pipeline).
//
// The multi-combination sequencing, medianed repeats and every failure mode are
// unit-covered with fakes (test/unit/benchmark.test.mjs). What only a browser
// can prove, and what this spec asserts, is:
//   - the section plans a matrix for this device and runs the selected row
//   - the run really loads a model and really transcribes (the result row
//     carries a speed, and the report's similarity score shows the shipped clip
//     came back as the expected sentence)
//   - the report is valid parakeetweb-benchmark-report/1 JSON whose anonymiser
//     held on a REAL probe: no user agent, no time zone, no languages, no
//     screen geometry, no storage estimate, and no transcript
//   - NOTHING is transmitted without an explicit click, even with the upload
//     feature enabled and auto-send off, and the click posts exactly the text
//     the user was shown
//
// Only the wasm/int8 row is selected by default: the fp32 weights are not
// guaranteed to exist on a CI runner, and each extra row costs a full model
// load. Headless Chromium has no WebGPU adapter, so the GPU rows never appear.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection, seedSettings } from './seed.mjs';

test('benchmark runs a real combination, reports it anonymously, and sends nothing unasked', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    // The run is a multi-minute black box (load + transcribe inside the app's
    // own paths), so make it debuggable without editing the spec.
    if (process.env.E2E_DEBUG_CONSOLE) console.log(`[browser:${m.type()}] ${m.text()}`);
  });

  // Enable the upload half of the section (the operator opt-in the entrypoint
  // derives from BENCHMARK_REPORTS_DIR) so the consent path is testable, and
  // capture every POST instead of letting one reach a server.
  await page.addInitScript(() => {
    window.__CONFIG__ = { ...(window.__CONFIG__ || {}), VITE_BENCHMARK_UPLOAD: 'true' };
  });
  const posted = [];
  await page.route('**/api/signal/benchmark-report', async (route) => {
    posted.push(route.request().postData());
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/');
  // Same seed ordering as the other model-loading specs: let the first boot's
  // default-persist storm flush before seeding, or the write is clobbered.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, { beamWidth: 1 });
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Benchmark');

  // The planner offers the WASM rows; headless Chromium exposes no adapter, so
  // no WebGPU row is planned here.
  const int8 = page.locator('input[name="benchmark-combo-wasm:int8"]');
  await expect(int8).toBeVisible();
  await expect(int8).toBeChecked();
  expect(await page.locator('input[name^="benchmark-combo-webgpu"]').count(),
    'headless Chromium has no GPU adapter, so no WebGPU row may be planned').toBe(0);

  // fp32 is a 2.3 GB download and must never be pre-selected for anyone.
  await expect(page.locator('input[name="benchmark-combo-wasm:fp32"]')).not.toBeChecked();
  // Nor may any other row be. This spec asserts a single result below, so a new
  // pre-selected row would break it, but the reason it must not exist is the
  // product one: pressing Run without touching a checkbox has to stay free for a
  // visitor whose model is already cached. int8lite is the live case (810 MB,
  // under the heavy threshold, so only OPT_IN_QUANTS keeps it unchecked).
  await expect(page.locator('input[name="benchmark-combo-wasm:int8lite"]')).toBeVisible();
  await expect(page.locator('input[name="benchmark-combo-wasm:int8lite"]')).not.toBeChecked();
  expect(await page.locator('input[name^="benchmark-combo-"]:checked').count(),
    'exactly one row may be pre-selected: the visitor\'s own cached model').toBe(1);
  await page.locator('[data-umami-event="benchmark_run"]').click();

  const textarea = page.locator('.benchmark-report-text');
  await expect(textarea).toBeVisible({ timeout: 8 * 60 * 1000 });
  await expect(textarea).toHaveValue(/parakeetweb-benchmark-report/, { timeout: 8 * 60 * 1000 });

  const report = JSON.parse(await textarea.inputValue());
  expect(report.format).toBe('parakeetweb-benchmark-report/1');
  expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(report.reportId).toBeTruthy();
  expect(report.app.version).toMatch(/^\d+\.\d+/);
  expect(report.settings.beamWidth).toBe(1);

  // The run really happened: one row, loaded and transcribed, and the shipped
  // clip came back as the sentence it is supposed to be.
  expect(report.results).toHaveLength(1);
  const row = report.results[0];
  expect(row.id).toBe('wasm:int8');
  expect(row.status, `benchmark row failed: ${JSON.stringify(row.error || {})}`).toBe('ok');
  expect(row.profile).toBe('short');
  expect(row.loadMs).toBeGreaterThan(0);
  expect(row.wallMs).toBeGreaterThan(0);
  expect(row.rtf).toBeGreaterThan(0);
  expect(row.similarity, 'the shipped clip must transcribe to its known sentence').toBeGreaterThanOrEqual(0.7);
  expect(row.metrics.encode_ms).toBeGreaterThan(0);

  // The environment section carries what a maintainer needs...
  expect(report.environment.hardware.hardwareConcurrency).toBeGreaterThan(0);
  expect(report.environment.capabilities.wasm.simd).toBe(true);
  expect(report.environment.capabilities.crossOriginIsolated).toBe(true);
  expect(report.environment.ort.wasm.numThreads).toBeGreaterThan(0);

  // ...and nothing that identifies the visitor. Asserted against the RAW text
  // so a future probe cannot smuggle a field in under a new name.
  const raw = await textarea.inputValue();
  const probe = await page.evaluate(() => ({
    ua: navigator.userAgent,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
    width: String(screen.width),
  }));
  expect(raw).not.toContain(probe.ua);
  expect(raw).not.toContain(probe.tz);
  expect(raw).not.toContain('userAgent');
  expect(raw).not.toContain('languages');
  expect(raw).not.toContain('screen');
  expect(raw).not.toContain('storage');
  expect(raw).not.toContain('audioInputs');
  // No transcript, ever: the report counts words, it never carries them.
  expect(raw.toLowerCase()).not.toContain('fellow americans');

  // The result table mirrors the report.
  await expect(page.locator('.benchmark-results tbody tr')).toHaveCount(1);

  // Consent: auto-send defaults to OFF, so a finished run must not have sent
  // anything, even though the upload feature is enabled on this instance.
  expect(posted, 'a benchmark report was transmitted without the user asking').toHaveLength(0);
  await expect(page.locator('input[name="benchmarkAutoSend"]')).not.toBeChecked();

  // ...and the explicit button sends exactly what the user was shown.
  await page.locator('[data-umami-event="benchmark_send"]').click();
  await expect(page.locator('[data-umami-event="benchmark_send"]')).toContainText('Sent', { timeout: 30_000 });
  expect(posted).toHaveLength(1);
  expect(posted[0]).toBe(raw);

  expect(errors, `page console errors: ${errors.join('\n')}`).toEqual([]);
});
