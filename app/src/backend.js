// Back-end initialisation helper for ONNX Runtime Web.
// At runtime the caller can specify preferred backend ("webgpu", "wasm").
// The function resolves once ONNX Runtime is ready and returns the `ort` module.

// Fetch /ort/manifest.json (emitted by app/ui/postbuild.mjs) and use it to
// verify the ORT WASM/MJS runtime assets before handing the bytes to ORT.
// Without this, a serving-path compromise (a tampered Caddy, a malicious
// reverse proxy, a poisoned CDN cache) could swap the ~26 MB jsep.wasm
// for an attacker-built ML runtime that exfiltrates PCM at inference
// time, completely transparent to the user.
//
// Returns a wasmPaths object `{ mjs, wasm }` whose values are blob URLs
// holding bytes whose sha384 matched the manifest. ORT 1.26+ reads
// `wasmPaths.mjs` and `wasmPaths.wasm` directly when wasmPaths is an
// object (it does NOT scan by filename). We pick the jsep variant
// because the vendored bundle (ort.bundle.min.mjs) only references
// `ort-wasm-simd-threaded.jsep.{mjs,wasm}`.
//
// ONLY that pinned pair is fetched, not every manifest entry. The vendored
// npm package ships four runtime variants (plain / jsep / jspi / asyncify,
// ~76 MB of .wasm all told) and postbuild hashes all of them, but three of
// them are never loaded: pinning `wasmPaths` to the jsep blob URLs means ORT
// requests nothing else. Downloading + hashing them anyway cost ~54 MB per
// JS CONTEXT (main thread AND every worker: each one runs its own ORT
// runtime), and the object URLs minted for the unused six were never
// revoked. With the encode pool and the composed decode worker that is four
// contexts fetching ~80 MB each at once, right while the model weights are
// downloading; one of those concurrent transfers reliably died with
// net::ERR_FAILED ("Failed to fetch"), which permanently dropped a worker to
// the in-thread fallback (caught by transcription-composed-pipeline.spec.js).
// Verifying bytes that are never executed bought nothing anyway.
//
// Falls back to the original string wasmPaths (no integrity check) when:
//   - manifest fetch returns 404 (e.g. running against a dev server with
//     no postbuild step, or an old container image without the manifest).
//   - WebCrypto isn't available (legacy browsers).
// The fallback logs a loud warning; production deployments built via
// the Dockerfile always ship the manifest.
import { ASSET_INTEGRITY_HARD_FAIL, integrityError, sha384Base64 } from './integrity.js';

// The digest and the hard-fail policy are shared with the app's other
// verify-then-load path (app/ui/src/lib/asset-integrity.js, which pins the PCM
// worklet). Both used to carry their own byte-identical
// copy of each, which is how the two would eventually disagree about what
// counts as production.
function _integrityFailure(reason) {
  if (ASSET_INTEGRITY_HARD_FAIL) {
    throw integrityError(`[Parakeet.js] ORT integrity manifest missing or invalid: ${reason}. Refusing to load ML runtime without integrity check.`);
  }
  console.warn(`[Parakeet.js] ${reason}. Falling back to unchecked wasmPaths (DEV ONLY; production hard-fails).`);
}

/**
 * The runtime pair of the jsep build. ORT 1.26+ expects `wasmPaths.mjs` /
 * `wasmPaths.wasm` (not a filename-keyed map), so a variant is pinned as a
 * pair. This is no longer the default (see ORT_VARIANTS): it is what a browser
 * without JSPI falls back to, and what `?ortep=jsep` forces.
 * @type {{mjs: string, wasm: string}}
 */
export const ORT_RUNTIME_ASSETS = {
  mjs: 'ort-wasm-simd-threaded.jsep.mjs',
  wasm: 'ort-wasm-simd-threaded.jsep.wasm',
};

/**
 * The runtime pair of the jspi build, the DEFAULT (see ORT_VARIANTS below).
 * A different bundle entry references different runtime files, so pinning has
 * to move with it or the integrity check would verify bytes ORT never loads.
 * @type {{mjs: string, wasm: string}}
 */
