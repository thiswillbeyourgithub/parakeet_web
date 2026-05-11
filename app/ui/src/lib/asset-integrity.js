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

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/.well-known/asset-integrity.json')
      .then(r => {
        if (!r.ok) {
          if (_HARD_FAIL) throw new Error(`asset-integrity.json HTTP ${r.status}`);
          return {};
        }
        return r.json();
      })
      .catch(err => {
        if (_HARD_FAIL) throw err;
        return {};
      });
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
