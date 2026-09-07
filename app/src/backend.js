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
async function _sha384B64(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-384', buf);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'sha384-' + btoa(bin);
}

// In production builds we refuse to silently fall back when the manifest
// is unreachable or empty: an attacker who can swap /ort/*.wasm bytes can
// also drop the one /ort/manifest.json request and re-open the very
// attack surface F-38a was meant to close. Dev builds keep the soft path
// so vite dev server (no postbuild step) and Node-side unit tests still
// boot. import.meta.env.PROD is a static Vite-replaced boolean, so this
// branch is dead-code-eliminated in dev.
const _ASSET_INTEGRITY_HARD_FAIL = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;

function _integrityFailure(reason) {
  if (_ASSET_INTEGRITY_HARD_FAIL) {
    const err = new Error(`[Parakeet.js] ORT integrity manifest missing or invalid: ${reason}. Refusing to load ML runtime without integrity check.`);
    err.name = 'IntegrityError';
    throw err;
  }
  console.warn(`[Parakeet.js] ${reason}. Falling back to unchecked wasmPaths (DEV ONLY; production hard-fails).`);
}

/**
 * The one runtime variant ORT is pinned to. ORT 1.26+ expects
 * `wasmPaths.mjs` / `wasmPaths.wasm` (not a filename-keyed map), and the
 * vendored ort.bundle.min.mjs only references the jsep variant, so this pair
 * is the whole of what ever gets loaded.
 * @type {{mjs: string, wasm: string}}
 */
export const ORT_RUNTIME_ASSETS = {
  mjs: 'ort-wasm-simd-threaded.jsep.mjs',
  wasm: 'ort-wasm-simd-threaded.jsep.wasm',
};

/**
 * The runtime pair of the EXPERIMENTAL jspi build (see ORT_VARIANTS below).
 * A different bundle entry references different runtime files, so pinning has
 * to move with it or the integrity check would verify bytes ORT never loads.
 * @type {{mjs: string, wasm: string}}
 */
export const ORT_RUNTIME_ASSETS_JSPI = {
  mjs: 'ort-wasm-simd-threaded.jspi.mjs',
  wasm: 'ort-wasm-simd-threaded.jspi.wasm',
};

/**
 * The ORT distributions this app knows how to load, keyed by variant name.
 *
 * 'jsep' is the shipped one: ORT's JS-implemented WebGPU/WebNN layer, where
 * every GPU/CPU partition boundary crosses back into JS and yields to the
 * event loop (~2000 times per fp32 encoder run on this model, which is the
 * coupling the html.gpu-run animation pause exists to defuse).
 *
 * 'jspi' is ORT's newer C++ WebGPU execution provider, which suspends the
 * WASM stack through JavaScript Promise Integration instead of unwinding to
 * JS. It is EXPERIMENTAL here and never a default: it is selectable so the
 * two can be measured against each other on a real GPU, since the remaining
 * JSEP overhead after the animation fix has never been quantified. It also
 * needs the browser to implement JSPI (Chromium 137+; no Firefox, no Safari),
 * hence jspiSupported() below.
 *
 * Both entries live in the vendored package already, so selecting one costs
 * no new supply chain: only the bytes the visitor's browser actually fetches
 * change (the jspi runtime is ~15 MB against jsep's ~26 MB).
 */
