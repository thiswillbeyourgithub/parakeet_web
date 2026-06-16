// Verify-then-load helper for loose runtime assets that bypass the HTML
// SRI chain (added in postbuild.mjs). Today the only such asset is
// pcm-recorder-worklet.js: AudioWorklet.addModule() loads a script that
// runs in the AudioWorkletGlobalScope with full access to raw PCM samples.
// A serving-path compromise (tampered Caddy, malicious sidecar, CDN
// poisoning) could swap that file and leak audio undetected.
//
// The browser cannot SRI-check addModule() the way it does <script
// integrity=...>: there is no integrity option. So we do it manually:
// fetch the bytes, hash them against the build-time pin from
// /.well-known/asset-integrity.json (emitted by app/ui/postbuild.mjs),
// then hand AudioWorklet.addModule a blob URL of the verified bytes.
//
// Falls open with a loud warning when the manifest is unreachable (dev
// server, old container image without postbuild output). Production
// builds always ship the manifest.

// Hard-fail in production: an attacker who can swap the worklet bytes can
// also drop the one manifest request and re-open the F-38b attack surface.
// Dev keeps the soft path so vite dev server (no postbuild manifest) and
// integration tests still work.
const _HARD_FAIL = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;

let manifestPromise = null;

// F-103: clear the cached promise on rejection so a transient network
// blip on the first verifiedAddModule call doesn't permanently break
// AudioWorklet load. Only successful resolutions are memoised; failures
// fall through to the next caller. HARD_FAIL semantics (throw to the
// caller) are preserved, just retryable instead of one-shot-fatal.
function loadManifest() {
  if (!manifestPromise) {
    const inflight = fetch('/.well-known/asset-integrity.json')
      .then(r => {
        if (!r.ok) {
          if (_HARD_FAIL) throw new Error(`asset-integrity.json HTTP ${r.status}`);
          return {};
        }
        return r.json();
      })
      .catch(err => {
        if (_HARD_FAIL) {
          if (manifestPromise === inflight) manifestPromise = null;
          throw err;
        }
        return {};
      });
    manifestPromise = inflight;
  }
  return manifestPromise;
}

async function sha384Base64(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-384', buf);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'sha384-' + btoa(bin);
}

/**
 * Fetch a loose runtime asset and sha384-verify its bytes against the
 * build-time pin before the caller evaluates them. Shared by
 * `verifiedAddModule` (the PCM worklet) and `lib/diarizer.js` (the
 * lazily-loaded sherpa diarization engine, a second ML runtime that must
 * not be evaluated unverified).
 *
 * Same fall-open-in-dev / hard-fail-in-prod policy as the worklet path: a
 * production build with no pin (or no WebCrypto) throws an IntegrityError;
 * a dev build warns and returns the unverified bytes so the vite dev
 * server and integration tests still work.
 *
 * @param {string} path absolute same-origin path (e.g. '/sherpa-onnx/x.wasm')
 * @param {string} [manifestKey] key in asset-integrity.json; defaults to the
 *   basename, but diarization assets are pinned under 'sherpa-onnx/<name>'.
 * @returns {Promise<{ bytes: Uint8Array, blob: Blob, verified: boolean }>}
 */
export async function fetchVerifiedAsset(path, manifestKey = path.split('/').pop()) {
  const manifest = await loadManifest();
  const expected = manifest[manifestKey];
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`fetchVerifiedAsset ${path}: HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (!expected || !crypto?.subtle) {
    if (_HARD_FAIL) {
      const err = new Error(`[asset-integrity] no production pin for ${manifestKey}; refusing to load ${path}`);
      err.name = 'IntegrityError';
      throw err;
    }
    console.warn(`[asset-integrity] no pin for ${manifestKey}; ${path} UNCHECKED (dev only)`);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), blob, verified: false };
  }
  const actual = await sha384Base64(blob);
  if (actual !== expected) {
    const err = new Error(`Integrity check failed for ${manifestKey}: expected ${expected}, got ${actual}`);
    err.name = 'IntegrityError';
    throw err;
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), blob, verified: true };
}

/**
 * Drop-in replacement for `audioWorklet.addModule(path)` that fetches +
 * sha384-verifies the bytes against the build-time pin before letting
 * the AudioWorkletGlobalScope evaluate them. Throws on integrity
 * mismatch so the caller bails before the worklet wires into the audio
 * graph.
 *
 * @param {AudioWorklet} audioWorklet
 * @param {string} path absolute path (e.g. '/pcm-recorder-worklet.js')
 */
export async function verifiedAddModule(audioWorklet, path) {
  const name = path.split('/').pop();
  const manifest = await loadManifest();
  const expected = manifest[name];
  if (!expected || !crypto?.subtle) {
    if (_HARD_FAIL) {
      const err = new Error(`[asset-integrity] no production pin for ${name}; refusing addModule(${path})`);
      err.name = 'IntegrityError';
      throw err;
    }
    console.warn(`[asset-integrity] no pin for ${name}; addModule(${path}) UNCHECKED (dev only)`);
    return audioWorklet.addModule(path);
  }
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`addModule fetch ${path}: HTTP ${resp.status}`);
  const blob = await resp.blob();
  const actual = await sha384Base64(blob);
  if (actual !== expected) {
    const err = new Error(`AudioWorklet integrity check failed for ${name}: expected ${expected}, got ${actual}`);
    err.name = 'IntegrityError';
    throw err;
  }
  const url = URL.createObjectURL(blob);
  try {
    await audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
