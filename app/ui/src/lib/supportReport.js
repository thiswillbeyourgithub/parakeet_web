// Support-report builder for the sidebar Debug section: one machine-oriented
// JSON blob the user can copy and paste back to the maintainer, so "please
// support my hardware" reports arrive with the exact software/hardware/backend
// context instead of a screenshot and a guess. Two pieces, kept separate so
// they are unit-testable in Node:
//   - collectEnvironment(nav, win, glob): probes ONLY guarded browser APIs.
//     Absent APIs report null (never throw), so the same code runs in Node,
//     headless Chromium, and every real browser.
//   - buildSupportReport({...}): assembles the final stable pretty-printed
//     JSON text from the collected environment plus the app/settings/model
//     state App.jsx passes in.
// Written with the help of Claude Code.

// WebAssembly feature probes: tiny pre-compiled modules using one instruction
// from each feature (byte sequences from GoogleChromeLabs/wasm-feature-detect,
// MIT). WebAssembly.validate returns false on engines lacking the feature and
// never throws on unknown opcodes, so this is a safe capability check. The
// relaxedSimd probe matters most here: it decides whether a Relaxed-SIMD ORT
// WASM build (PERF_PLAN #5) could run on the reporting machine.
const WASM_PROBES = {
  simd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11],
  relaxedSimd: [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11],
  threads: [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11],
};

// Standalone Relaxed-SIMD capability check, reused by the ORT-variant
// selection (lib/ortVariant.js): a Relaxed-SIMD ORT build may only be engaged
// when this returns true (ORT enforces the same condition at init with its own
// probe and throws; this pre-gate keeps that throw from ever firing).
export function wasmRelaxedSimdSupported() {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array(WASM_PROBES.relaxedSimd));
  } catch {
    return false;
  }
}

// Walk an object's readable attributes (own or inherited, which is how Web IDL
// exposes GPUAdapterInfo/GPUSupportedLimits: enumerable getters on the
// prototype) and keep primitive values. BigInt is folded to Number so the
// result always survives JSON.stringify.
function idlAttrs(obj) {
  const out = {};
  try {
    // eslint-disable-next-line guard-for-in
    for (const k in obj) {
      let v;
      try { v = obj[k]; } catch { continue; }
      if (typeof v === 'bigint') out[k] = Number(v);
      else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    }
  } catch { /* leave what we have */ }
  return out;
}

function roundMB(bytes) {
  return typeof bytes === 'number' && Number.isFinite(bytes) ? Math.round(bytes / 1e6) : null;
}

