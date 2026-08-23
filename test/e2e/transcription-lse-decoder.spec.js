// Tier-3 E2E for the decoder's in-graph log-partition (LSE) outputs on the BEAM
// path. The model repo's canonical decoders carry `lse_token`/`lse_duration`
// (parakeet-tdt-0.6b-v3-optimized-onnx/scripts/optimize-decoder-graph.py lse),
// the log-sum-exp of the token and TDT-duration logit slices, which the beam
// decoder reads in _partition instead of running its own JS pass over the ~8k
// token logits per hypothesis per step.
//
// Why this exists next to transcription-topk-decoder.spec.js: that spec covers
// the GREEDY consumer (the reduced fetch list). The LSE scalars are consumed on
// the BEAM path, which greedy never exercises, so this one seeds beam 5 and
// asserts the transcript still matches the golden. Their consumption is silent
// by design (a stock decoder simply leaves them undefined), so the assertion
// here is the capability marker plus an unchanged transcript: if the graph
// values ever diverged from the JS fallback, the beam-5 transcript is where it
// would show.
//
// Nothing here checks a FILENAME: those outputs ship inside the canonical name
// now, so the only honest signal is what the loaded session declares. Against a
// stock upstream decoder (istupakov) the spec SKIPS; under
// PARAKEET_E2E_STRICT_WEIGHTS that skip becomes a failure, which is right on a
// maintainer checkout.
//
// The numeric equivalence itself (graph values vs the JS log-sum-exp) is
// unit-tested; this is the in-browser proof.
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

const CAPABLE_MARKER = '[Parakeet.js] Decoder in-graph outputs: log-partition=yes';

test('transcribes JFK English (MP3) at beam 5 on a decoder with in-graph log-partition outputs', async ({ page }) => {
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

  // Force the LOCAL model source at CONFIG level: only the local /models server
  // (serve.mjs) is guaranteed to serve the promoted decoder. The seeded
  // `modelSource: 'local'` alone is NOT enough, it only enables the local
  // fallback while the app still lists the HF repo first.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

  // Seed a deliberate beam width: the LSE outputs are only consumed on the beam
  // path (greedy never computes a partition). beamWidthAuto false marks the
  // width as a user choice so the boost-state coupling cannot drop it back to 1.
  await page.goto('/');
  await seedSettings(page, { beamWidth: 5, beamWidthAuto: false });
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  requireWeightsOrSkip(test, !logs.some((l) => l.includes(CAPABLE_MARKER)),
    `the served decoder declares no in-graph log-partition outputs (a stock upstream build); logs:\n${logs.join('\n')}`);

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
  // sidecars, the fp32 decoder). Those 404s surface as benign "Failed to load
  // resource" console errors; anything else still fails.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
