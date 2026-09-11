// Tier-3 E2E for the GPU-to-WASM fallback when a model source ships no encoder
// the GPU may use unasked (no fp16 file here).
//
// Why this matters enough to have its own spec: since WebGPU was re-enabled,
// the performance probe can put a visitor on the GPU backend without them ever
// choosing it. If the deployment's model repo cannot serve GPU weights, that
// visitor used to land on a dead "Failed" screen for a decision they did not
// make. hub.js still refuses to silently downgrade the quant (that guard is
// what makes the failure legible at all, see transcription-fp32-wasm-no-
// downgrade.spec.js); App.jsx now catches the resulting QuantUnavailableError
// on a webgpu backend, switches to WASM, and says so.
//
// The fallback is deliberately narrow, and this spec pins that too: it fires
// for a quant that cannot be SERVED, which is a property of the deployment
// known before any weight byte is fetched, and it fires at most once per load.
//
// It is also the ONLY substitution the app makes. WASM int8 is where it lands,
// never another GPU precision: fp32 would hand somebody who was never asked a
// 2.35 GB download, and w4a8 would quietly swap in the weakest encoder on long
// audio. Both stay one deliberate click away and nothing else. That is why the
// mirror here hides EVERY GPU encoder rather than only the default one: if the
// app ever grew a GPU-to-GPU substitution again, this spec would still pass
// while the contract was gone, so the source has to be unable to offer any.
//
// The machine is stubbed with a WebGPU adapter so the backend is selectable
// without a GPU, and weights come from the local mirror with only the GPU
// encoders routed away, so the WASM retry is a real load with real int8 files.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection, APP_VERSION } from './seed.mjs';
import { routeLocalMirrorWithoutGpuEncoders } from './routes.mjs';
import { requireWeightsOrSkip } from './strict-weights.mjs';
import { probeModelUrl } from './model-probe.mjs';
import { ASR_REPO } from '../../scripts/fetch-e2e-models.mjs';

const ADAPTER = () => {
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        // shader-f16 is reported so the adapter looks fully capable, which is
        // what makes this spec about the SOURCE: the precision under test is
        // the GPU default, fp16, this machine can run it, and it has to come
        // back unhosted for the fallback to be the thing being measured. The
        // other direction (a hosted fp16 no adapter can run) reaches the same
        // fallback through the same catch.
        features: new Set(['shader-f16']),
        limits: {},
        info: { vendor: 'test', architecture: 'stub', device: '' },
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  });
};

const INT8_ENCODER = 'encoder-model.int8.onnx';

test('a source with no GPU encoder falls back to WASM instead of failing the load', async ({ page, request, baseURL }) => {
  test.setTimeout(8 * 60 * 1000);
  // The WASM retry is a REAL load, so it needs the int8 encoder present.
  const probed = await probeModelUrl(request, ASR_REPO, INT8_ENCODER);
  requireWeightsOrSkip(test, !probed, `no int8 encoder under ${baseURL}/models (tried the nested and flat layouts)`);

  const logs = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.addInitScript(ADAPTER);
  // Serve everything from the local mirror, then take the GPU encoders away.
  await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });
  await routeLocalMirrorWithoutGpuEncoders(page);

  await page.goto('/');
  // Model the machine this fallback exists for: one the autoconfigure probe
  // already moved to the GPU, so the visitor never chose WebGPU themselves.
  // Seeding a STILL-VALID verdict is also what keeps the premise intact: with
  // no stored verdict, shouldAutoProbe() fires on the Load click, the GPU arm
  // fails against a stub adapter, and the probe puts the page back on WASM
  // before the GPU weights are ever requested (the first run of this spec
  // failed exactly that way: a green load with no fallback in sight). The
  // adapter string must match what App.jsx builds from adapter.info above.
  await seedSettings(page, {
    backend: 'webgpu-hybrid',
    perfProbeVerdict: {
      backend: 'webgpu-hybrid', speedup: 5.4, at: Date.now(),
      appVersion: APP_VERSION, adapter: 'test/stub/',
    },
  });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Assert the fallback FIRST: it happens seconds in, before any weight byte,
  // so a failure here is fast and points at the fallback rather than timing
  // out minutes later on a downstream symptom. Exactly once, because a retry
  // loop would re-download the model on every attempt.
  const FALLBACK_MARKER = 'falling back to WASM int8';
  await expect.poll(
    () => logs.filter((l) => l.includes(FALLBACK_MARKER)).length,
    { timeout: 90 * 1000, message: 'the GPU-to-WASM fallback never fired' },
  ).toBe(1);

  // It must say what it did, rather than quietly running on a backend the
  // visitor did not ask for. Matched on a phrase from the middle of the
  // `gpuQuantFallback` string rather than its opening words: this assertion
  // silently went stale once already (c21cb0f reworded the banner and only the
  // i18n side was updated), so it deliberately keys on the fact the banner has
  // to convey, that the CPU version was loaded instead.
  await expect(
    page.locator('.fallback-prompt', { hasText: 'the CPU version was loaded instead' }),
  ).toBeVisible();

  // The load must RECOVER, not fail: the check mark is the whole point.
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  await expect(page.locator('body')).not.toContainText(/Failed|Échec/);

  // And the UI must now agree with reality: WASM, with int8 actually loaded.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeChecked();
  expect(logs.some((l) => /int8/.test(l))).toBe(true);

  // And it must SAY so, rather than leave the radios agreeing by luck. The
  // "Currently loaded" row is the only thing in the UI that reports an OUTCOME
  // instead of a request, which is what makes a fallback like this one legible:
  // the backend, the precision that really mounted, and the source.
  const loadedRow = page.getByTestId('loaded-model');
  await expect(loadedRow).toBeVisible();
  await expect(loadedRow).toHaveText(/int8/);
  await expect(loadedRow).toHaveText(/from this server/);
  // The fallback reconciled the selection with reality (it flipped the backend
  // too), so the row must NOT be crying divergence: a warning that fires after
  // a fallback did its job correctly is a warning people learn to ignore.
  await expect(page.locator('.setting-row--loaded.setting-row--mismatch')).toHaveCount(0);

  // Still exactly one after the whole load: the WASM retry must not re-enter.
  expect(logs.filter((l) => l.includes(FALLBACK_MARKER))).toHaveLength(1);

  // And the load that recovered is the one the fallback is allowed to make:
  // int8 on the CPU. A GPU precision appearing here would mean the app had
  // substituted a download nobody asked for, which the `int8` assertion on the
  // loaded row above only half covers (that row reports the encoder, this
  // covers the whole attempt sequence).
  // fp16 is deliberately NOT in this pattern: it is the precision that was
  // asked for and refused, so hub.js names it in the QuantUnavailableError it
  // throws, and that thrown message is the fallback working rather than a
  // second attempt. The fp32 shards and the w4a8 file are the ones no code path
  // may reach for on its own, and either one appearing in a log at all means
  // something tried to fetch it.
  const gpuEncoderMentions = logs.filter((l) => /encoder-model\.w4a8\.onnx|encoder-model\.onnx\.data/.test(l));
  expect(gpuEncoderMentions,
    'no fp32 or w4a8 encoder may be attempted on the way to the fallback').toEqual([]);
});
