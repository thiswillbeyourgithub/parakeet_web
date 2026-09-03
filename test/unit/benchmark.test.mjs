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
  coarseTimestamp,
  engineHintFromUserAgent,
  estimatedDownloadMB,
  formatBenchmarkReport,
  median,
  normalizeForCompare,
  OPT_IN_QUANTS,
  planBenchmark,
  runBenchmarkPlan,
  tilePcm,
  transcriptSimilarity,
} from '../../app/ui/src/lib/benchmark.js';

describe('planBenchmark', () => {
  test('a WASM-only device gets the four WASM rows and no GPU row', () => {
    const plan = planBenchmark({ webgpuAvailable: false });
    // The default selection (int8) sorts last so it stays the cached model.
    assert.deepEqual(plan.map(r => r.id), ['wasm:int8lite', 'wasm:w4a8', 'wasm:fp32', 'wasm:int8']);
    assert.ok(plan.every(r => r.backend === 'wasm'));
  });

  test('every opt-in encoder is offered on WASM but never pre-selected', () => {
    const plan = planBenchmark({ webgpuAvailable: true });
    // One rule pinned for the whole set rather than one test per precision: each
    // is an ALTERNATIVE to a precision the visitor already has, so each sits
    // under the heavy threshold and each stays unchecked. Pre-checking any of
    // them would silently turn a free default run into a several-hundred-MB one.
    for (const quant of OPT_IN_QUANTS) {
      const row = plan.find(r => r.id === `wasm:${quant}`);
      assert.ok(row, `${quant} must be offered on WASM`);
      assert.equal(row.heavy, false);
      assert.equal(row.defaultSelected, false);
      // Lighter than the default int8, which is the whole reason each exists.
      assert.ok(QUANT_DOWNLOAD_MB[quant] < QUANT_DOWNLOAD_MB.int8);
    }
    // No GPU row for int8lite: the GPU EP has no int8 encoder kernel, lite or
    // not. w4a8 is the opt-in that DOES reach the GPU, pinned below.
    assert.equal(plan.some(r => r.backend.startsWith('webgpu') && r.quant === 'int8lite'), false);
  });

  test('w4a8 gets a row on both backends, opt-in on each', () => {
    const plan = planBenchmark({ webgpuAvailable: true });
    // The one precision offered on both: its int4 weights load through
    // MatMulNBits, which the GPU EP does have a kernel for, unlike int8.
    assert.ok(plan.find(r => r.id === 'wasm:w4a8'), 'w4a8 must be offered on WASM');
    const gpu = plan.find(r => r.id === 'webgpu-hybrid:w4a8');
    assert.ok(gpu, 'w4a8 must be offered on WebGPU');
    // Opt-in on the GPU row too, or a WebGPU visitor's default run would pull
    // 610 MB they never asked for.
    assert.equal(gpu.defaultSelected, false);
    // The smallest download of the lot, which is the whole reason it exists.
    assert.equal(QUANT_DOWNLOAD_MB.w4a8, 610);
    assert.ok(Object.values(QUANT_DOWNLOAD_MB).every(mb => mb >= QUANT_DOWNLOAD_MB.w4a8));
  });

  test('a visitor already on WebGPU w4a8 gets that row checked and sorted last', () => {
    const plan = planBenchmark({ webgpuAvailable: true, currentBackend: 'webgpu-hybrid', currentWebgpuQuant: 'w4a8' });
    const own = plan[plan.length - 1];
    assert.equal(own.id, 'webgpu-hybrid:w4a8');
    assert.equal(plan.filter(r => r.isCurrent).length, 1);
    // isCurrent beats the opt-in rule on the GPU exactly as it does on WASM:
    // their model is already cached, so selecting it costs nothing.
    assert.equal(own.defaultSelected, true);
  });

  // The regression this pins: adding a row must not change what a default run
  // costs. A typical int8 visitor's default selection is exactly their own
  // cached row, so pressing Run without touching a checkbox downloads nothing.
  test('adding the opt-in rows left the default selection a single free row', () => {
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
    // fp32 and w4a8 are the precisions the GPU EP has an encoder kernel for, so
    // they are the WebGPU rows (the model repo's fp16 build was withdrawn
    // 2026-08-23, and plain int8 has no GPU kernel at all).
    assert.deepEqual(
      on.filter(r => r.backend === 'webgpu-hybrid').map(r => r.quant),
      ['fp32', 'w4a8'],
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
    assert.equal(all, QUANT_DOWNLOAD_MB.int8lite + QUANT_DOWNLOAD_MB.int8
      + QUANT_DOWNLOAD_MB.w4a8 + QUANT_DOWNLOAD_MB.fp32);
    assert.equal(estimatedDownloadMB(plan, ['wasm:int8']), all - QUANT_DOWNLOAD_MB.int8);
    assert.equal(estimatedDownloadMB(plan, ['wasm:int8lite']), all - QUANT_DOWNLOAD_MB.int8lite);
    assert.equal(estimatedDownloadMB(plan, ['wasm:w4a8']), all - QUANT_DOWNLOAD_MB.w4a8);
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
    // Each profile gets its own untimed warm-up run before its timed one: the
    // long profile's chunked shapes are compiled separately from the short
    // profile's, so warming one does not warm the other.
    assert.deepEqual(calls.transcribed, [
      `${plan[0].id}/short`, `${plan[0].id}/short`,
      `${plan[0].id}/long`, `${plan[0].id}/long`,
    ]);
    assert.equal(results[0].similarity, 1);
    assert.equal(results[1].similarity, null);
  });

  test('repeats are medianed and every run is kept', async () => {
    // First wall is the warm-up's and must not reach the report: a cold run is
    // exactly what the warm-up exists to keep out of the median.
    const walls = [9000, 300, 100, 200];
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
    assert.equal(results[0].warmup, true);
  });

  test('a warm-up failure is swallowed and the timed runs still decide the row', async () => {
    let n = 0;
    const { deps } = fakeDeps({
      transcribe: async () => {
        n += 1;
        if (n === 1) throw new Error('cold-start hiccup');
        return { text: BENCHMARK_CLIP.expectedText, metrics: null, audioSec: 11 };
      },
    });
    const results = await runBenchmarkPlan([planBenchmark({})[0]], deps);
    assert.equal(results[0].status, 'ok', 'a warm-up throw must not fail the row');
    assert.equal(results[0].repeats, 1);
  });

  test('warmup:false runs only the timed runs, and says so in the row', async () => {
    const { deps, calls } = fakeDeps();
    const plan = [planBenchmark({})[0]];
    const results = await runBenchmarkPlan(plan, { ...deps, warmup: false });
    assert.deepEqual(calls.transcribed, [`${plan[0].id}/short`]);
    assert.equal(results[0].warmup, false);
  });

  test('load transfer is reported as MB and a warm/cold flag', async () => {
    const { deps } = fakeDeps({ loadModel: async () => ({ downloadedBytes: 2_350_000_000 }) });
    const cold = await runBenchmarkPlan([planBenchmark({})[0]], deps);
    assert.equal(cold[0].loadDownloadMB, 2350);
    assert.equal(cold[0].loadCached, false);

    const { deps: warmDeps } = fakeDeps({ loadModel: async () => ({ downloadedBytes: 0 }) });
    const warm = await runBenchmarkPlan([planBenchmark({})[0]], warmDeps);
    assert.equal(warm[0].loadDownloadMB, 0);
    assert.equal(warm[0].loadCached, true, 'a load that pulled no bytes came from the cache');
  });

  test('a driver that reports no transfer says unknown, never a confident "cached"', async () => {
    const { deps } = fakeDeps();
    const results = await runBenchmarkPlan([planBenchmark({})[0]], deps);
    assert.equal(results[0].loadDownloadMB, null);
    assert.equal(results[0].loadCached, null);
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
    assert.equal(report.app.version, '9.9.9');
    const text = formatBenchmarkReport(report);
    assert.ok(!text.includes('Mozilla/5.0'));
    assert.ok(!text.includes('Europe/Paris'));
    assert.equal(JSON.parse(text).results[0].id, 'wasm:int8');
    // Key order is fixed so two reports diff cleanly.
    assert.deepEqual(Object.keys(report), [
      'format', 'reportId', 'generatedAt', 'app', 'settings', 'clip', 'environment', 'results',
    ]);
  });

  test('coarsens generatedAt to the hour, so the report cannot time the visitor', () => {
    const report = buildBenchmarkReport({
      generatedAt: '2026-09-03T14:54:54.621Z',
      env: {},
    });
    assert.equal(report.generatedAt, '2026-09-03T14:00:00.000Z');
    // The precise time must not survive anywhere else in the serialised report.
    assert.ok(!formatBenchmarkReport(report).includes('54:54'));
  });

  test('carries the build commit, since a version alone cannot identify a build', () => {
    const report = buildBenchmarkReport({ app: { version: '10.0.4', commit: 'abc1234567' }, env: {} });
    assert.equal(report.app.commit, 'abc1234567');
  });
});

describe('coarseTimestamp', () => {
  test('rounds down to the top of the UTC hour', () => {
    assert.equal(coarseTimestamp('2026-09-03T14:54:54.621Z'), '2026-09-03T14:00:00.000Z');
    assert.equal(coarseTimestamp('2026-09-03T00:00:00.000Z'), '2026-09-03T00:00:00.000Z');
    assert.equal(coarseTimestamp('2026-09-03T23:59:59.999Z'), '2026-09-03T23:00:00.000Z');
  });

  test('rounds in UTC, not in the local zone, so the offset leaks nothing', () => {
    // A local-time string with an offset still lands on a UTC hour boundary.
    assert.equal(coarseTimestamp('2026-09-03T16:54:54.621+02:00'), '2026-09-03T14:00:00.000Z');
  });

  test('null and unparseable values become null rather than a guessed time', () => {
    assert.equal(coarseTimestamp(null), null);
    assert.equal(coarseTimestamp(undefined), null);
    assert.equal(coarseTimestamp('not a date'), null);
  });
});
