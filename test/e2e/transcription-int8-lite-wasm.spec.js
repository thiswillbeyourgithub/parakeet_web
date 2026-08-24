// Tier-3 E2E for the WASM *lite int8* encoder path. The model repo ships two
// int8 encoders built from the same SmoothQuant calibration: the default keeps
// the 18 most quantisation-damaged MatMuls in fp32, the lite build keeps 11
// (`--exclude-worst 0.05`). That is ~88 MB less to download and ~164 MiB less
// peak RSS, for slightly higher WER, so it is opt-in by name through the
// "encoder precision: int8 lite" radio (persisted as wasmEncoderQuant).
//
// Unlike fp16 and the single-file fp32 encoder, this path is fully coverable in
// headless Chromium: it is plain WASM int8, just a different file. So this spec
// is the in-browser proof of the whole chain the pure unit tests cannot reach:
// radio -> persisted setting -> App.jsx request -> resolveModelQuant ->
// encoder-model.int8.lite.onnx -> ORT session -> a correct transcript.
//
// The interesting failure it guards against is a SILENT one. resolveModelQuant
// deliberately refuses to substitute the default int8 when a source ships no
// lite build (it pins, which surfaces the quantUnavailable banner), but a
// regression that collapsed 'int8lite' back to 'int8' anywhere along the chain
// would still produce a perfectly good transcript. Asserting the transcript
// alone would pass. So the spec pins WHICH FILE was fetched.
//
// The lite encoder is not fetched by scripts/fetch-e2e-models.mjs (CI pulls only
// the default int8 set), so when the static server does not serve it the spec
// skips in CI and FAILS locally, per test/e2e/strict-weights.mjs.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings, expandSettingsSection } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

const LITE_ENCODER = 'encoder-model.int8.lite.onnx';
const DEFAULT_ENCODER = 'encoder-model.int8.onnx';
const LITE_PROBE = `/models/${LITE_ENCODER}`;

test('transcribes JFK English (MP3) with the WASM lite int8 encoder', async ({ page, request, baseURL }) => {
  const head = await request.head(LITE_PROBE).catch(() => null);
  requireWeightsOrSkip(test, !head || !head.ok(),
    `no lite int8 encoder at ${baseURL}${LITE_PROBE} (build it with `
    + `parakeet-tdt-0.6b-v3-optimized-onnx/scripts/quantize-int8-smoothquant.py --exclude-worst 0.05, `
    + `or symlink it into fallback_models/, for local lite coverage)`);

  const FIXTURE_AUDIO = fixture('jfk.mp3');
  const GOLDEN = readFileSync(fixture('jfk.expected.txt'), 'utf-8').trim();

  const errors = [];
  const logs = [];
  let transcribeRuns = 0;
  page.on('console', (m) => {
    const text = m.text();
    logs.push(text);
    if (m.type() === 'error') errors.push(text);
    if (text.includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });

  // Force the LOCAL model source: only serve.mjs is guaranteed to carry the lite
  // encoder here, and a network HF fetch would make the assertion below depend
  // on what upstream happens to host. modelSource is build/runtime config
  // (CONFIG.VITE_MODEL_SOURCE), NOT an IndexedDB setting, so seeding it does
  // nothing; set window.__CONFIG__ before any page script runs instead.
  // addInitScript persists across the reload below.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Opt into the lite build through the real radio rather than seeding
  // wasmEncoderQuant: a seeded value is only applied by the ASYNC settings
  // restore, and clicking Load straight after reload can beat it (the spec would
  // then silently load the default int8 and fail on the filename assertion).
  // Driving the radio is race-free (synchronous state) and covers the real UI.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const liteRadio = page.locator('input[name="encoderQuant"][value="int8lite"]');
  await liteRadio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await liteRadio.check();
  await expect(liteRadio).toBeChecked();
  // The default int8 radio must still be there and unchecked: this is a choice
  // between two shipped builds, not a replacement of one by the other.
  await expect(page.locator(`input[name="encoderQuant"][value="int8"]`)).not.toBeChecked();
  // Close the settings sidebar so its overlay doesn't intercept the load click.
  await page.locator('.settings-sidebar-close').click();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the ✔ appears once weights are loaded and initialised.
  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // THE assertion this spec exists for. hub.js names every weight it fetches
  // ("Downloading <file>...") or restores ("Using cached <file>"), so the lite
  // name must appear and the default int8 name must not. The prefix is `[Hub]`
  // on the HuggingFace path and `[Hub:local]` on the local one, hence the
  // half-bracket match. Note `encoder-model.int8.onnx` is NOT a substring of the
  // lite filename, so the negative check is unambiguous. Without this, a
  // regression that collapsed 'int8lite' to 'int8' would load the heavier
  // encoder and still transcribe perfectly, i.e. pass every other assertion.
  const encoderLogs = logs.filter((l) => l.includes('[Hub') && l.includes('encoder-model'));
  expect(encoderLogs.some((l) => l.includes(LITE_ENCODER)),
    `expected the lite int8 encoder to be loaded; saw encoder logs:\n${encoderLogs.join('\n')}`).toBe(true);
  expect(encoderLogs.some((l) => l.includes(DEFAULT_ENCODER)),
    `the lite opt-in silently loaded the DEFAULT int8 encoder; saw:\n${encoderLogs.join('\n')}`).toBe(false);
  // A refused quant renders the quantUnavailable prompt (.fallback-prompt) and
  // never reaches ✔, so this is belt-and-braces: it turns "the request was
  // quietly downgraded" into an explicit failure rather than a subtle one.
  await expect(page.locator('.fallback-prompt')).toHaveCount(0);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // The lite build trades a little accuracy for size, so it gets the same
  // lenient overlap bar as the other encoders rather than an exact match: this
  // asserts "it really transcribes", not "it is as accurate as the default".
  // Accuracy is measured properly by scripts/wer-bench.mjs, not here.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The local-fallback resolver HEAD-probes candidate files that may not exist
  // (the fp32 shard walk, the optional decoder external-data sidecar) to
  // discover the layout. Those 404s are logged by the browser as "Failed to load
  // resource" and are expected. Ignore exactly those; any other console error
  // still fails the test.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
