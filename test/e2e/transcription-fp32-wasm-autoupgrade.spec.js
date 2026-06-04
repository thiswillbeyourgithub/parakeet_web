// Tier-3 E2E for the "requested quant not on HuggingFace, but the local /models
// mirror has it" auto-upgrade. The user picks WASM fp32, but the configured HF
// repo (istupakov) ships only the single 2.4 GB fp32 sidecar (no <2 GB shards),
// so resolveModelQuant would downgrade to the int8 pin. hub.js, given
// localUpgradeBaseUrl='/models' (App passes it on every HF attempt), probes the
// local mirror BEFORE downloading and, finding the fp32 shards there, switches
// the whole load to local so the user actually gets fp32.
//
// Unlike transcription-fp32-wasm.spec.js (which FORCES VITE_MODEL_SOURCE=local),
// this spec leaves the source at the default 'hf' and ROUTES the HF file-listing
// API to the real istupakov file set (no shards). That makes the downgrade
// happen for real, then proves the local auto-upgrade kicks in, all without
// touching the network. The shards still come from serve.mjs (MODEL_DIR/sharded),
// so the spec self-skips when they are absent (run scripts/shard-fp32.py first).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

const SHARD_PROBE = '/models/encoder-model.onnx.data.000';

// The real istupakov file set: a single-file fp32 encoder (encoder-model.onnx +
// encoder-model.onnx.data), int8 variants, vocab. Crucially NO encoder-model.
// onnx.data.NNN shards, so WASM fp32 downgrades to int8 against this listing.
const ISTUPAKOV_FILES = [
  'config.json',
  'decoder_joint-model.int8.onnx',
  'decoder_joint-model.onnx',
  'encoder-model.int8.onnx',
  'encoder-model.onnx',
  'encoder-model.onnx.data',
  'nemo128.onnx',
  'vocab.txt',
];

test('WASM fp32 auto-upgrades from HF (no shards) to the local sharded fp32 mirror', async ({ page, request, baseURL }) => {
  const head = await request.head(SHARD_PROBE).catch(() => null);
  test.skip(!head || !head.ok(),
    `no sharded fp32 encoder at ${baseURL}${SHARD_PROBE} (run scripts/shard-fp32.py for local fp32 coverage)`);

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

  // Stay on the default 'hf' source so App passes localUpgradeBaseUrl='/models'.
  await page.addInitScript(() => {
    window.__CONFIG__ = {
      VITE_MODEL_SOURCE: 'hf',
      VITE_MODEL_REPO: 'istupakov/parakeet-tdt-0.6b-v3-onnx',
    };
  });

  // Route the HF listing API to the real (shard-less) istupakov file set so the
  // downgrade is genuine. If the auto-upgrade works, NO HuggingFace *file*
  // download happens (the load switches to /models first), so we don't need to
  // route those; abort any that slip through so a regression that skips the
  // switch fails loudly instead of silently downloading int8 over the network.
  await page.route('**/huggingface.co/api/**', (route) =>
    route.fulfill({ json: ISTUPAKOV_FILES.map((path) => ({ type: 'file', path })) }));
  await page.route(/https:\/\/(huggingface\.co|cdn-lfs[^/]*\.huggingface\.co)\/(?!api\/).*/, (route) =>
    route.abort());

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Opt into fp32 via the real wasm-only encoder-precision radio.
  await page.locator('.settings-toggle').click();
  const fp32Radio = page.locator('input[name="wasmEncoderQuant"][value="fp32"]');
  await fp32Radio.waitFor({ state: 'visible', timeout: 30 * 1000 });
  await fp32Radio.check();
  await expect(fp32Radio).toBeChecked();
  await page.locator('.settings-sidebar-close').click();

  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('body')).toContainText('✔', { timeout: 7 * 60 * 1000 });

  // The whole point: hub.js detected HF could not serve fp32 and switched the
  // load to the local mirror, then mounted the sharded fp32 encoder. Assert both
  // signals, and that the int8 pin did NOT stand (the switch cleared it).
  expect(logs.some((l) => l.includes('HuggingFace cannot serve the requested quant')),
    `expected the local auto-upgrade to fire; saw logs:\n${logs.join('\n')}`).toBe(true);
  expect(logs.some((l) => l.includes('[Hub] Encoder fp32 in') && l.includes('shard')),
    'expected the sharded fp32 encoder to be mounted after the switch').toBe(true);
  expect(logs.some((l) => l.includes('pinned to int8')),
    'fp32 request unexpectedly stayed on the int8 pin').toBe(false);

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 7 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 7 * 60 * 1000 });
  await expect.poll(() => transcribeRuns, { timeout: 7 * 60 * 1000 }).toBeGreaterThan(0);

  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // Benign 404s from the local-layout HEAD probes (end-of-shard, optional decoder
  // sidecar) are expected; any other console error is a real failure.
  const realErrors = errors.filter((e) => !/Failed to load resource.*404/.test(e));
  expect(realErrors, `page console errors: ${realErrors.join('\n')}`).toHaveLength(0);
});
