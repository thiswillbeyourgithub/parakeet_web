// Unit tests for the sidebar Debug-section support report
// (app/ui/src/lib/supportReport.js): the guarded environment collector must
// never throw, in bare Node (every browser API absent) as well as against a
// stubbed browser, and the builder must emit stable, parseable JSON even when
// probes return exotic values (BigInt). The probe byte-modules' TRUTH on a
// real engine (simd/relaxedSimd/threads all true in Chromium) is asserted by
// test/e2e/support-report.spec.js; here we only require booleans.
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEnvironment, buildSupportReport } from '../../app/ui/src/lib/supportReport.js';

test('collectEnvironment survives bare Node (no navigator/window)', async () => {
  // null (not undefined) is the "absent" stand-in: undefined would trigger the
  // default parameters, and Node 22+ has a global navigator of its own.
  const env = await collectEnvironment(null, null, {});
  assert.equal(env.browser.userAgent, null);
  assert.equal(env.browser.uaData, null);
  assert.equal(env.hardware.hardwareConcurrency, null);
  assert.equal(env.hardware.screen, null);
  assert.equal(typeof env.capabilities.wasm.simd, 'boolean');
  assert.equal(typeof env.capabilities.wasm.relaxedSimd, 'boolean');
  assert.equal(typeof env.capabilities.wasm.threads, 'boolean');
  // Node has had SIMD-in-WASM for years; if this reads false the probe bytes
  // are broken, not the engine.
  assert.equal(env.capabilities.wasm.simd, true);
  assert.equal(env.capabilities.sharedArrayBuffer, true);
  assert.equal(env.webgpu, null);
  assert.equal(env.connection, null);
  assert.equal(env.storage, null);
  assert.equal(env.audioInputs, null);
  assert.equal(env.ort, null);
});

test('collectEnvironment reads a stubbed browser end to end', async () => {
  const nav = {
    userAgent: 'TestBrowser/1.0',
    webdriver: false,
    language: 'fr-FR',
    languages: ['fr-FR', 'en'],
    onLine: true,
    cookieEnabled: true,
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    userAgentData: {
      brands: [{ brand: 'TestBrowser', version: '1' }],
      mobile: false,
      platform: 'Linux',
      getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64' }),
    },
    gpu: {
      requestAdapter: async () => ({
        // Plain objects stand in for the IDL interfaces; idlAttrs must pick up
        // primitives (own props here, prototype getters in a real browser) and
        // fold BigInt limits to Number.
        info: { vendor: 'testvendor', architecture: 'test-arch', device: '', description: 'Test GPU' },
        features: new Set(['shader-f16', 'bgra8unorm-storage']),
        limits: { maxBufferSize: 2147483648n, maxComputeInvocationsPerWorkgroup: 256 },
      }),
    },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
    storage: {
      estimate: async () => ({ quota: 2_000_000_000, usage: 150_000_000 }),
      persisted: async () => true,
    },
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audioinput' }, { kind: 'audioinput' }, { kind: 'videoinput' },
      ],
    },
    wakeLock: {},
    clipboard: {},
  };
  const win = {
    isSecureContext: true,
    crossOriginIsolated: true,
    devicePixelRatio: 2,
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    performance: { memory: { jsHeapSizeLimit: 4_294_705_152, usedJSHeapSize: 123_456_789 } },
    AudioWorkletNode: function () {},
    indexedDB: {},
  };
  const glob = { ort: { env: { versions: { common: '1.27.0', web: '1.27.0' }, wasm: { numThreads: 4, simd: true, proxy: false } } } };

  const env = await collectEnvironment(nav, win, glob);
  assert.equal(env.browser.userAgent, 'TestBrowser/1.0');
  assert.equal(env.browser.uaData.platform, 'Linux');
  assert.equal(env.browser.uaData.architecture, 'x86');
  assert.equal(env.hardware.hardwareConcurrency, 12);
  assert.equal(env.hardware.deviceMemoryGB, 8);
  assert.equal(env.hardware.screen.devicePixelRatio, 2);
  assert.equal(env.hardware.jsHeap.limitMB, 4295);
  assert.equal(env.capabilities.secureContext, true);
  assert.equal(env.capabilities.crossOriginIsolated, true);
  assert.equal(env.capabilities.webgpu, true);
  assert.equal(env.capabilities.audioWorklet, true);
  assert.deepEqual(env.webgpu.features, ['bgra8unorm-storage', 'shader-f16']);
  assert.equal(env.webgpu.adapter.vendor, 'testvendor');
  assert.equal(env.webgpu.limits.maxBufferSize, 2147483648);
  assert.equal(typeof env.webgpu.limits.maxBufferSize, 'number');
  assert.equal(env.connection.effectiveType, '4g');
  assert.deepEqual(env.storage, { quotaMB: 2000, usageMB: 150, persisted: true });
  assert.equal(env.audioInputs, 2);
  assert.equal(env.ort.versions.common, '1.27.0');
  assert.equal(env.ort.wasm.numThreads, 4);
});

