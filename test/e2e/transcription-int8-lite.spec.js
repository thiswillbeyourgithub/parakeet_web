// Tier-3 E2E for the WASM "int8 lite" encoder path. The lite build
// (encoder-model.int8.lite.onnx, ~757 MB: more linear2 nodes kept in fp32 than
// the default ~841 MB int8) is an opt-in WASM encoder. resolveModelQuant() only
// selects it when the active source actually ships the lite file (the pure
// decision is unit-tested in test/unit/resolve-quant.test.mjs); THIS spec is the
// in-browser proof that picking it actually fetches the lite weights and produces
// a correct transcript (not a silent fall-back to the default int8 encoder).
//
// The upstream istupakov repo ships no lite file, so CI (which fetches only the
// default int8 files via `npm run e2e:models`) cannot run it: when the static
// server has no lite encoder the spec SKIPS itself rather than fail. The
// Olicorne model repo ships encoder-model.int8.lite.onnx; serve.mjs serves it
// from MODEL_DIR for local coverage.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings, expandSettingsSection } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

// The lite encoder file is the unambiguous signal that this build is being
// served. If it is absent the opt-in would fail loudly (QuantUnavailableError),
// so there is nothing positive to test here: skip.
const LITE_PROBE = '/models/encoder-model.int8.lite.onnx';

test('transcribes JFK English (MP3) with the WASM int8 lite encoder', async ({ page, request, baseURL }) => {
  const head = await request.head(LITE_PROBE).catch(() => null);
  test.skip(!head || !head.ok(),
    `no lite encoder at ${baseURL}${LITE_PROBE} (the Olicorne model repo ships encoder-model.int8.lite.onnx for local coverage)`);

  const FIXTURE_AUDIO = fixture('jfk.mp3');
  const GOLDEN = readFileSync(fixture('jfk.expected.txt'), 'utf-8').trim();

  const errors = [];
  const logs = [];
  let transcribeRuns = 0;
  let sawLiteFetch = false;
  let sawDefaultInt8Fetch = false;
  page.on('console', (m) => {
    const text = m.text();
    logs.push(text);
    if (m.type() === 'error') errors.push(text);
    if (text.includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });
  // The decisive signal that the lite build (not the default int8) actually
  // loaded: the lite file is the one fetched, and the default int8 encoder is not.
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('encoder-model.int8.lite.onnx')) sawLiteFetch = true;
    else if (/encoder-model\.int8\.onnx(\?|$)/.test(u)) sawDefaultInt8Fetch = true;
  });

  // Force the LOCAL model source so the lite file is served from serve.mjs's
  // MODEL_DIR. modelSource is runtime config (CONFIG.VITE_MODEL_SOURCE), not an
  // IndexedDB setting, so set window.__CONFIG__ before any page script runs.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  // Seed the WASM backend (the lite encoder-precision control is WASM-only) and
  // reload so the app boots with it.
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Opt into the lite encoder through the real control: the encoder-precision
  // radios live in the (collapsed) Engine section. Driving the radio directly is
  // race-free (synchronous React state) and exercises the real UI path.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  const liteRadio = page.locator('input[name="encoderQuant"][value="int8-lite"]');
  await liteRadio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await liteRadio.check();
  await expect(liteRadio).toBeChecked();
  // Close the settings sidebar so its overlay doesn't intercept the load click.
  await page.locator('.settings-sidebar-close').click();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the ✔ appears once weights are loaded and initialised.
  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The lite path is only meaningful if it actually fetched the lite encoder and
  // NOT the default int8 one. This is what keeps the test from passing on a
  // silent default-int8 run.
  expect(sawLiteFetch, `expected the lite encoder to be fetched; saw logs:\n${logs.join('\n')}`).toBe(true);
  expect(sawDefaultInt8Fetch, 'must NOT fetch the default int8 encoder when lite was requested').toBe(false);
  expect(logs.some((l) => l.includes('pinned to int8')),
    'lite opt-in unexpectedly fell back to the default int8 pin').toBe(false);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // The lite build is near-int8 quality, so its transcript should match the int8
  // golden at least as well as the default int8 does; reuse the same lenient bar.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The local-fallback resolver HEAD-probes candidate files that may not exist
  // (fp16 variants, the fp32 sidecar/shards, the decoder external-data sidecar)
  // to discover the layout; those 404s are logged by the browser as "Failed to
  // load resource" and are expected, not failures. Any OTHER console error fails.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
