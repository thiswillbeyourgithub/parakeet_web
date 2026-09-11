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
    // Record the screen wake lock the keepalive helper takes, with in-page
    // timestamps, so the spec can prove it is held for the whole run and not
    // only while a row transcribes (the model loads in between are the long
    // part, and a machine left alone to benchmark must not sleep through
    // them). A stub rather than the real API because headless Chromium may
    // refuse the request (no visible display), which would leave nothing to
    // observe.
    const log = [];
    window.__wakeLockLog = log;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type) => {
          log.push({ type: 'request', lockType: type, t: Date.now() });
          const listeners = [];
          return {
            released: false,
            addEventListener: (_ev, fn) => listeners.push(fn),
            release: async () => {
              log.push({ type: 'release', t: Date.now() });
              for (const fn of listeners) fn();
            },
          };
        },
      },
    });
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

  // While the run owns the pipeline, the capture entry points must be gone: the
  // benchmark drives the same load/transcribe paths, so the app sits in a
  // "loading"/"transcribing" state throughout, which is exactly what used to
  // put these buttons on screen looking usable while a capture could only
  // fight the run for the model it is timing. Waiting for the loading phase
  // first is what makes this assertion real: before it, the app is idle and
  // they would be absent anyway.
  await expect(page.locator('[data-umami-event="benchmark_run"]')).toBeDisabled();

  // The table exists from the first moment of the run, not only at the end. A
  // run takes minutes, and the visitor used to watch a one-line progress string
  // with no idea which rows were coming or how far along it was. The row is
  // laid out with its backend and precision already named, and it says it is
  // waiting rather than showing a number it does not have yet.
  const liveRow = page.getByTestId('benchmark-row-wasm:int8-short');
  await expect(liveRow).toBeVisible({ timeout: 30_000 });
  await expect(liveRow).toContainText('wasm / int8');
  await expect(liveRow).toHaveAttribute('data-status', /pending|running/);

  await expect(page.locator('.benchmark-progress')).toContainText('Loading', { timeout: 60_000 });
  // ...and the row follows the run, not just the progress line.
  await expect(liveRow).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  const tLoading = await page.evaluate(() => Date.now());
  await expect(page.locator('[data-umami-event="upload_file_button"]')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="record_button"]')).toHaveCount(0);

  // Close the sidebar the way a user watching the run would: a finished run has
  // to bring them back to its results by itself.
  await page.locator('.settings-sidebar-close').click();
  await expect(page.locator('.settings-sidebar')).toHaveCount(0);

  const textarea = page.locator('.benchmark-report-text');
  await expect(textarea).toBeVisible({ timeout: 8 * 60 * 1000 });
  await expect(textarea).toHaveValue(/parakeetweb-benchmark-report/, { timeout: 8 * 60 * 1000 });

  // The run reopened the sidebar on its own, said it was done, and scrolled the
  // report into view.
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  await expect(page.locator('.benchmark-complete')).toBeVisible();
  await expect(page.locator('.benchmark-complete')).toContainText('complete');
  // Polled, not sampled once: the scroll is a smooth one (App.jsx schedules
  // scrollIntoView({ behavior: 'smooth' }) in a rAF once the sidebar has
  // reopened), so it is still animating at the instant the textarea first
  // carries its value. Reading the rect right then measures the animation's
  // first frame rather than where the report ends up, which on a loaded box
  // fails while the feature works. The assertion is unchanged: the report must
  // come into view, and if the scroll never happens this still fails.
  await expect
    .poll(async () => textarea.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }), { timeout: 15_000, message: 'the finished report must be scrolled into view' })
    .toBe(true);

  // No model was loaded before the run, so none is left loaded after it: the
  // weights in memory are whichever combination the plan ended on, not the
  // configuration the settings show. The Load model button is back instead.
  await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible();
  await expect(page.locator('[data-umami-event="upload_file_button"]')).toHaveCount(0);

  const report = JSON.parse(await textarea.inputValue());
  expect(report.format).toBe('parakeetweb-benchmark-report/1');
  // Coarsened to the top of the UTC hour: the report is uploaded and kept, and
  // the minute a visitor happened to press Run is detail it has no use for.
  expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  expect(report.reportId).toBeTruthy();
  expect(report.app.version).toMatch(/^\d+\.\d+/);
  // Several pushes share one version number, so the commit is what actually
  // identifies the bytes that produced these numbers.
  expect(typeof report.app.commit).toBe('string');
  expect(report.app.commit.length).toBeGreaterThan(0);
  expect(report.settings.beamWidth).toBe(1);

  // The run really happened: one row, loaded and transcribed, and the shipped
  // clip came back as the sentence it is supposed to be.
  expect(report.results).toHaveLength(1);
  const row = report.results[0];
  expect(row.id).toBe('wasm:int8');
  expect(row.status, `benchmark row failed: ${JSON.stringify(row.error || {})}`).toBe('ok');
  expect(row.profile).toBe('short');
  expect(row.loadMs).toBeGreaterThan(0);
  // loadMs is only comparable with a cold/warm flag beside it. This context
  // starts with an empty IndexedDB, so this load is necessarily cold.
  expect(row.loadCached).toBe(false);
  expect(row.loadDownloadMB).toBeGreaterThan(0);
  // An untimed run preceded the timed ones, so wallMs describes the machine
  // rather than its first-run kernel and pipeline compilation.
  expect(row.warmup).toBe(true);
  expect(row.wallMs).toBeGreaterThan(0);
  expect(row.rtf).toBeGreaterThan(0);
  // The REPORT keeps the conventional real-time factor (compute per second of
  // audio, lower is better) so scripts/benchmark-throughput.mjs and older
  // reports stay comparable, while the TABLE shows its reciprocal, which is the
  // direction a reader parses without translating ("6x" = an hour of audio in
  // ten minutes, bigger is better). Pinned together here because they are
  // reciprocals of one measurement and a change to either that forgets the
  // other would quietly publish two different numbers for the same run.
  const speedCell = await page.getByTestId('benchmark-row-wasm:int8-short').locator('td').nth(2).innerText();
  const shown = Number(speedCell.match(/([\d.]+)x/)?.[1]);
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeCloseTo(1 / row.rtf, 1);
  expect(row.similarity, 'the shipped clip must transcribe to its known sentence').toBeGreaterThanOrEqual(0.7);
  expect(row.metrics.encode_ms).toBeGreaterThan(0);

  // The environment section carries what a maintainer needs...
  expect(report.environment.hardware.hardwareConcurrency).toBeGreaterThan(0);
  expect(report.environment.capabilities.wasm.simd).toBe(true);
  expect(report.environment.capabilities.crossOriginIsolated).toBe(true);
  expect(report.environment.ort.wasm.numThreads).toBeGreaterThan(0);

  // Hardware detail: what the browser will say about the CPU, and every GPU it
  // will admit to. A backend timing nobody can attribute to a chip answers
  // nothing, which is the whole point of collecting this.
  expect(report.environment.browser.platform).toBeTruthy();
  expect(report.environment.browser.architecture).toBeTruthy();
  expect(report.environment.hardware.deviceMemoryGB).toBeGreaterThan(0);
  // Headless Chromium has no WebGPU adapter, so that half is legitimately null;
  // WebGL still names whatever renders here (SwiftShader on a CI box). Assert
  // the SHAPE either way so a probe that silently stops reporting is caught.
  expect(report.environment).toHaveProperty('gpuRenderers');
  expect(report.environment).toHaveProperty('webgpu');
  if (report.environment.gpuRenderers) {
    for (const g of report.environment.gpuRenderers) {
      expect(Array.isArray(g.powerPreference)).toBe(true);
      expect(typeof g.renderer === 'string' || g.renderer === null).toBe(true);
    }
  }

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

  // Suspend prevention: the wake lock was taken when Run was pressed, BEFORE
  // the model load began (only a transcription used to take it, leaving every
  // load between rows unprotected), and it was never released and re-taken
  // mid-run. A single request across the whole run is what "held throughout"
  // looks like from the API's side; the release itself lands after the report
  // is on screen and is not timed here.
  const wakeLog = await page.evaluate(() => window.__wakeLockLog);
  const requests = wakeLog.filter((e) => e.type === 'request');
  expect(requests.length, `wake lock log: ${JSON.stringify(wakeLog)}`).toBe(1);
  expect(requests[0].lockType).toBe('screen');
  expect(requests[0].t, 'the wake lock must be requested before the first model load, not by the first transcription')
    .toBeLessThanOrEqual(tLoading);
  const releasesBeforeReport = wakeLog.filter((e) => e.type === 'release' && e.t < Date.parse(report.generatedAt));
  expect(releasesBeforeReport, 'the wake lock was released while the run was still going').toEqual([]);

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