test('collectEnvironment keeps low-entropy uaData when high-entropy is denied', async () => {
  const nav = {
    userAgentData: {
      brands: [{ brand: 'B', version: '2' }],
      mobile: true,
      platform: 'Android',
      getHighEntropyValues: async () => { throw new Error('denied'); },
    },
  };
  const env = await collectEnvironment(nav, null, {});
  assert.equal(env.browser.uaData.platform, 'Android');
  assert.equal(env.browser.uaData.mobile, true);
  assert.equal(env.browser.uaData.architecture, undefined);
});

test('collectEnvironment survives probes that throw', async () => {
  const nav = {
    gpu: { requestAdapter: async () => { throw new Error('gpu boom'); } },
    storage: { estimate: async () => { throw new Error('storage boom'); } },
    mediaDevices: { enumerateDevices: async () => { throw new Error('media boom'); } },
  };
  const env = await collectEnvironment(nav, null, {});
  assert.equal(env.webgpu, null);
  assert.equal(env.storage, null);
  assert.equal(env.audioInputs, null);
});

test('buildSupportReport emits stable parseable JSON and folds BigInt', () => {
  const text = buildSupportReport({
    generatedAt: '2026-08-06T12:00:00.000Z',
    app: { name: 'parakeet_web', version: '9.9.9' },
    settings: { backend: 'wasm', beamWidth: 5 },
    model: { loaded: false, deep: { big: 9007199254740993n } },
    env: {
      browser: { userAgent: 'X' },
      capabilities: { wasm: { simd: true } },
      webgpu: null,
    },
  });
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'parakeetweb-support-report/1');
  assert.equal(parsed.generatedAt, '2026-08-06T12:00:00.000Z');
  assert.equal(parsed.app.version, '9.9.9');
  assert.equal(parsed.settings.beamWidth, 5);
  assert.equal(typeof parsed.model.deep.big, 'number');
  assert.equal(parsed.browser.userAgent, 'X');
  // Fixed top-level key order so two reports diff cleanly.
  assert.deepEqual(Object.keys(parsed), [
    'format', 'generatedAt', 'app', 'settings', 'model', 'browser', 'hardware',
    'capabilities', 'webgpu', 'ort', 'connection', 'storage', 'audioInputs',
  ]);
  // Missing env sections come out as explicit nulls, never undefined holes.
  assert.equal(parsed.hardware, null);
  assert.equal(parsed.ort, null);
});

test('buildSupportReport tolerates a completely empty call', () => {
  const parsed = JSON.parse(buildSupportReport());
  assert.equal(parsed.format, 'parakeetweb-support-report/1');
  assert.equal(parsed.generatedAt, null);
  assert.deepEqual(parsed.app, {});
});
