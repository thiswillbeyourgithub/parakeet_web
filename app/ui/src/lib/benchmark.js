// Self-service benchmark harness behind the sidebar "Benchmark" section.
//
// Goal: let any visitor produce, in one click, a comparable measurement of
// every backend/precision combination their machine can actually run, on a
// fixed clip that ships with the app, and hand the maintainer a report that
// says where the time goes on hardware the maintainer does not own.
//
// Everything here is pure (no DOM, no ORT, no fetch), so the whole driver is
// unit-testable in Node with fake callbacks. App.jsx owns the wiring:
//   - applyCombo: push backend/precision into React state and wait for it
//   - loadModel / transcribe: the app's OWN loading and transcription paths,
//     never a private copy, so the numbers describe what a user really gets
// Written with the help of Claude Code.

// The benchmark clip ships in app/ui/public/benchmark/. It is the JFK
// inaugural-address excerpt (a US Government work, public domain), the same
// public-domain source as test/fixtures/jfk.mp3. Short on purpose: the point
// is a comparable number per backend, not a WER measurement, and every extra
// second is paid by the visitor on every combination.
export const BENCHMARK_CLIP = {
  url: 'benchmark/jfk.mp3',
  durationSec: 11.088,
  expectedText:
    'And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.',
  source: 'John F. Kennedy, inaugural address (US Government work, public domain)',
};

// The "long" profile tiles the clip until it passes this many seconds so the
// chunked path (seam stitching, encode pool, decode pipeline) is exercised
// too. 90 s clears the 60 s default window with room to spare; a machine
// configured with a longer window simply reports a single-chunk long run,
// which the report makes visible through the recorded chunkDurationSec.
export const LONG_PROFILE_TARGET_SEC = 90;

// Approximate download per encoder precision, in MB, used ONLY to warn about
// bandwidth before a run (the real sizes come from the repo being served).
// Measured on the shipped Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx
// weights; the decoder (~18 MB) and preprocessor (~1 MB) are folded in.
export const QUANT_DOWNLOAD_MB = {
  int8: 860,
  fp16: 1200,
  fp32: 2350,
};

// Above this estimated download a combination is treated as "heavy" and left
// UNCHECKED by default: fp32 costs 2.3 GB, which nobody should spend by
// reflex on a benchmark they can run without it.
export const HEAVY_DOWNLOAD_MB = 1500;

function comboId(backend, quant) {
  return `${backend}:${quant}`;
}

// Build the list of backend/precision combinations worth attempting on this
// device. Availability of a precision INSIDE the served repo is deliberately
// not probed here: hub.js already throws QuantUnavailableError when the repo
// ships no such file, and the driver records that as a first-class
// "unavailable" outcome, which is itself useful information in the report.
//
// The visitor's currently selected combination is sorted LAST so the run ends
// on the model they already had, which is the one the app keeps cached (the
// model cache holds a single model at a time, so any other ordering forces an
// extra re-download once the benchmark is over).
export function planBenchmark({
  webgpuAvailable = false,
  webgpuDisabled = false,
  shaderF16 = null,
  currentBackend = 'wasm',
  currentWasmQuant = 'int8',
  currentWebgpuQuant = 'fp16',
} = {}) {
  const combos = [
    { backend: 'wasm', quant: 'int8' },
    { backend: 'wasm', quant: 'fp32' },
  ];
  if (webgpuAvailable && !webgpuDisabled) {
    // fp16 needs the adapter's shader-f16 feature; without it ORT builds a
    // session whose f16 shaders never compile (empty transcript), so drop the
    // row entirely rather than report a bogus failure. null means "not probed
    // yet", which the app treats as supported.
    if (shaderF16 !== false) combos.push({ backend: 'webgpu-hybrid', quant: 'fp16' });
    combos.push({ backend: 'webgpu-hybrid', quant: 'fp32' });
  }

  const currentQuant = currentBackend.startsWith('webgpu') ? currentWebgpuQuant : currentWasmQuant;
  const currentId = comboId(currentBackend, currentQuant);

  const rows = combos.map((c) => {
    const downloadMB = QUANT_DOWNLOAD_MB[c.quant] ?? null;
    const heavy = downloadMB != null && downloadMB > HEAVY_DOWNLOAD_MB;
    const isCurrent = comboId(c.backend, c.quant) === currentId;
    return {
      id: comboId(c.backend, c.quant),
      backend: c.backend,
      quant: c.quant,
      downloadMB,
      heavy,
      isCurrent,
      // Heavy rows stay opt-in even when they are the visitor's own choice;
      // the model is then already cached, so re-selecting it costs nothing.
      defaultSelected: !heavy || isCurrent,
    };
  });

  // Stable order, current combination last.
  return [...rows.filter((r) => !r.isCurrent), ...rows.filter((r) => r.isCurrent)];
}

