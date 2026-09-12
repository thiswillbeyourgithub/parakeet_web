// Shared sha384 asset-integrity primitives.
//
// Two independent verify-then-load paths exist in this app and they must agree
// on the hash format and on the fall-open policy, or a build change silently
// weakens one of them:
//   - backend.js pins the ORT WASM/MJS runtime against /ort/manifest.json,
//   - app/ui/src/lib/asset-integrity.js pins the loose assets that bypass the
//     HTML SRI chain (the PCM AudioWorklet, the sherpa diarization engine)
//     against /.well-known/asset-integrity.json.
// Both used to carry their own byte-identical copy of the digest function and
// their own copy of the production hard-fail flag.
//
// Built with Claude Code.

/**
 * sha384 of a Blob's bytes, in the `sha384-<base64>` form the build-time
 * manifests store (the same shape as an HTML `integrity=` attribute).
 *
 * @param {Blob} blob Bytes to digest.
 * @returns {Promise<string>} e.g. 'sha384-abc...'.
 */
export async function sha384Base64(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-384', buf);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'sha384-' + btoa(bin);
}

/**
 * Whether a missing or unusable integrity pin is fatal.
 *
 * In production we refuse to silently fall back: an attacker who can swap the
 * pinned bytes can also drop the one manifest request and re-open the very
 * attack surface the pin exists to close. Dev builds keep the soft path so the
 * vite dev server (no postbuild manifest) and the Node-side unit tests still
 * boot. `import.meta.env.PROD` is a static Vite-replaced boolean, so the
 * hard-fail branches are dead-code-eliminated in dev.
 */
export const ASSET_INTEGRITY_HARD_FAIL = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;

/**
 * An Error tagged `IntegrityError`, the name every caller of these two paths
 * matches on to tell "the bytes are wrong / unpinned" apart from an ordinary
 * network failure.
 *
 * @param {string} message
 * @returns {Error}
 */
export function integrityError(message) {
  const err = new Error(message);
  err.name = 'IntegrityError';
  return err;
}
