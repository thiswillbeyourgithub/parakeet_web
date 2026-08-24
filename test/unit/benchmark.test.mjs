// Tier-1 unit tests for the self-service benchmark harness
// (app/ui/src/lib/benchmark.js): the combination planner, the PCM tiler that
// builds the long profile out of the one shipped clip, the transcript
// similarity check, the fake-driven run loop (failures, unavailable quants,
// cancellation, repeats), and the anonymiser that decides what a report is
// allowed to carry. Pure logic: no model, no DOM, no network.
// Built with Claude Code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BENCHMARK_CLIP,
  HEAVY_DOWNLOAD_MB,
  QUANT_DOWNLOAD_MB,
  anonymizeEnvironment,
  buildBenchmarkReport,
  engineHintFromUserAgent,
  estimatedDownloadMB,
  formatBenchmarkReport,
  median,
  normalizeForCompare,
  planBenchmark,
  runBenchmarkPlan,
  tilePcm,
  transcriptSimilarity,
} from '../../app/ui/src/lib/benchmark.js';

describe('planBenchmark', () => {
  test('a WASM-only device gets the three WASM rows and no GPU row', () => {
    const plan = planBenchmark({ webgpuAvailable: false });
    // The default selection (int8) sorts last so it stays the cached model.
    assert.deepEqual(plan.map(r => r.id), ['wasm:int8lite', 'wasm:fp32', 'wasm:int8']);
    assert.ok(plan.every(r => r.backend === 'wasm'));
  });

  test('the lite int8 encoder is offered on WASM but never pre-selected', () => {
    const plan = planBenchmark({ webgpuAvailable: true });
    const lite = plan.find(r => r.id === 'wasm:int8lite');
    assert.ok(lite, 'int8lite must be offered on WASM');
    // Under the heavy threshold, yet still opt-in: it is an ALTERNATIVE to a
    // precision the visitor already has, so pre-checking it would silently turn
    // a free default run into an 810 MB one. See OPT_IN_QUANTS.
    assert.equal(lite.heavy, false);
    assert.equal(lite.defaultSelected, false);
    // Lighter than the default int8, which is the whole reason it exists.
    assert.ok(QUANT_DOWNLOAD_MB.int8lite < QUANT_DOWNLOAD_MB.int8);
    // No GPU row: the GPU EP has no int8 encoder kernel, lite or not.
    assert.equal(plan.some(r => r.backend.startsWith('webgpu') && r.quant === 'int8lite'), false);
  });

  // The regression this pins: adding a row must not change what a default run
  // costs. A typical int8 visitor's default selection is exactly their own
  // cached row, so pressing Run without touching a checkbox downloads nothing.
  test('adding int8lite left the default selection a single free row', () => {
    const plan = planBenchmark({ currentBackend: 'wasm', currentWasmQuant: 'int8' });
    const selected = plan.filter(r => r.defaultSelected);
    assert.deepEqual(selected.map(r => r.id), ['wasm:int8']);
    // Their own model is the one the cache holds, so the default run is free.
    assert.equal(estimatedDownloadMB(selected, ['wasm:int8']), 0);
  });

  test('a visitor already on int8lite gets that row checked, current and sorted last', () => {
    const plan = planBenchmark({ currentBackend: 'wasm', currentWasmQuant: 'int8lite' });
    const lite = plan[plan.length - 1];
    assert.equal(lite.id, 'wasm:int8lite');
    assert.equal(plan.filter(r => r.isCurrent).length, 1);
    // isCurrent beats the opt-in rule: their model is already cached, so
    // selecting it costs nothing, exactly as for a heavy row they already run.
    assert.equal(lite.defaultSelected, true);
  });

  test('the currently selected combination is sorted last so it stays cached', () => {
    const plan = planBenchmark({ currentBackend: 'wasm', currentWasmQuant: 'fp32' });
    assert.equal(plan[plan.length - 1].id, 'wasm:fp32');
    assert.equal(plan[plan.length - 1].isCurrent, true);
    assert.equal(plan.filter(r => r.isCurrent).length, 1);
  });

  test('WebGPU rows appear only when an adapter is available and not disabled', () => {
    const off = planBenchmark({ webgpuAvailable: true, webgpuDisabled: true });
    assert.ok(off.every(r => r.backend === 'wasm'));
    const on = planBenchmark({ webgpuAvailable: true });
    // fp32 is the only precision the GPU EP has an encoder kernel for, so it is
    // the only WebGPU row (the model repo's fp16 build was withdrawn 2026-08-23).
    assert.deepEqual(
      on.filter(r => r.backend === 'webgpu-hybrid').map(r => r.quant),
      ['fp32'],
    );
  });

  test('heavy (fp32) rows are unchecked by default unless already selected', () => {
    const plan = planBenchmark({ webgpuAvailable: true });
    const fp32 = plan.find(r => r.id === 'wasm:fp32');
    assert.equal(fp32.heavy, true);
    assert.equal(fp32.defaultSelected, false);
    assert.ok(QUANT_DOWNLOAD_MB.fp32 > HEAVY_DOWNLOAD_MB);
    const int8 = plan.find(r => r.id === 'wasm:int8');
    assert.equal(int8.heavy, false);
    assert.equal(int8.defaultSelected, true);
    // The visitor's own fp32 selection is already cached, so it stays checked.
    const own = planBenchmark({ currentBackend: 'wasm', currentWasmQuant: 'fp32' });
    assert.equal(own.find(r => r.id === 'wasm:fp32').defaultSelected, true);
  });

  test('estimatedDownloadMB skips combinations already on disk', () => {
    const plan = planBenchmark({});
    const all = estimatedDownloadMB(plan);
    assert.equal(all, QUANT_DOWNLOAD_MB.int8lite + QUANT_DOWNLOAD_MB.int8 + QUANT_DOWNLOAD_MB.fp32);
    assert.equal(estimatedDownloadMB(plan, ['wasm:int8']), all - QUANT_DOWNLOAD_MB.int8);
    assert.equal(estimatedDownloadMB(plan, ['wasm:int8lite']), all - QUANT_DOWNLOAD_MB.int8lite);
  });
});