export const ORT_RUNTIME_ASSETS_JSPI = {
  mjs: 'ort-wasm-simd-threaded.jspi.mjs',
  wasm: 'ort-wasm-simd-threaded.jspi.wasm',
};

/**
 * The self-compiled CPU runtimes (scripts/ort-custom/build.sh, provenance in
 * app/ui/vendor/ort-custom/): the vendored ORT version with an integer
 * MatMulNBits kernel for WASM, where stock ORT dequantizes to fp32 and runs
 * SGEMM. Same version as the npm package, CPU only (no WebGPU EP), and loaded
 * through the vendored 'onnxruntime-web/wasm' bundle, which honours a
 * `wasmPaths.mjs` override instead of its embedded glue.
 *
 * Two files because a browser rejects a WHOLE module that contains one
 * instruction it does not implement: the relaxed-SIMD build for Chromium and
 * Firefox, the plain-SIMD one for engines without relaxed SIMD. wasmSimdLevel()
 * picks by feature detection, which is deterministic, unlike the timing
 * micro-bench that chose the previous self-compiled runtime (removed in
 * 6c030bf partly because it flipped between runs on a busy machine).
 * @type {{mjs: string, wasm: string}}
 */
export const ORT_RUNTIME_ASSETS_CUSTOM_RELAXED = {
  mjs: 'ort-wasm-relaxedsimd-threaded.custom.mjs',
  wasm: 'ort-wasm-relaxedsimd-threaded.custom.wasm',
};
/** @type {{mjs: string, wasm: string}} */
export const ORT_RUNTIME_ASSETS_CUSTOM_SIMD = {
  mjs: 'ort-wasm-simd-threaded.custom.mjs',
  wasm: 'ort-wasm-simd-threaded.custom.wasm',
};

/**
 * The ORT distributions this app knows how to load, keyed by variant name.
 *
 * 'jspi' is the DEFAULT: ORT's native C++ WebGPU execution provider, which
 * suspends the WASM stack through JavaScript Promise Integration instead of
 * unwinding into JS at every GPU/CPU partition boundary. It needs the browser
 * to implement JSPI (Chromium 137+; no Firefox, no Safari), so resolveOrtVariant
 * falls back to jsep on its own where it is missing.
 *
 * 'jsep' is the older JS-implemented WebGPU/WebNN layer, where every partition
 * boundary crosses back into JS and yields to the event loop (~2000 times per
 * fp32 encoder run on this model, the coupling the html.gpu-run animation pause
 * exists to defuse). It stays as the no-JSPI fallback and as the escape hatch
 * `?ortep=jsep`.
 *
 * WHY jspi is the default, since it is NOT a speed win: two A/Bs on the
 * reference box, each 3 interleaved reps with the runtime verified per run in
 * every JS context, put the two within noise of each other (GPU fp32 wall
 * medians 13.0 s jsep / 13.8 s jspi; WASM int8 on a 3-minute clip 125 s jsep /
 * 114 s jspi, with one contaminated jspi run). The argument is SIZE and
 * direction of travel: the jspi runtime is 16 MB against jsep's 27 MB and its
 * bundle 112 KB against 404 KB, so it takes ~11 MB off every single load of an
 * app whose main complaint is load time, and the native EP is where ORT's
 * WebGPU work is going. Both entries were already in the vendored package, so
 * this costs no new supply chain: only which bytes the browser fetches changes.
 *
 * 'custom-relaxed' / 'custom-simd' are the self-compiled CPU runtimes above.
 * They are picked ONLY for a context whose sessions are all WASM (the encode,
 * decode, diarize and probe-CPU workers, and the main thread on the WASM
 * backend), because they carry no WebGPU EP. Measured through ORT-web on the
 * 3000-frame encoder, paired against stock: int8 1.81x (relaxed) / 1.04x
 * (plain) in Chromium, 2.72x / 1.61x in Firefox. Any failure to load them
 * (missing or tampered file, unvalidatable module, a smoke session that will
 * not build) falls back to the stock default, so they can only ever add speed.
 */
