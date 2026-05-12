// Back-end initialisation helper for ONNX Runtime Web.
// At runtime the caller can specify preferred backend ("webgpu", "wasm").
// The function resolves once ONNX Runtime is ready and returns the `ort` module.

// Fetch /ort/manifest.json (emitted by app/ui/postbuild.mjs) and use it to
// verify each ORT WASM/MJS runtime asset before handing the bytes to ORT.
// Without this, a serving-path compromise (a tampered Caddy, a malicious
// reverse proxy, a poisoned CDN cache) could swap the ~11 MB jsep.wasm
// for an attacker-built ML runtime that exfiltrates PCM at inference
// time, completely transparent to the user.
//
// Returns a wasmPaths object `{ mjs, wasm }` whose values are blob URLs
// holding bytes whose sha384 matched the manifest. ORT 1.26+ reads
// `wasmPaths.mjs` and `wasmPaths.wasm` directly when wasmPaths is an
// object (it does NOT scan by filename). We pick the jsep variant
// because the vendored bundle (ort.bundle.min.mjs) only references
// `ort-wasm-simd-threaded.jsep.{mjs,wasm}`; if a future bundle pulls in
// other variants the manifest entries are still verified and live on
// disk, the public mapping just needs to point at the right pair.
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

async function _verifiedOrtWasmPaths(basePath) {
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
  const entries = Object.entries(manifest || {});
  if (entries.length === 0) {
    _integrityFailure('ORT integrity manifest is empty');
    return basePath;
  }
  const verified = {};
  await Promise.all(entries.map(async ([name, expected]) => {
    const url = basePath + name;
    const resp = await fetch(url);
    if (!resp.ok) {
      // Skip variants this build did not ship. ORT will fall back to a
      // sibling file it knows about; if every candidate is missing it
      // surfaces a clear error at session-create time.
      return;
    }
    const blob = await resp.blob();
    const actual = await _sha384B64(blob);
    if (actual !== expected) {
      throw new Error(`ORT integrity check failed for ${name}: expected ${expected}, got ${actual}`);
    }
    verified[name] = URL.createObjectURL(blob);
  }));
  console.log(`[Parakeet.js] ORT runtime integrity verified (${Object.keys(verified).length} files)`);

  // ORT 1.26 expects `wasmPaths.mjs` / `wasmPaths.wasm` (not a
  // filename-keyed map). The vendored ort.bundle.min.mjs only references
  // the jsep variant, so we hand ORT the verified blob URLs for that
  // pair. If the pair isn't in the manifest (a stripped build), fall
  // back to the base path so ORT re-fetches over same-origin; the bytes
  // it gets are still served from /ort/ which the manifest checked at
  // startup, just without the blob-URL pinning.
  const mjsUrl = verified['ort-wasm-simd-threaded.jsep.mjs'];
  const wasmUrl = verified['ort-wasm-simd-threaded.jsep.wasm'];
  if (mjsUrl && wasmUrl) {
    return { mjs: mjsUrl, wasm: wasmUrl };
  }
  console.warn('[Parakeet.js] jsep variant missing from ORT manifest; falling back to base-path wasmPaths (still same-origin, integrity check ran at startup)');
  return basePath;
}

/**
 * Initialise ONNX Runtime Web and pick the execution provider.
 * If WebGPU is requested but not supported, we transparently fall back to WASM.
 * @param {Object} opts
 * @param {('webgpu'|'wasm')} [opts.backend='webgpu'] Desired backend.
 * @param {string} [opts.wasmPaths] Optional path prefix for WASM binaries.
 * @returns {Promise<typeof import('onnxruntime-web').default>}
 */
export async function initOrt({ backend = 'webgpu', wasmPaths, numThreads } = {}) {
  // Dynamic import to handle Vite bundling issues
  let ort;
  
  try {
    const ortModule = await import('onnxruntime-web');
    ort = ortModule.default || ortModule;

    // Some bundler configurations expose the namespace as ortModule.ort.
    if (!ort.env && ortModule.ort) {
      ort = ortModule.ort;
    }
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
    ort.env.wasm.wasmPaths = await _verifiedOrtWasmPaths(wasmPaths || '/ort/');
  }

  // Configure WASM for better performance
  if (backend === 'wasm' || backend === 'webgpu') {
    // Enable multi-threading if supported
    if (typeof SharedArrayBuffer !== 'undefined') {
      ort.env.wasm.numThreads = numThreads || navigator.hardwareConcurrency || 4;
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