describe('tilePcm', () => {
  test('repeats the clip until the target length is covered', () => {
    const pcm = Float32Array.from([1, 2, 3, 4]);
    const out = tilePcm(pcm, 10 / 4, 4); // 10 samples at 4 Hz
    assert.equal(out.length, 10);
    assert.deepEqual([...out], [1, 2, 3, 4, 1, 2, 3, 4, 1, 2]);
  });

  test('is a no-op when the clip is already long enough', () => {
    const pcm = Float32Array.from([1, 2, 3, 4]);
    assert.equal(tilePcm(pcm, 1, 4), pcm);
    assert.equal(tilePcm(pcm, 0.5, 4), pcm);
  });

  test('tolerates an empty input instead of looping forever', () => {
    const empty = new Float32Array(0);
    assert.equal(tilePcm(empty, 10, 16000), empty);
  });
});

describe('transcript similarity', () => {
  test('normalizes case, punctuation and whitespace but keeps accents', () => {
    assert.equal(normalizeForCompare('  Hello,   World! '), 'hello world');
    assert.equal(normalizeForCompare('Périmé.'), 'périmé');
  });

  test('scores identical text 1 and disjoint text 0', () => {
    assert.equal(transcriptSimilarity(BENCHMARK_CLIP.expectedText, BENCHMARK_CLIP.expectedText), 1);
    assert.equal(transcriptSimilarity('alpha beta', 'gamma delta'), 0);
  });

  test('an empty transcript (the symptom of a session whose kernels never compiled) scores 0', () => {
    assert.equal(transcriptSimilarity(BENCHMARK_CLIP.expectedText, ''), 0);
    assert.equal(transcriptSimilarity('', ''), 1);
  });

  test('a partial transcript lands strictly between 0 and 1', () => {
    const s = transcriptSimilarity('one two three four', 'one two');
    assert.ok(s > 0 && s < 1, `expected a partial score, got ${s}`);
  });
});