export const ORT_VARIANTS = {
  jsep: { assets: ORT_RUNTIME_ASSETS, importer: () => import('onnxruntime-web') },
  jspi: { assets: ORT_RUNTIME_ASSETS_JSPI, importer: () => import('onnxruntime-web/jspi') },
  'custom-relaxed': {
    assets: ORT_RUNTIME_ASSETS_CUSTOM_RELAXED, importer: () => import('onnxruntime-web/wasm'),
    custom: true, simd: 'relaxed',
  },
  'custom-simd': {
    assets: ORT_RUNTIME_ASSETS_CUSTOM_SIMD, importer: () => import('onnxruntime-web/wasm'),
    custom: true, simd: true,
  },
};

/**
 * Whether this browser implements JavaScript Promise Integration, which the
 * jspi build needs to suspend the WASM stack. `WebAssembly.Suspending` is the
 * constructor the shipped (phase 4) API exposes; the older `WebAssembly.Function`
 * prototype belonged to a withdrawn draft, so it is deliberately not accepted.
 * @returns {boolean}
 */
export function jspiSupported() {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.Suspending === 'function';
}

// Smallest modules using one plain-SIMD (i8x16.popcnt) and one relaxed-SIMD
// (i8x16.relaxed_swizzle) instruction, the probes wasm-feature-detect uses.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED_SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

/**
 * The richest WASM SIMD level this engine validates, which decides which
 * custom runtime file (if any) it can run.
 * @returns {'relaxed'|'simd'|null}
 */
export function wasmSimdLevel() {
  try {
    if (typeof WebAssembly === 'undefined') return null;
    if (WebAssembly.validate(RELAXED_SIMD_PROBE)) return 'relaxed';
    if (WebAssembly.validate(SIMD_PROBE)) return 'simd';
  } catch (_) { /* treat a throwing validate like a missing feature */ }
  return null;
}

/**
 * Resolve a requested ORT variant to one this environment can actually run.
 * Pure, so the fallback rule is unit-testable without a browser.
 *
 * @param {string|undefined} requested Variant name ('jsep' | 'jspi' |
 *   'stock'), or undefined for the default.
 * @param {boolean} hasJspi Whether the browser implements JSPI.
 * @param {Object} [ctx]
 * @param {boolean} [ctx.cpuOnly=false] Every session this context builds is
 *   WASM, so a runtime without the WebGPU EP is acceptable.
 * @param {('relaxed'|'simd'|null)} [ctx.simd=null] wasmSimdLevel() of the engine.
 * @returns {{variant: string, downgraded: boolean}} The variant to load, and
 *   whether an explicit request had to be refused (so the caller can say so
 *   once). A default that lands on jsep is not a downgrade.
 */
export function resolveOrtVariant(requested, hasJspi, { cpuOnly = false, simd = null } = {}) {
  // An explicit 'jsep' is the escape hatch and always wins.
  if (requested === 'jsep') return { variant: 'jsep', downgraded: false };
  // The custom CPU runtime is the default wherever it can serve the context.
  // Any explicit request ('jspi', or 'stock', the escape hatch back to the npm
  // runtimes) opts out of it, including in the CPU-only workers.
  if (requested !== 'jspi' && requested !== 'stock' && cpuOnly) {
    if (simd === 'relaxed') return { variant: 'custom-relaxed', downgraded: false };
    if (simd === 'simd') return { variant: 'custom-simd', downgraded: false };
  }
  if (hasJspi) return { variant: 'jspi', downgraded: false };
  // No JSPI in this browser. `downgraded` reports a REFUSED REQUEST, so it is
  // only true when the caller asked for jspi by name: the default arriving on
  // jsep is the designed path (every non-Chromium browser), not something to
  // warn every visitor about.
  return { variant: 'jsep', downgraded: requested === 'jspi' };
}