// Total bytes a selection is expected to pull. `cachedIds` are combinations
// whose weights are already on disk (currently only the visitor's own, which
// the app knows it loaded); they cost nothing.
export function estimatedDownloadMB(combos, cachedIds = []) {
  const cached = new Set(cachedIds);
  return combos.reduce((sum, c) => sum + (cached.has(c.id) ? 0 : (c.downloadMB || 0)), 0);
}

// Repeat `pcm` end to end until it covers at least targetSec. Used for the
// long profile: one small shipped clip becomes a multi-chunk workload that is
// identical on every machine, without shipping (or downloading) minutes of
// audio. The content repeats, which is fine for timing (every chunk does full
// encode + decode work) but makes the long profile useless as an accuracy
// check, so the driver only scores accuracy on the short profile.
export function tilePcm(pcm, targetSec, sampleRate = 16000) {
  const target = Math.ceil(targetSec * sampleRate);
  if (!pcm?.length || target <= pcm.length) return pcm;
  const out = new Float32Array(target);
  for (let off = 0; off < target; off += pcm.length) {
    const n = Math.min(pcm.length, target - off);
    out.set(n === pcm.length ? pcm : pcm.subarray(0, n), off);
  }
  return out;
}

// Comparison-friendly form: lowercase, punctuation stripped, whitespace
// collapsed. Accents are kept (the app transcribes French too).
export function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-level similarity in [0, 1]: 2*LCS / (len(a) + len(b)). 1 means the
// same words in the same order. This is a sanity check ("did this backend
// produce the expected sentence, or silence, or garbage?"), not a WER
// measurement, which lives in scripts/wer-bench.mjs.
export function transcriptSimilarity(expected, actual) {
  const a = normalizeForCompare(expected).split(' ').filter(Boolean);
  const b = normalizeForCompare(actual).split(' ').filter(Boolean);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  // Rolling one-row LCS: the clip is a couple of dozen words, so this is
  // trivially cheap, but the long profile tiles it and the row form keeps
  // memory flat there too.
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}

export function median(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Errors are reported by name + message only. Stacks are dropped: they add
// bundle-path noise to a report meant to stay small and anonymous.
export function describeError(err) {
  if (!err) return { name: 'Error', message: 'unknown' };
  return {
    name: String(err.name || 'Error').slice(0, 64),
    message: String(err.message || err).slice(0, 300),
  };
}

// Keep only finite numbers from a metrics object (every field parakeet.js
// exposes there is a timing or a ratio, so this is an allowlist by type).
function numericFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = +v.toFixed(2);
  }
  return out;
}