describe('median', () => {
  test('handles odd, even and empty inputs', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
    assert.equal(median([NaN, undefined, 5]), 5);
  });
});

// A fake driver environment: a monotonic clock the test controls, and
// callbacks that record what the driver asked for.
function fakeDeps(overrides = {}) {
  const calls = { applied: [], loaded: [], transcribed: [], progress: [] };
  let clock = 0;
  return {
    calls,
    deps: {
      now: () => (clock += 100),
      applyCombo: async (c) => { calls.applied.push(c.id); },
      loadModel: async (c) => { calls.loaded.push(c.id); },
      transcribe: async ({ combo, profile }) => {
        calls.transcribed.push(`${combo.id}/${profile}`);
        return {
          text: BENCHMARK_CLIP.expectedText,
          metrics: { encode_ms: 1000.456, decode_ms: 200, junk: 'dropped' },
          audioSec: 11,
          chunks: 1,
        };
      },
      onProgress: (e) => { calls.progress.push(e.phase); },
      ...overrides,
    },
  };
}

describe('runBenchmarkPlan', () => {
  test('runs every combination and reports a per-row rtf and similarity', async () => {
    const { deps, calls } = fakeDeps();
    const plan = planBenchmark({}).filter(c => !c.heavy);
    const results = await runBenchmarkPlan(plan, deps);

    assert.deepEqual(calls.applied, plan.map(c => c.id));
    assert.deepEqual(calls.loaded, plan.map(c => c.id));
    assert.equal(results.length, plan.length);
    for (const r of results) {
      assert.equal(r.status, 'ok');
      assert.equal(r.profile, 'short');
      assert.equal(r.audioSec, 11);
      assert.equal(r.similarity, 1);
      assert.equal(typeof r.rtf, 'number');
      assert.equal(r.metrics.encode_ms, 1000.46);
      assert.ok(!('junk' in r.metrics), 'non-numeric metric fields must be dropped');
      assert.ok(r.loadMs > 0);
    }
    assert.equal(calls.progress[calls.progress.length - 1], 'done');
  });

  test('multiple profiles reuse one model load and only the short one is scored', async () => {
    const { deps, calls } = fakeDeps();
    const plan = [planBenchmark({})[0]];
    const results = await runBenchmarkPlan(plan, { ...deps, profiles: ['short', 'long'] });
    assert.equal(calls.loaded.length, 1, 'the model must be loaded once per combination');
    assert.deepEqual(calls.transcribed, [`${plan[0].id}/short`, `${plan[0].id}/long`]);
    assert.equal(results[0].similarity, 1);
    assert.equal(results[1].similarity, null);
  });

  test('repeats are medianed and every run is kept', async () => {
    const walls = [300, 100, 200];
    let i = 0;
    let clock = 0;
    const deps = {
      now: () => clock,
      applyCombo: async () => {},
      loadModel: async () => { clock += 50; },
      transcribe: async () => { clock += walls[i++]; return { text: '', metrics: null, audioSec: 10 }; },
    };
    const results = await runBenchmarkPlan([planBenchmark({})[0]], { ...deps, repeats: 3 });
    assert.deepEqual(results[0].wallMsRuns, [300, 100, 200]);
    assert.equal(results[0].wallMs, 200);
    assert.equal(results[0].repeats, 3);
  });

  test('a load failure becomes a failed row and does not stop the run', async () => {
    const { deps } = fakeDeps({
      loadModel: async (c) => { if (c.quant === 'fp32') throw new Error('boom'); },
    });
    // The whole plan, not just the light rows: with one int8 row and one fp32
    // row, failing fp32 still leaves a successful row to prove the run went on.
    const plan = planBenchmark({});
    const results = await runBenchmarkPlan(plan, deps);
    const bad = results.find(r => r.quant === 'fp32');
    assert.equal(bad.status, 'failed');
    assert.equal(bad.stage, 'load');
    assert.equal(bad.error.message, 'boom');
    assert.ok(results.some(r => r.status === 'ok'), 'other combinations must still run');
  });

  test('QuantUnavailableError is reported as unavailable, not as a failure', async () => {
    const { deps } = fakeDeps({
      loadModel: async () => {
        const e = new Error('repo ships no fp32 shards');
        e.name = 'QuantUnavailableError';
        throw e;
      },
    });
    const results = await runBenchmarkPlan([planBenchmark({})[0]], deps);
    assert.equal(results[0].status, 'unavailable');
    assert.equal(results[0].stage, 'load');
  });

  test('a transcription failure is recorded per combination', async () => {
    const { deps } = fakeDeps({ transcribe: async () => { throw new Error('session gone'); } });
    const results = await runBenchmarkPlan([planBenchmark({})[0]], deps);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].stage, 'transcribe');
    assert.equal(results[0].error.message, 'session gone');
  });

  test('cancellation stops before the next combination and marks the rest', async () => {
    let cancelled = false;
    const { deps, calls } = fakeDeps();
    const load = deps.loadModel;
    // Cancel while the first model is loading, the way the Cancel button does.
    deps.loadModel = async (c) => { await load(c); cancelled = true; };
    deps.shouldCancel = () => cancelled;
    const plan = planBenchmark({}).filter(c => !c.heavy);
    const results = await runBenchmarkPlan(plan, deps);
    assert.equal(calls.loaded.length, 1, 'no further model is loaded after a cancel');
    assert.ok(results.some(r => r.status === 'cancelled'));
    assert.equal(results.filter(r => r.status === 'ok').length, 0);
  });

  test('the driver never throws, whatever the callbacks do', async () => {
    const results = await runBenchmarkPlan(planBenchmark({}).filter(c => !c.heavy), {
      applyCombo: async () => { throw new Error('state stuck'); },
      loadModel: async () => {},
      transcribe: async () => ({ text: '' }),
    });
    assert.ok(results.every(r => r.status === 'failed'));
  });
});

