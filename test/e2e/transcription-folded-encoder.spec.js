// Tier-3 E2E for the *folded* int8 encoder preference. The model repo can ship
// encoder-model.int8.folded.onnx (parakeet-tdt-0.6b-v3-smoothquant-onnx/
// scripts/optimize-encoder-graph.py fold): identical weights and numerics, ~23%
// fewer graph nodes, faster ORT session build. hub.js (foldedEncoderName) must
// PREFER it whenever the active source lists it, with no change to the reported
// quant. The pure decision is unit-tested in get-parakeet-model-files.test.mjs;
// THIS spec is the in-browser proof that the preferred file actually loads,
// initialises, and produces a correct transcript on the WASM backend.
//
// The folded encoder is produced locally in the model working folder (and
// shipped by the Olicorne HF repo); the e2e model dir only carries it when a
// fallback_models symlink (or `npm run e2e:models` once the fetch list includes
// it) provides the file, so when the static server does not serve it the spec
// SKIPS itself rather than fail, exactly like the sharded-fp32 spec.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { words, overlap } from './text-overlap.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

const FOLDED_PROBE = '/models/encoder-model.int8.folded.onnx';

test('transcribes JFK English (MP3) preferring the folded int8 encoder', async ({ page, request, baseURL }) => {
  const head = await request.head(FOLDED_PROBE).catch(() => null);
  requireWeightsOrSkip(test, !head || !head.ok(),
    `no folded int8 encoder at ${baseURL}${FOLDED_PROBE} (symlink it into fallback_models, or run parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/optimize-encoder-graph.py fold)`);

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

  // Force the LOCAL model source: the folded preference is listing-gated, and
  // only the local /models server (serve.mjs) is guaranteed to serve the folded
  // file here; against HF the app would use whatever that repo lists and the
  // test would not be deterministic. Same window.__CONFIG__ mechanism as the
  // sharded-fp32 spec (modelSource is build/runtime config, not an IDB setting).
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  // int8 is the default encoder precision, so no quant seeding is needed: the
  // folded file must be picked up with zero configuration.
  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The positive signal: hub.js logs exactly this when it swaps the canonical
  // int8 name for the folded one. Without it the test would silently pass on
  // the unfolded encoder and prove nothing.
  expect(logs.some((l) => l.includes('[Hub] Using the folded encoder encoder-model.int8.folded.onnx')),
    `expected the folded int8 encoder to be preferred; saw logs:\n${logs.join('\n')}`).toBe(true);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // The fold is numerics-identical, so the folded transcript faces the same
  // golden bar as the stock int8 spec.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The local-fallback resolver HEAD-probes candidates that do not exist (fp16
  // variants, .data sidecars, the folded fp16). Those 404s surface as benign
  // "Failed to load resource" console errors; anything else still fails.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