// Probe the runtime. `nav`/`win` are injectable for tests; `glob` is where the
// live ORT env is looked up (backend.js initOrt sets globalThis.ort after the
// first session build, so this section is null until a model has loaded and
// then shows the thread/SIMD flags ORT actually ran with).
export async function collectEnvironment(
  nav = typeof navigator !== 'undefined' ? navigator : undefined,
  win = typeof window !== 'undefined' ? window : undefined,
  glob = typeof globalThis !== 'undefined' ? globalThis : undefined,
) {
  const env = {};

  env.browser = {
    userAgent: nav?.userAgent ?? null,
    uaData: null,
    webdriver: nav?.webdriver ?? null,
    language: nav?.language ?? null,
    languages: nav?.languages ? [...nav.languages] : null,
    timeZone: (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
    })(),
    online: nav?.onLine ?? null,
    cookieEnabled: nav?.cookieEnabled ?? null,
  };
  if (nav?.userAgentData) {
    const uad = nav.userAgentData;
    env.browser.uaData = {
      brands: uad.brands ?? null,
      mobile: uad.mobile ?? null,
      platform: uad.platform ?? null,
    };
    try {
      const high = await uad.getHighEntropyValues(
        ['architecture', 'bitness', 'platformVersion', 'model', 'fullVersionList'],
      );
      Object.assign(env.browser.uaData, high);
    } catch { /* denied or unsupported: keep the low-entropy part */ }
  }

  env.hardware = {
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    deviceMemoryGB: nav?.deviceMemory ?? null,
    maxTouchPoints: nav?.maxTouchPoints ?? null,
    screen: win?.screen ? {
      width: win.screen.width ?? null,
      height: win.screen.height ?? null,
      colorDepth: win.screen.colorDepth ?? null,
      devicePixelRatio: win.devicePixelRatio ?? null,
    } : null,
    jsHeap: win?.performance?.memory ? {
      limitMB: roundMB(win.performance.memory.jsHeapSizeLimit),
      usedMB: roundMB(win.performance.memory.usedJSHeapSize),
    } : null,
  };

  const wasm = {};
  for (const [k, bytes] of Object.entries(WASM_PROBES)) {
    try {
      wasm[k] = typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array(bytes));
    } catch { wasm[k] = false; }
  }
  env.capabilities = {
    secureContext: win?.isSecureContext ?? null,
    crossOriginIsolated: win ? (win.crossOriginIsolated ?? null)
      : (typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    wasm,
    webgpu: !!nav?.gpu,
    audioWorklet: !!(win && win.AudioWorkletNode),
    mediaDevices: !!nav?.mediaDevices,
    wakeLock: !!nav?.wakeLock,
    clipboard: !!nav?.clipboard,
    indexedDB: !!(win ? win.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null)),
  };

  // WebGPU adapter detail: this is the payload that makes "support my GPU"
  // reports actionable (vendor/architecture plus the exact feature/limit set
  // the backend gating logic keys off, e.g. shader-f16 and maxBufferSize).
  env.webgpu = null;
  if (nav?.gpu?.requestAdapter) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        env.webgpu = {
          adapter: adapter.info ? idlAttrs(adapter.info) : null,
          features: adapter.features ? [...adapter.features].sort() : [],
          limits: adapter.limits ? idlAttrs(adapter.limits) : null,
        };
      }
    } catch { env.webgpu = null; }
  }

  const conn = nav?.connection;
  env.connection = conn ? {
    effectiveType: conn.effectiveType ?? null,
    downlinkMbit: conn.downlink ?? null,
    rttMs: conn.rtt ?? null,
    saveData: conn.saveData ?? null,
  } : null;

  env.storage = null;
  try {
    if (nav?.storage?.estimate) {
      const est = await nav.storage.estimate();
      env.storage = {
        quotaMB: roundMB(est.quota),
        usageMB: roundMB(est.usage),
        persisted: nav.storage.persisted ? await nav.storage.persisted() : null,
      };
    }
  } catch { env.storage = null; }

  // Device COUNT only: enumerateDevices without mic permission returns
  // label-less entries, and the count alone is what mic-troubleshooting needs.
  env.audioInputs = null;
  try {
    if (nav?.mediaDevices?.enumerateDevices) {
      const devs = await nav.mediaDevices.enumerateDevices();
      env.audioInputs = devs.filter((d) => d.kind === 'audioinput').length;
    }
  } catch { env.audioInputs = null; }

  env.ort = null;
  try {
    const ort = glob?.ort;
    if (ort?.env) {
      env.ort = {
        versions: ort.env.versions ? { ...ort.env.versions } : null,
        wasm: {
          numThreads: ort.env.wasm?.numThreads ?? null,
          simd: ort.env.wasm?.simd ?? null,
          proxy: ort.env.wasm?.proxy ?? null,
        },
      };
    }
  } catch { env.ort = null; }

  return env;
}

// Assemble the final report text. Key order is fixed (app first, raw probes
// last) so two reports diff cleanly; BigInt values are folded to Number so
// stringify can never throw on exotic probe results.
export function buildSupportReport({ generatedAt = null, app = {}, settings = {}, model = {}, env = {} } = {}) {
  const report = {
    format: 'parakeetweb-support-report/1',
    generatedAt,
    app,
    settings,
    model,
    browser: env.browser ?? null,
    hardware: env.hardware ?? null,
    capabilities: env.capabilities ?? null,
    webgpu: env.webgpu ?? null,
    ort: env.ort ?? null,
    connection: env.connection ?? null,
    storage: env.storage ?? null,
    audioInputs: env.audioInputs ?? null,
  };
  return JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);
}