describe('anonymizeEnvironment', () => {
  const env = {
    browser: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/148.0.7204.100 Safari/537.36',
      languages: ['fr-FR', 'fr'],
      timeZone: 'Europe/Paris',
      webdriver: false,
      uaData: {
        brands: [{ brand: 'Chromium', version: '148.0.7204.100' }],
        platform: 'Linux',
        platformVersion: '6.8.0',
        architecture: 'x86',
        bitness: '64',
        mobile: false,
        model: 'Pixel 9 Pro',
        fullVersionList: [{ brand: 'Chromium', version: '148.0.7204.100' }],
      },
    },
    hardware: {
      hardwareConcurrency: 12,
      deviceMemoryGB: 8,
      screen: { width: 3840, height: 2160, devicePixelRatio: 1.5 },
      jsHeap: { limitMB: 4096, usedMB: 512 },
    },
    capabilities: { wasm: { simd: true, threads: true }, webgpu: true },
    webgpu: {
      adapter: { vendor: 'nvidia', architecture: 'ampere' },
      features: ['depth-clip-control'],
      limits: { maxBufferSize: 2147483648 },
      adapters: [
        { powerPreference: ['default', 'high-performance'], info: { vendor: 'nvidia' }, features: [], limits: {}, isFallbackAdapter: false },
        { powerPreference: ['low-power'], info: { vendor: 'intel' }, features: [], limits: {}, isFallbackAdapter: false },
      ],
    },
    gpuRenderers: [
      { powerPreference: ['high-performance'], vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, RTX 3090 Ti)', unmasked: true },
      { powerPreference: ['low-power'], vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, UHD Graphics)', unmasked: true },
    ],
    ort: { versions: { web: '1.27.0' }, wasm: { numThreads: 4, simd: true } },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
    storage: { quotaMB: 123456, usageMB: 4321 },
    audioInputs: 3,
  };

  test('keeps the performance-relevant fields', () => {
    const a = anonymizeEnvironment(env);
    assert.equal(a.hardware.hardwareConcurrency, 12);
    assert.equal(a.hardware.deviceMemoryGB, 8);
    assert.equal(a.hardware.jsHeapLimitMB, 4096);
    assert.deepEqual(a.browser.brands, [{ brand: 'Chromium', version: '148' }]);
    assert.equal(a.browser.platform, 'Linux');
    assert.equal(a.browser.platformVersionMajor, '6');
    assert.equal(a.browser.architecture, 'x86');
    assert.deepEqual(a.capabilities, env.capabilities);
    assert.equal(a.webgpu.adapter.vendor, 'nvidia');
    assert.equal(a.webgpu.limits.maxBufferSize, 2147483648);
    // Both GPUs of a hybrid machine, named: a backend timing nobody can
    // attribute to a chip answers nothing.
    assert.deepEqual(a.webgpu.adapters.map((x) => x.info.vendor), ['nvidia', 'intel']);
    assert.deepEqual(a.gpuRenderers.map((x) => x.renderer),
      ['ANGLE (NVIDIA, RTX 3090 Ti)', 'ANGLE (Intel, UHD Graphics)']);
    assert.equal(a.ort.wasm.numThreads, 4);
    assert.equal(a.connection.effectiveType, '4g');
  });

  test('drops the fingerprinting surface', () => {
    const a = anonymizeEnvironment(env);
    const flat = JSON.stringify(a);
    for (const leak of ['Mozilla/5.0', 'Europe/Paris', 'fr-FR', 'Pixel 9 Pro', '3840', '2160', '123456', 'fullVersionList']) {
      assert.ok(!flat.includes(leak), `anonymized report must not carry ${leak}`);
    }
    assert.equal(a.browser.userAgent, undefined);
    assert.equal(a.hardware.screen, undefined);
    assert.equal(a.storage, undefined);
    assert.equal(a.audioInputs, undefined);
    assert.equal(a.connection.rtt, undefined);
    assert.equal(a.browser.uaData, undefined);
  });

  test('falls back to a coarse engine hint when UA-Client-Hints is missing', () => {
    const ff = anonymizeEnvironment({
      browser: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0' },
    });
    assert.equal(ff.browser.engineHint, 'Firefox 141');
    assert.equal(ff.browser.brands, null);
    // With UA-Client-Hints present the hint is redundant and stays out.
    assert.equal(anonymizeEnvironment(env).browser.engineHint, null);
  });

  test('engineHintFromUserAgent never returns a full user agent', () => {
    assert.equal(engineHintFromUserAgent('Mozilla/5.0 Version/18.2 Safari/605.1.15'), 'Safari 18');
    assert.equal(engineHintFromUserAgent('weird-client/1'), 'unknown');
    assert.equal(engineHintFromUserAgent(''), null);
  });

  test('survives an empty or partial probe', () => {
    const a = anonymizeEnvironment({});
    assert.equal(a.webgpu, null);
    assert.equal(a.gpuRenderers, null);
    assert.equal(a.hardware.hardwareConcurrency, null);
    assert.equal(a.connection, null);
  });
});

describe('buildBenchmarkReport', () => {
  test('stamps the format and carries only anonymized environment data', () => {
    const report = buildBenchmarkReport({
      reportId: 'abc',
      generatedAt: '2026-08-13T00:00:00.000Z',
      app: { version: '9.9.9' },
      settings: { cpuThreads: 4 },
      clip: { durationSec: BENCHMARK_CLIP.durationSec },
      results: [{ id: 'wasm:int8', status: 'ok' }],
      env: { browser: { userAgent: 'Mozilla/5.0 secret', timeZone: 'Europe/Paris' } },
    });
    assert.equal(report.format, 'parakeetweb-benchmark-report/1');
    assert.equal(report.reportId, 'abc');
    const text = formatBenchmarkReport(report);
    assert.ok(!text.includes('Mozilla/5.0'));
    assert.ok(!text.includes('Europe/Paris'));
    assert.equal(JSON.parse(text).results[0].id, 'wasm:int8');
    // Key order is fixed so two reports diff cleanly.
    assert.deepEqual(Object.keys(report), [
      'format', 'reportId', 'generatedAt', 'app', 'settings', 'clip', 'environment', 'results',
    ]);
  });
});