/**
 * Pick the manifest entries for the runtime pair that will actually be loaded.
 * Pure, so the "fetch only what we pin" contract is unit-testable without a
 * browser (test/unit/ort-asset-verify.test.mjs).
 *
 * @param {Record<string,string>} manifest filename -> sha384-... map.
 * @param {{mjs: string, wasm: string}} [names] variant to pin.
 * @returns {?{mjs: {name: string, expected: string}, wasm: {name: string, expected: string}}}
 *   null when the manifest does not carry BOTH halves of the pair (a stripped
 *   or foreign build): there is nothing to pin, so the caller falls back.
 */
export function selectOrtRuntimeAssets(manifest, names = ORT_RUNTIME_ASSETS) {
  const mjs = manifest?.[names.mjs];
  const wasm = manifest?.[names.wasm];
  if (!mjs || !wasm) return null;
  return {
    mjs: { name: names.mjs, expected: mjs },
    wasm: { name: names.wasm, expected: wasm },
  };
}

// Exported for the unit test only (nothing else imports it): the property that
// matters is WHICH requests it makes, which a pure helper cannot express.
export async function _verifiedOrtWasmPaths(basePath, names = ORT_RUNTIME_ASSETS) {
  if (typeof fetch === 'undefined' || !crypto?.subtle) {
    _integrityFailure('WebCrypto unavailable');
    return basePath;
  }
  let manifest;
  try {
    const resp = await fetch(basePath + 'manifest.json');
    if (!resp.ok) throw new Error('manifest HTTP ' + resp.status);
    manifest = await resp.json();
  } catch (e) {
    _integrityFailure(`No ORT integrity manifest at ${basePath}manifest.json (${e.message})`);
    return basePath;
  }
  if (Object.keys(manifest || {}).length === 0) {
    _integrityFailure('ORT integrity manifest is empty');
    return basePath;
  }
  // Fall back when the manifest cannot pin our variant (a stripped build):
  // ORT then re-fetches by name over same-origin, unpinned.
  const wanted = selectOrtRuntimeAssets(manifest, names);
  if (!wanted) {
    console.warn(`[Parakeet.js] ${names.mjs} variant missing from ORT manifest; falling back to base-path wasmPaths (still same-origin, but the runtime bytes are NOT pinned)`);
    return basePath;
  }
  const verified = {};
  // allSettled, not all: the two halves are fetched and hashed concurrently,
  // so a mismatch on one can land while the other is still in flight. Promise
  // .all rejects at that instant, and the sibling then mints its object URL
  // AFTER any revoke sweep, pinning the whole ~16 MB runtime in memory for the
  // life of the document. Waiting for both to settle is the only moment at
  // which the minted set is complete and can be swept.
  const settled = await Promise.allSettled(Object.entries(wanted).map(async ([key, { name, expected }]) => {
    const resp = await fetch(basePath + name);
    // A manifest entry the build did not actually ship. Nothing to pin, so
    // fall through to the base path below (ORT surfaces a clear error at
    // session-create time if the file is missing there too).
    if (!resp.ok) return;
    const blob = await resp.blob();
    const actual = await sha384Base64(blob);
    if (actual !== expected) {
      throw new Error(`ORT integrity check failed for ${name}: expected ${expected}, got ${actual}`);
    }
    verified[key] = URL.createObjectURL(blob);
  }));
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) {
    for (const url of Object.values(verified)) URL.revokeObjectURL(url);
    throw failed.reason;
  }
  if (!verified.mjs || !verified.wasm) {
    // Don't leak the half we did mint an object URL for.
    for (const url of Object.values(verified)) URL.revokeObjectURL(url);
    console.warn(`[Parakeet.js] ORT runtime asset missing under ${basePath}; falling back to base-path wasmPaths (still same-origin, but the runtime bytes are NOT pinned)`);
    return basePath;
  }
  console.log(`[Parakeet.js] ORT runtime integrity verified (${Object.keys(verified).length} files)`);
  return { mjs: verified.mjs, wasm: verified.wasm };
}

