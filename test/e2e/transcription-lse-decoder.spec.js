// Tier-3 E2E for the *LSE* decoder preference. The model repo can ship
// decoder_joint-model.int8.lse.onnx (parakeet-tdt-0.6b-v3-smoothquant-onnx/
// scripts/optimize-decoder-graph.py lse): the stock int8 decoder/joint with
// lse_token/lse_duration log-partition outputs appended, which the beam
// decoder consumes via _partition instead of running its own JS log-sum-exp
// over the ~8k token logits per hypothesis expansion. hub.js (lseDecoderName)
// must PREFER it whenever the active source lists it, with no change to the
// reported quant. The pure decision is unit-tested in
// get-parakeet-model-files.test.mjs and the consumption semantics in
// beam-decode.test.mjs; THIS spec is the in-browser proof that the preferred
// file actually loads, initialises, and produces a correct transcript on the
// WASM backend with a real beam width (the LSE path is beam-only, so the spec
// seeds a deliberate width 5 instead of the fresh-install greedy default).
//
// The LSE decoder is produced locally in the model working folder (and shipped
// by the Olicorne HF repo); the e2e model dir only carries it when a
// fallback_models symlink (or `npm run e2e:models` once the fetch list includes
// it) provides the file, so when the static server does not serve it the spec
// SKIPS itself rather than fail, exactly like the optimized-encoder spec.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { words, overlap } from './text-overlap.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';
import { seedSettings } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

const LSE_PROBE = '/models/decoder_joint-model.int8.lse.onnx';

test('transcribes JFK English (MP3) at beam 5 preferring the LSE int8 decoder', async ({ page, request, baseURL }) => {
  const head = await request.head(LSE_PROBE).catch(() => null);
  requireWeightsOrSkip(test, !head || !head.ok(),
    `no LSE int8 decoder at ${baseURL}${LSE_PROBE} (symlink it into fallback_models, or run parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/optimize-decoder-graph.py lse)`);

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

  // Force the LOCAL model source at CONFIG level (same window.__CONFIG__
  // mechanism as the optimized-encoder spec): the LSE preference is
  // listing-gated, and only the local /models server (serve.mjs) is
  // guaranteed to serve the lse file. The seeded `modelSource: 'local'` alone
  // is NOT enough: it only enables the local fallback, the app still lists
  // the HF repo first, and until the lse artifact is pushed there the app
  // would deterministically download the stock decoder from the network
  // (observed: the un-CONFIG'd run pulled decoder_joint-model.int8.onnx from
  // HF and the marker assertion failed).
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  // Seed a deliberate beam width on top: the LSE outputs are only consumed on
  // the beam path (greedy never computes a partition). beamWidthAuto false
  // marks the width as a user choice so the boost-state coupling cannot drop
  // it back to 1. int8 is the default decoder precision, so no quant seeding
  // is needed: the lse file must be picked up with zero further configuration.
  await page.goto('/');
  await seedSettings(page, { beamWidth: 5, beamWidthAuto: false });
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The positive signal: hub.js logs exactly this when it swaps the canonical
  // int8 name for the lse one. Without it the test would silently pass on the
  // stock decoder and prove nothing.
  expect(logs.some((l) => l.includes('[Hub] Using the LSE decoder decoder_joint-model.int8.lse.onnx')),
    `expected the LSE int8 decoder to be preferred; saw logs:\n${logs.join('\n')}`).toBe(true);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // The in-graph partitions match the JS fallback to ~2e-12, so the beam-5
  // transcript faces the same golden bar as the stock specs.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The local-fallback resolver HEAD-probes candidates that do not exist (.data
  // sidecars, the fp32 lse decoder). Those 404s surface as
  // benign "Failed to load resource" console errors; anything else still fails.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