export const ORT_VARIANTS = {
  jsep: { assets: ORT_RUNTIME_ASSETS, importer: () => import('onnxruntime-web') },
  jspi: { assets: ORT_RUNTIME_ASSETS_JSPI, importer: () => import('onnxruntime-web/jspi') },
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

/**
 * Resolve a requested ORT variant to one this environment can actually run.
 * Pure, so the fallback rule is unit-testable without a browser.
 *
 * @param {string|undefined} requested Variant name ('jsep' | 'jspi'), or undefined.
 * @param {boolean} hasJspi Whether the browser implements JSPI.
 * @returns {{variant: string, downgraded: boolean}} The variant to load, and
 *   whether a request had to be refused (so the caller can say so once).
 */
export function resolveOrtVariant(requested, hasJspi) {
  if (requested !== 'jspi') return { variant: 'jsep', downgraded: false };
  return hasJspi ? { variant: 'jspi', downgraded: false } : { variant: 'jsep', downgraded: true };
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
  await Promise.all(Object.entries(wanted).map(async ([key, { name, expected }]) => {
    const resp = await fetch(basePath + name);
    // A manifest entry the build did not actually ship. Nothing to pin, so
    // fall through to the base path below (ORT surfaces a clear error at
    // session-create time if the file is missing there too).
    if (!resp.ok) return;
    const blob = await resp.blob();
    const actual = await _sha384B64(blob);
    if (actual !== expected) {
      throw new Error(`ORT integrity check failed for ${name}: expected ${expected}, got ${actual}`);
    }
    verified[key] = URL.createObjectURL(blob);
  }));
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
 * @param {string} [opts.ortVariant] Variant to load ('jsep' | 'jspi').
 * @returns {Promise<typeof import('onnxruntime-web').default>}
 */
export async function loadOrtModule({ wasmPaths, ortVariant } = {}) {
  if (_ortLoad) {
    if (ortVariant && ortVariant !== _ortLoadedVariant) {
      console.warn(`[Parakeet.js] ORT ${_ortLoadedVariant} runtime is already live in this context; `
        + `ignoring the ${ortVariant} request (ORT pins one runtime per JS context).`);
    }
    return _ortLoad;
  }

  // Refusing an unsupported request here (a browser without JSPI) rather than
  // at session-create time keeps the failure one warning instead of a broken load.
  const { variant, downgraded } = resolveOrtVariant(ortVariant, jspiSupported());
  if (downgraded) {
    console.warn('[Parakeet.js] ORT jspi runtime requested but this browser does not implement JSPI; using jsep');
  }
  _ortLoadedVariant = variant;

  _ortLoad = (async () => {
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
      ort.env.wasm.wasmPaths = await _verifiedOrtWasmPaths(wasmPaths || '/ort/', ORT_VARIANTS[variant].assets);
    }
    // One line per context, and the marker the WebGPU A/B harness asserts on:
    // ORT pins one runtime per JS context, so a run that thinks it measured jspi
    // while a worker quietly loaded jsep would be worse than no measurement. The
    // context is part of the line because a page has several: only the main
    // thread holds the GPU session, while the decode/encode workers are WASM and
    // deliberately stay on the shipped runtime, so an untagged line would let a
    // worker's 'jsep' be read as the answer for the GPU.
    const ctx = typeof document === 'undefined' ? 'worker' : 'main';
    console.log(`[Parakeet.js] ORT runtime variant: ${variant} (${ctx})`);
    return ort;
  })();

  // A failed load must not poison the context: let a later attempt retry.
  _ortLoad.catch(() => { _ortLoad = null; _ortLoadedVariant = null; });
  return _ortLoad;
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
  const ort = await loadOrtModule({ wasmPaths, ortVariant });

  // Configure WASM for better performance
  if (backend === 'wasm' || backend === 'webgpu') {
    // Enable multi-threading if supported. When the caller does not pin a
    // count, use defaultWasmThreads() rather than raw hardwareConcurrency:
    // hyperthread-count threads oversubscribe the physical cores and ORT's
    // spin-waiting pool makes that slower than single-threaded.
    if (typeof SharedArrayBuffer !== 'undefined') {
      ort.env.wasm.numThreads = numThreads
        || defaultWasmThreads(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
      ort.env.wasm.simd = true;
      console.log(`[Parakeet.js] WASM configured with ${ort.env.wasm.numThreads} threads, SIMD enabled`);
    } else {
      console.warn('[Parakeet.js] SharedArrayBuffer not available - using single-threaded WASM');
      ort.env.wasm.numThreads = 1;
    }
    
    // Enable other WASM optimizations
    ort.env.wasm.proxy = false; // Direct execution for better performance
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