/**
 * Default ORT-WASM thread count for a machine reporting `hardwareConcurrency`
 * logical processors. `hardwareConcurrency` counts HYPERTHREADS while ORT's
 * WASM thread pool spin-waits, so running more threads than physical cores is
 * actively destructive (measured on a 6C/12T box: 12 threads encode SLOWER
 * than 1). Mirror onnxruntime-web's own heuristic
 * (js/web/lib/backend-wasm.ts): ceil(hc / 2) approximates physical cores,
 * capped at 4 where intra-op scaling is already flat (1t->6t was only 2.6x).
 * Machines with more cores get their extra parallelism from the chunk-level
 * encoder pool (parallel encode workers), not from a wider intra-op pool.
 * @param {number} [hardwareConcurrency] navigator.hardwareConcurrency.
 * @returns {number} thread count >= 1.
 */
export function defaultWasmThreads(hardwareConcurrency) {
  const hc = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 8;
  return Math.max(1, Math.min(4, Math.ceil(hc / 2)));
}

/**
 * The ORT module instance live in THIS JS context, and the variant it is.
 * ORT pins one WASM runtime per context, so there can only ever be one; making
 * that a module-level singleton is what stops a second consumer from importing
 * its own copy (see loadOrtModule).
 */
let _ortLoad = null;
let _ortLoadedVariant = null;
// Set once the custom runtime failed in this context (unpinnable, tampered,
// or its smoke session would not build), so every later load resolves to stock
// instead of retrying a runtime known not to work here.
let _customRuntimeRefused = false;
// initOrt's one smoke session per custom runtime (see _customRuntimeWorks).
let _customSmoke = null;

/** The ORT variant live in this JS context, or null before the first load. */
export function liveOrtVariant() {
  return _ortLoadedVariant;
}

function _resolve(ortVariant, cpuOnly) {
  return resolveOrtVariant(ortVariant, jspiSupported(), {
    cpuOnly: cpuOnly && !_customRuntimeRefused,
    simd: wasmSimdLevel(),
  });
}

/**
 * Whether the runtime live in this context is the one a fresh load for
 * `backend` would pick. False means the page has to reload to switch: ORT
 * cannot host a second runtime in a context that already initialised one.
 * True before anything is loaded, and after the custom runtime was refused
 * here (a reload would only refuse it again).
 * @param {string} backend App backend id ('wasm', 'webgpu-hybrid', ...).
 * @param {string} [ortVariant] The page's explicit request (?ortep=).
 * @returns {boolean}
 */
export function liveOrtServes(backend, ortVariant) {
  if (!_ortLoadedVariant) return true;
  return _resolve(ortVariant, backend === 'wasm').variant === _ortLoadedVariant;
}

/**
 * Load ONNX Runtime Web ONCE per JS context and hand it verified wasmPaths.
 *
 * Every ORT consumer in the app must come through here rather than importing
 * 'onnxruntime-web' itself. The reason is not tidiness: a direct import returns
 * a DIFFERENT module instance whenever the two resolve to different variant
 * entry points, and only the one initOrt configured has the integrity-verified
 * blob wasmPaths. The other tries to fetch its runtime from wherever the bundle
 * happens to sit (/assets/ort-wasm-simd-threaded.jsep.mjs), receives the SPA
 * fallback HTML, and dies with "no available backend found". That is exactly
 * how speaker embedding broke the moment the main thread was moved to the jspi
 * runtime: diarization still produced turns, so voice matching failed SILENTLY.
 *
 * Callers that do not care which variant is live pass nothing and get whatever
 * this context already loaded. A caller that asks for a variant after one is
 * live is a bug, not a request to satisfy (ORT cannot host two runtimes in one
 * context), so it is warned about rather than honoured.
 *
 * @param {Object} [opts]
 * @param {string} [opts.wasmPaths] Path prefix for the runtime assets.
 * @param {string} [opts.ortVariant] Variant to load ('jsep' | 'jspi' | 'stock').
 * @param {boolean} [opts.cpuOnly=false] Every session of this context is WASM,
 *   which lets the custom CPU runtime be picked.
 * @returns {Promise<typeof import('onnxruntime-web').default>}
 */
