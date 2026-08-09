// Tier-3 E2E for the *TopK* decoder preference and its decode-side fast path.
// The model repo can ship decoder_joint-model.int8.lse.topk.onnx
// (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/optimize-decoder-graph.py
// topk): the lse decoder with topk_logits/topk_ids/duration_logits appended, so
// a greedy decode step fetches a few dozen floats per joint call instead of
// reading the whole ~8.2k-float `outputs` row back out of ORT. hub.js
// (topkDecoderName) must PREFER it over the lse and stock names, and
// parakeet.js must actually ENGAGE the reduced fetch list on the default
// (greedy, temperature 0, boost-less) run.
//
// Two markers, both required, because either half can regress silently: the
// hub one proves the right FILE loaded, the parakeet one proves the decode loop
// took the fast path (a decoder can ship the outputs and still be consumed the
// old way, which would be invisible in the transcript).
//
// The second test pins the negative side of the gate: phrase boosting adds
// rewards to arbitrary vocab ids before the argmax, so a boosted run MUST keep
// the full logit row. The engaged marker must not appear there, while the
// transcript is still produced.
//
// The pure decision is unit-tested in get-parakeet-model-files.test.mjs and the
// consumption semantics (fetch list, equivalence, tie behaviour) in
// topk-decoder-outputs.test.mjs; THIS spec is the in-browser proof that the
// preferred file loads, initialises and decodes correctly on the WASM backend.
//
// The topk decoder is produced locally in the model working folder (and shipped
// by the Olicorne HF repo); the e2e model dir only carries it when a
// fallback_models symlink (or `npm run e2e:models`) provides the file, so when
// the static server does not serve it the spec SKIPS itself rather than fail,
// exactly like the LSE and optimized-encoder specs.
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

const TOPK_PROBE = '/models/decoder_joint-model.int8.lse.topk.onnx';
const HUB_MARKER = '[Hub] Using the TopK decoder decoder_joint-model.int8.lse.topk.onnx';
const ENGAGED_MARKER = '[Parakeet.js] TopK decoder outputs engaged';

const skipUnlessServed = async (test_, request, baseURL) => {
  const head = await request.head(TOPK_PROBE).catch(() => null);
  requireWeightsOrSkip(test_, !head || !head.ok(),
    `no TopK int8 decoder at ${baseURL}${TOPK_PROBE} (symlink it into fallback_models, or run parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/optimize-decoder-graph.py topk)`);
};

// The local-fallback resolver HEAD-probes candidates that do not exist (fp16
// variants, .data sidecars, the fp32 decoders). Those 404s surface as benign
// "Failed to load resource" console errors; anything else still fails.
const realErrors = (errors) => errors.filter((e) => !/Failed to load resource.*404/.test(e));

// Force the LOCAL model source at CONFIG level, same as the LSE spec: the
// preference is listing-gated and only the local /models server (serve.mjs) is
// guaranteed to serve the topk file, so without this the app would happily pull
// the stock decoder from HF and the marker assertion would fail.
const forceLocalSource = (page) =>
  page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

test('transcribes JFK English (MP3) with the TopK int8 decoder and the fast decode path engaged', async ({ page, request, baseURL }) => {
  await skipUnlessServed(test, request, baseURL);

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

  await forceLocalSource(page);
  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // Nothing is seeded: the fresh-install defaults (greedy width 1, temperature
  // 0, no phrase boost) are exactly the configuration the fast path targets, so
  // this also pins that it engages with ZERO configuration.
  expect(logs.some((l) => l.includes(HUB_MARKER)),
    `expected the TopK int8 decoder to be preferred; saw logs:\n${logs.join('\n')}`).toBe(true);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  // The decode loop actually took the reduced-fetch path.
  expect(logs.some((l) => l.includes(ENGAGED_MARKER)),
    `expected "${ENGAGED_MARKER}"; saw logs:\n${logs.join('\n')}`).toBe(true);

  // The graph returns the same fp32 logits the full row carries, so the
  // transcript faces the same golden bar as the stock specs.
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  expect(realErrors(errors), `page console errors: ${realErrors(errors).join('\n')}`).toHaveLength(0);
});

test('a phrase-boosted run keeps the full logit row (fast path must NOT engage)', async ({ page, request, baseURL }) => {
  await skipUnlessServed(test, request, baseURL);

  // French clinical clip + the same Title-case boost phrase the boost specs use
  // (the model opens the drug name with a capital, so the trie is genuinely
  // exercised on the winner path).
  const FIXTURE_AUDIO = fixture('sample.aac');
  const GOLDEN = readFileSync(fixture('sample.expected.txt'), 'utf-8').trim();

  const errors = [];
  const logs = [];
  let transcribeRuns = 0;
  page.on('console', (m) => {
    const text = m.text();
    logs.push(text);
    if (m.type() === 'error') errors.push(text);
    if (text.includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });

  await forceLocalSource(page);
  await page.goto('/');
  // Same seed ordering as transcription-relaxed-simd.spec.js: let the first
  // boot's default-persist storm flush before seeding, or the write is
  // clobbered and the reload silently reads the defaults back. beamWidth 1 with
  // beamWidthAuto false keeps this on the GREEDY path, so the ONLY reason the
  // fast path stays off is the active trie.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, {
    beamWidth: 1,
    beamWidthAuto: false,
    boostSource: '__custom__',
    boostPhrases: 'Venlafaxine:5',
    boostCustomText: 'Venlafaxine:5',
  });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The same TopK decoder file is loaded: only the CONSUMPTION differs.
  expect(logs.some((l) => l.includes(HUB_MARKER)),
    `expected the TopK int8 decoder to be preferred; saw logs:\n${logs.join('\n')}`).toBe(true);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  expect(logs.some((l) => l.includes(ENGAGED_MARKER)),
    `a boosted run must keep the full logit row, but the fast path engaged:\n${logs.join('\n')}`).toBe(false);

  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  expect(realErrors(errors), `page console errors: ${realErrors(errors).join('\n')}`).toHaveLength(0);
});