function summarizeRuns({ combo, profile, loadMs, runs, audioSec, expectedText }) {
  const ok = runs.filter((r) => !r.error);
  const base = {
    id: combo.id,
    backend: combo.backend,
    quant: combo.quant,
    profile,
    loadMs: loadMs == null ? null : Math.round(loadMs),
    repeats: runs.length,
  };
  if (!ok.length) {
    const first = runs.find((r) => r.error);
    return {
      ...base,
      status: first?.unavailable ? 'unavailable' : 'failed',
      stage: 'transcribe',
      error: first?.error || null,
    };
  }
  const wallMs = median(ok.map((r) => r.wallMs));
  const seconds = audioSec || 0;
  const last = ok[ok.length - 1];
  return {
    ...base,
    status: 'ok',
    audioSec: seconds ? +seconds.toFixed(2) : null,
    wallMs: wallMs == null ? null : Math.round(wallMs),
    // Wall-clock real-time factor: seconds of compute per second of audio.
    // Below 1 means faster than real time. This is the headline number a
    // maintainer compares across machines and backends.
    rtf: seconds > 0 && wallMs != null ? +((wallMs / 1000) / seconds).toFixed(3) : null,
    wallMsRuns: ok.map((r) => Math.round(r.wallMs)),
    metrics: numericFields(last.metrics),
    chunks: typeof last.chunks === 'number' ? last.chunks : null,
    // Accuracy is only meaningful against the shipped clip's known transcript;
    // the tiled long profile repeats it, so score the short profile only.
    similarity: profile === 'short'
      ? +transcriptSimilarity(expectedText, last.text).toFixed(3)
      : null,
    words: normalizeForCompare(last.text).split(' ').filter(Boolean).length,
  };
}

// Run every selected combination: load the model, then transcribe each
// profile `repeats` times. Never throws: a combination that cannot load or
// transcribe becomes a result row with a status, because "fp16 fails on this
// GPU" is exactly the kind of finding the report exists to carry.
//
// deps:
//   applyCombo(combo)            -> Promise, settings are live when it resolves
//   loadModel(combo)             -> Promise, rejects on load failure
//   transcribe({combo, profile}) -> Promise<{text, metrics, audioSec, chunks}>
//   unloadModel()                -> optional Promise, called before each load
//   now(), onProgress(evt), shouldCancel()
export async function runBenchmarkPlan(combos, {
  applyCombo,
  loadModel,
  transcribe,
  profiles = ['short'],
  repeats = 1,
  expectedText = BENCHMARK_CLIP.expectedText,
  now = () => Date.now(),
  onProgress = () => {},
  shouldCancel = () => false,
} = {}) {
  const results = [];
  const totalSteps = combos.length * profiles.length;
  let step = 0;

  for (const combo of combos) {
    if (shouldCancel()) {
      results.push({ id: combo.id, backend: combo.backend, quant: combo.quant, status: 'cancelled' });
      continue;
    }
    onProgress({ phase: 'load', combo, step, totalSteps });

    let loadMs = null;
    try {
      await applyCombo(combo);
      const t0 = now();
      await loadModel(combo);
      loadMs = now() - t0;
    } catch (err) {
      // QuantUnavailableError (hub.js) means the served repo ships no such
      // weights. That is a configuration fact, not a device limitation, so it
      // gets its own status instead of being counted as a failure.
      const unavailable = err?.name === 'QuantUnavailableError';
      results.push({
        id: combo.id,
        backend: combo.backend,
        quant: combo.quant,
        status: unavailable ? 'unavailable' : 'failed',
        stage: 'load',
        error: describeError(err),
      });
      step += profiles.length;
      continue;
    }

    for (const profile of profiles) {
      step += 1;
      if (shouldCancel()) {
        results.push({ id: combo.id, backend: combo.backend, quant: combo.quant, profile, status: 'cancelled' });
        continue;
      }
      const runs = [];
      let audioSec = 0;
      for (let rep = 0; rep < Math.max(1, repeats); rep++) {
        if (shouldCancel()) break;
        onProgress({ phase: 'transcribe', combo, profile, rep, step, totalSteps });
        const t1 = now();
        try {
          const out = await transcribe({ combo, profile, rep });
          audioSec = out?.audioSec || audioSec;
          runs.push({
            wallMs: now() - t1,
            text: out?.text ?? '',
            metrics: out?.metrics ?? null,
            chunks: out?.chunks ?? null,
          });
        } catch (err) {
          runs.push({ error: describeError(err), unavailable: err?.name === 'QuantUnavailableError' });
        }
      }
      if (!runs.length) {
        results.push({ id: combo.id, backend: combo.backend, quant: combo.quant, profile, status: 'cancelled' });
        continue;
      }
      results.push(summarizeRuns({ combo, profile, loadMs, runs, audioSec, expectedText }));
    }
  }
  onProgress({ phase: 'done', step: totalSteps, totalSteps });
  return results;
}

