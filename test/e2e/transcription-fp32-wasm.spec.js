// Tier-3 E2E for the WASM *sharded fp32* encoder path. Unlike the single 2.4 GB
// fp32 sidecar (which trips the 32-bit WASM ArrayBuffer cap and Chromium's
// ~2 GB blob-fetch cap), parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py splits the fp32 encoder weights
// into encoder-model.onnx.data.NNN pieces, each < 2 GB, so the full-precision
// encoder CAN load and run on the WASM backend in a real headless Chromium.
// resolveModelQuant() gates this behind the allowWasmFp32 opt-in (the UI's
// "encoder precision: fp32" radio, persisted as wasmEncoderQuant); the pure
// decision is unit-tested in test/unit/resolve-quant.test.mjs, and THIS spec is
// the in-browser proof that the gated path actually loads weights and produces a
// correct transcript (not a silent fall-back to int8).
//
// The shards are produced locally by parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py and are NOT shipped
// by the upstream istupakov repo, so they cannot be fetched in CI. When the
// static server has no sharded/ encoder available the spec SKIPS itself rather
// than fail: run `uv run parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py` (writes ./fallback_models/sharded)
// to get coverage locally. serve.mjs serves those shards from MODEL_DIR/sharded/.
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

// The first fp32 shard is the cheapest unambiguous signal that the sharded
// encoder is being served (single-sidecar fp32 has no .data.000). If it is not
// present the opt-in would fall back to the int8 pin, so there is nothing to
// test: skip.
const SHARD_PROBE = '/models/encoder-model.onnx.data.000';

test('transcribes JFK English (MP3) with the WASM sharded fp32 encoder', async ({ page, request, baseURL }) => {
  const head = await request.head(SHARD_PROBE).catch(() => null);
  test.skip(!head || !head.ok(),
    `no sharded fp32 encoder at ${baseURL}${SHARD_PROBE} (run parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py for local fp32 coverage)`);

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

  // Force the LOCAL model source. The sharded fp32 weights only exist on the
  // local /models server (serve.mjs); the upstream HF repo ships no shards, so
  // without this the app downloads the int8 encoder from HF and the fp32 opt-in
  // silently falls back to the int8 pin. modelSource is build/runtime config
  // (CONFIG.VITE_MODEL_SOURCE, normally injected by the deploy-time /config.js),
  // NOT an IndexedDB setting, so seeding it does nothing; set window.__CONFIG__
  // before any page script runs instead. addInitScript persists across the
  // reload below.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  // Seed the WASM backend (so the fp32 encoder-precision control renders, it is
  // wasm-only) and reload so the app boots with it.
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Opt into the fp32 encoder through the real control rather than a seeded
  // value: the encoder-precision radios live in Settings (fp32 is offered on
  // both WASM and WebGPU; here we are on WASM). Driving it directly is both
  // race-free (synchronous React
  // state, unlike the async settings restore) and a faithful test of the actual
  // UI path a user takes.
  await page.locator('.settings-toggle').click();
  // The encoder-precision radios live in the (collapsed) Engine section.
  await expandSettingsSection(page, 'Engine');
  const fp32Radio = page.locator('input[name="encoderQuant"][value="fp32"]');
  await fp32Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await fp32Radio.check();
  await expect(fp32Radio).toBeChecked();
  // Close the settings sidebar so its overlay doesn't intercept the load click.
  await page.locator('.settings-sidebar-close').click();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the ✔ appears once weights are loaded and initialised. fp32 on
  // CPU/WASM is heavier than int8, so lean on the config's generous timeout.
  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The fp32 path is only meaningful if it actually resolved to the sharded fp32
  // encoder. hub.js logs this exactly when it mounts the multi-file external
  // data, and it logs the int8-pin warning if the opt-in fell back. Assert the
  // positive signal is present and the fall-back is absent: this is what keeps
  // the test from passing on a silent int8 run.
  expect(logs.some((l) => l.includes('[Hub] Encoder fp32 in') && l.includes('shard')),
    `expected the sharded fp32 encoder to be mounted; saw logs:\n${logs.join('\n')}`).toBe(true);
  expect(logs.some((l) => l.includes('pinned to int8')),
    'fp32 opt-in unexpectedly fell back to the int8 pin').toBe(false);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // fp32 is full precision, so its transcript should match the int8 golden at
  // least as well as int8 does; reuse the same lenient overlap bar.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The local-fallback resolver HEAD-probes candidate files that do not exist
  // to discover the layout: the end of the fp32 shard sequence
  // (encoder-model.onnx.data.002) and the optional decoder external-data sidecar
  // (decoder_joint-model.onnx.data). Those 404s are logged by the browser as
  // "Failed to load resource" and are expected, not failures. Ignore exactly
  // those benign probe misses; any other console error (e.g. the
  // TypeError: Failed to fetch / NotReadableError that the shard-loading fixes
  // resolved) still fails the test.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