export async function loadOrtModule({ wasmPaths, ortVariant, cpuOnly = false } = {}) {
  if (_ortLoad) {
    const wanted = ortVariant && _resolve(ortVariant, cpuOnly).variant;
    if (wanted && wanted !== _ortLoadedVariant) {
      console.warn(`[Parakeet.js] ORT ${_ortLoadedVariant} runtime is already live in this context; `
        + `ignoring the ${wanted} request (ORT pins one runtime per JS context).`);
    }
    return _ortLoad;
  }

  // Refusing an unsupported request here (a browser without JSPI) rather than
  // at session-create time keeps the failure one warning instead of a broken load.
  const { variant: resolved, downgraded } = _resolve(ortVariant, cpuOnly);
  if (downgraded) {
    console.warn('[Parakeet.js] ORT jspi runtime requested but this browser does not implement JSPI; using jsep');
  }
  let variant = resolved;
  _ortLoadedVariant = variant;
  const base = wasmPaths || '/ort/';

  _ortLoad = (async () => {
    // The custom runtime is only worth loading PINNED: unlike the stock
    // variants, an unpinned base-path fallback would make ORT fetch the npm
    // file names, not the custom ones. So anything short of verified blob URLs
    // (no manifest entry, a file the build did not ship, a hash mismatch)
    // switches this context to stock before any ORT module is imported.
    let verifiedPaths = null;
    if (ORT_VARIANTS[variant].custom) {
      try {
        verifiedPaths = await _verifiedOrtWasmPaths(base, ORT_VARIANTS[variant].assets);
        if (typeof verifiedPaths !== 'object') throw new Error('runtime not pinned by the ORT manifest');
      } catch (e) {
        console.warn(`[Parakeet.js] ORT ${variant} runtime unavailable (${e.message}); using the stock runtime`);
        _customRuntimeRefused = true;
        variant = _resolve(ortVariant, cpuOnly).variant;
        _ortLoadedVariant = variant;
        verifiedPaths = null;
      }
    }

    let ort;
    try {
      const ortModule = await ORT_VARIANTS[variant].importer();
      ort = ortModule.default || ortModule;
      // Some bundler configurations expose the namespace as ortModule.ort.
      if (!ort.env && ortModule.ort) ort = ortModule.ort;
    } catch (e) {
      console.error('[Parakeet.js] Failed to import onnxruntime-web:', e);
      throw new Error('Failed to load ONNX Runtime Web. Please check your network connection.');
    }
    if (!ort || !ort.env) {
      throw new Error('ONNX Runtime Web loaded but env is not available. This might be a bundling issue.');
    }

    // Serve WASM artifacts from same-origin (vendored under app/ui/public/ort/).
    // Avoids trusting a public CDN at runtime. A jsDelivr/npm compromise would
    // otherwise silently swap the ML engine for every visitor. Files are baked
    // into the build, so the version always matches the vendored JS loader.
    // Additionally verify each runtime asset against the build-time manifest
    // before handing bytes to ORT; on success this becomes an object map of
    // blob URLs whose sha384 matched the pin.
    if (!ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths = verifiedPaths || await _verifiedOrtWasmPaths(base, ORT_VARIANTS[variant].assets);
    }
    // One line per context, and the marker the WebGPU A/B harness asserts on:
    // ORT pins one runtime per JS context, so a run that thinks it measured jspi
    // while a worker quietly loaded jsep would be worse than no measurement. The
    // context is part of the line because a page has several: only the main
    // thread holds the GPU session, while the decode/encode workers are WASM and
    // run the custom CPU runtime by default, so an untagged line would let a
    // worker's variant be read as the answer for the GPU.
    const ctx = typeof document === 'undefined' ? 'worker' : 'main';
    console.log(`[Parakeet.js] ORT runtime variant: ${variant} (${ctx})`);
    return ort;
  })();

  // A failed load must not poison the context: let a later attempt retry.
  _ortLoad.catch(() => { _ortLoad = null; _ortLoadedVariant = null; });
  return _ortLoad;
}

// A 67-byte ONNX model, one Identity node (opset 13, float[1] -> float[1]).
// Building a session from it is what makes ORT instantiate its WASM runtime,
// which is where an engine that cannot run the module would fail.
const SMOKE_MODEL_B64 = 'CAgSADo3ChAKAXgSAXkiCElkZW50aXR5EgFzWg8KAXgSCgoICAESBAoCCAFiDwoBeRIKCggIARIECgIIAUIECgAQDQ==';