// Strip the environment probe (lib/supportReport.js collectEnvironment) down
// to what a performance report needs. This is an ALLOWLIST, not a blocklist:
// anything a future probe adds is dropped until someone decides it belongs
// here, so the report cannot silently start carrying more than it did.
//
// Deliberately dropped, though the support report keeps them: the raw user
// agent string, high-entropy UA fields (device model, full version list),
// languages, time zone, screen geometry and devicePixelRatio, storage
// quota/usage, audio-input count, and network RTT. Each is a fingerprinting
// surface with no bearing on why one backend is slower than another.
export function anonymizeEnvironment(env = {}) {
  const b = env.browser || {};
  const uad = b.uaData || {};
  const hw = env.hardware || {};
  const gpu = env.webgpu || null;
  const conn = env.connection || null;

  return {
    browser: {
      // Brand + MAJOR version only ("Chromium 148"), which is what a
      // codegen-level performance difference is attributed to.
      brands: Array.isArray(uad.brands)
        ? uad.brands.map((x) => ({ brand: x.brand, version: String(x.version || '').split('.')[0] }))
        : null,
      platform: uad.platform ?? null,
      platformVersionMajor: uad.platformVersion ? String(uad.platformVersion).split('.')[0] : null,
      architecture: uad.architecture ?? null,
      bitness: uad.bitness ?? null,
      mobile: uad.mobile ?? null,
      // Present only when the UA-Client-Hints API is missing (Firefox,
      // Safari), where it is the sole way to tell the engines apart. Trimmed
      // to the engine tokens, never the full string.
      engineHint: uad.brands ? null : engineHintFromUserAgent(b.userAgent),
      webdriver: b.webdriver ?? null,
    },
    hardware: {
      hardwareConcurrency: hw.hardwareConcurrency ?? null,
      deviceMemoryGB: hw.deviceMemoryGB ?? null,
      jsHeapLimitMB: hw.jsHeap?.limitMB ?? null,
    },
    capabilities: env.capabilities ?? null,
    webgpu: gpu
      ? { adapter: gpu.adapter ?? null, features: gpu.features ?? null, limits: gpu.limits ?? null }
      : null,
    ort: env.ort ?? null,
    connection: conn ? { effectiveType: conn.effectiveType ?? null, downlinkMbit: conn.downlink ?? conn.downlinkMbit ?? null } : null,
  };
}

// Coarse engine + major version from a user agent, for browsers with no
// userAgentData. Returns e.g. "Firefox 141" or "Safari 18", never the full
// string (which carries build and device detail).
export function engineHintFromUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return null;
  for (const [name, re] of [
    ['Firefox', /Firefox\/(\d+)/],
    ['Edge', /Edg\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ]) {
    const m = s.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return 'unknown';
}

// Assemble the report. Key order is fixed so two reports diff cleanly, and
// every section is data the visitor can read in the textarea before deciding
// to send it.
export function buildBenchmarkReport({
  reportId = null,
  generatedAt = null,
  app = {},
  settings = {},
  clip = {},
  results = [],
  env = {},
} = {}) {
  return {
    format: 'parakeetweb-benchmark-report/1',
    reportId,
    generatedAt,
    app,
    settings,
    clip,
    environment: anonymizeEnvironment(env),
    results,
  };
}

export function formatBenchmarkReport(report) {
  return JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);
}