/**
 * Prove the custom runtime instantiates and builds a session in this context,
 * once. ORT initialises its WASM runtime lazily at the first session, AFTER
 * the env (threads, SIMD level) is set, so this cannot live in loadOrtModule:
 * it runs from initOrt once the env is configured.
 * @returns {Promise<boolean>}
 */
function _customRuntimeWorks(ort) {
  _customSmoke ??= (async () => {
    try {
      const bytes = Uint8Array.from(atob(SMOKE_MODEL_B64), (c) => c.charCodeAt(0));
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      await session.release?.();
      return true;
    } catch (e) {
      console.warn(`[Parakeet.js] ORT ${_ortLoadedVariant} runtime failed its smoke session (${e?.message || e}); using the stock runtime`);
      return false;
    }
  })();
  return _customSmoke;
}

function _configureWasm(ort, numThreads) {
  // Enable multi-threading if supported. When the caller does not pin a
  // count, use defaultWasmThreads() rather than raw hardwareConcurrency:
  // hyperthread-count threads oversubscribe the physical cores and ORT's
  // spin-waiting pool makes that slower than single-threaded.
  if (typeof SharedArrayBuffer !== 'undefined') {
    ort.env.wasm.numThreads = numThreads
      || defaultWasmThreads(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
    console.log(`[Parakeet.js] WASM configured with ${ort.env.wasm.numThreads} threads, SIMD enabled`);
  } else {
    console.warn('[Parakeet.js] SharedArrayBuffer not available - using single-threaded WASM');
    ort.env.wasm.numThreads = 1;
  }
  // 'relaxed' makes ORT check the engine itself before instantiating the
  // relaxed-SIMD custom runtime; every other runtime is plain SIMD.
  ort.env.wasm.simd = ORT_VARIANTS[_ortLoadedVariant]?.simd ?? true;
  // Enable other WASM optimizations
  ort.env.wasm.proxy = false; // Direct execution for better performance
}

/**
 * Initialise ONNX Runtime Web and pick the execution provider.
 * If WebGPU is requested but not supported, we transparently fall back to WASM.
 * @param {Object} opts
 * @param {('webgpu'|'wasm')} [opts.backend='webgpu'] Desired backend.
 * @param {string} [opts.wasmPaths] Optional path prefix for WASM binaries.
 * @returns {Promise<typeof import('onnxruntime-web').default>}
 */
export async function initOrt({ backend = 'webgpu', wasmPaths, numThreads, ortVariant } = {}) {
  const cpuOnly = backend === 'wasm';
  let ort = await loadOrtModule({ wasmPaths, ortVariant, cpuOnly });
  _configureWasm(ort, numThreads);

  if (ORT_VARIANTS[_ortLoadedVariant]?.custom && !(await _customRuntimeWorks(ort))) {
    // ORT cannot re-initialise a module instance whose runtime failed, but the
    // stock variants are DIFFERENT bundle entries with their own init state,
    // so this context can still switch to one. Guarded on the variant still
    // being custom: a concurrent initOrt may already have switched it.
    if (ORT_VARIANTS[_ortLoadedVariant]?.custom) {
      _customRuntimeRefused = true;
      _ortLoad = null;
      _ortLoadedVariant = null;
    }
    ort = await loadOrtModule({ wasmPaths, ortVariant, cpuOnly });
    _configureWasm(ort, numThreads);
  }

  if (backend === 'webgpu') {
    if (!('gpu' in navigator)) {
      console.warn('[Parakeet.js] WebGPU not supported – falling back to WASM');
      backend = 'wasm';
    }
    // Otherwise WebGPU is initialised automatically when the session is created.
  }

  // Expose ort globally so other modules (like SileroVAD) can reuse the same
  // configured instance without re-importing and re-initialising.
  if (typeof globalThis !== 'undefined') {
    globalThis.ort = ort;
  }

  // Return the ort module for use in creating sessions and tensors
  return ort;
}
