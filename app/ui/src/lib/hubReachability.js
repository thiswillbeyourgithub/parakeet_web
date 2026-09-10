// Background preflight: is HuggingFace reachable from this machine at all?
//
// The problem it solves. With the default `VITE_MODEL_SOURCE=hf`, a load starts
// by talking to huggingface.co and only falls back to the instance's own
// `/models` mirror once that attempt has FAILED. On a normal network that costs
// nothing. On a locked-down one (a hospital or lab that blackholes outbound
// traffic rather than refusing it) the failure is not a refusal but a stall: the
// browser waits out its own connect timeout before anything else can happen, so
// the visitor stares at a dead progress bar for the length of a TCP timeout
// before the local weights they already have start downloading.
//
// The whole point is that the answer is known BEFORE the button is pressed, so
// the check runs in the background from page load and its result is only ever
// used to REORDER two sources that were both going to be tried anyway.
//
// Three rules keep it from being able to make anything worse:
//
//  1. Unknown means "behave exactly as before". The probe never gates a load;
//     if it has not answered yet, or it errored in some way we did not predict,
//     the ordinary HF-first path runs untouched.
//  2. A negative only counts when the local mirror is VERIFIED to hold the
//     files. Going local-first on a machine with no local weights would trade a
//     slow success for a fast failure.
//  3. The existing HF -> local retry stays exactly as it is. This is an
//     optimisation layered on top, not a replacement, so a false negative (an
//     extension blocking the probe on a machine where HF actually works) costs
//     nothing beyond loading from a mirror that was already good enough.
//
// Built with Claude Code.

// What to ask for, and why it is an API URL rather than something cheaper.
//
// The obvious probe is a static asset (huggingface.co/favicon.ico) fetched
// `no-cors`, since the only bit wanted is "did the request complete". That
// probe is BROKEN here, and silently so: this app ships
// `Cross-Origin-Embedder-Policy: require-corp` (it needs SharedArrayBuffer for
// WASM threads), and under require-corp a cross-origin no-cors response is
// blocked unless it carries `Cross-Origin-Resource-Policy`. huggingface.co
// sends no CORP header on its static assets, so that fetch rejects on a
// perfectly healthy network and EVERY visitor would be told HuggingFace is
// unreachable. A CORS-mode request is exempt: a response that passes the CORS
// check satisfies COEP as well.
//
// So the probe asks the HF **API**, which echoes the requesting Origin in
// `Access-Control-Allow-Origin`. That also happens to be the better question:
// what a load depends on is the API answering, not a CDN asset existing.
// (Verified 2026-09-10: /favicon.ico returns no CORP header; /api/models/<repo>
// returns `access-control-allow-origin: <this app's origin>`.)
export const HUB_API_ORIGIN = 'https://huggingface.co';

/**
 * The URL the preflight asks for. Repo-scoped when a repo is known, so the
 * probe exercises the very endpoint the load will use; the bare collection
 * endpoint otherwise. Any answer at all (200, 401, 404) proves reachability.
 *
 * @param {string} [repoId] e.g. 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx'.
 * @returns {string}
 */
export function hubProbeUrl(repoId) {
  const base = `${HUB_API_ORIGIN}/api/models`;
  return repoId ? `${base}/${repoId}` : base;
}

// How long to wait before calling it unreachable. Comfortably above any healthy
// round trip and far below the browser connect timeout this exists to dodge;
// being wrong in the impatient direction is safe, because rule 2 above means the
// worst case is loading from a local mirror that has the files anyway.
export const HUB_PROBE_TIMEOUT_MS = 4000;

/**
 * Probe whether the HuggingFace API answers at all.
 *
 * `mode: 'cors'` on purpose, see the note on HUB_API_ORIGIN above: under COEP
 * require-corp the "cheap" opaque no-cors probe is blocked by the browser and
 * would report every network as blocked. HEAD keeps the body off the wire and,
 * like GET, is CORS-safelisted, so no preflight OPTIONS is added.
 *
 * The response is not inspected: a 401 or 404 still answers the only question
 * asked here (can this machine reach HuggingFace), whereas reading `ok` would
 * report a renamed repo as a dead network.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] Injected for tests.
 * @param {string} [opts.repoId] Repo to scope the probe URL to.
 * @param {string} [opts.url] Override the probed URL outright.
 * @param {number} [opts.timeoutMs] Abort after this long.
 * @returns {Promise<boolean>} true when the host answered, false on any error,
 *   abort or timeout. Never throws: an unusable answer is just "not reachable".
 */
export async function probeHubReachable({
  fetchImpl,
  repoId,
  url = hubProbeUrl(repoId),
  timeoutMs = HUB_PROBE_TIMEOUT_MS,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    await doFetch(url, {
      method: 'HEAD',
      mode: 'cors',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    return true;
  } catch {
    // Includes the CORS-failure case, which a browser makes indistinguishable
    // from a network failure on purpose. Calling it unreachable is safe: rule 2
    // means the only consequence is preferring a local mirror that has the
    // files anyway.
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Decide whether a load should go straight to the local mirror and skip the
 * HuggingFace attempt entirely.
 *
 * @param {object} args
 * @param {string} args.modelSource 'hf' | 'local' | 'both'.
 * @param {boolean|null} args.hubReachable Probe result, null while unknown.
 * @param {boolean|null} args.localReachable Whether `/models` verifiably holds
 *   this repo's files, null while unknown.
 * @returns {boolean} true to start local, false to behave exactly as before.
 */
export function preferLocalFirst({ modelSource, hubReachable, localReachable } = {}) {
  // 'local' already skips HF, so there is nothing to reorder and saying "yes"
  // here would only make the caller's intent harder to read.
  if (modelSource === 'local') return false;
  // Rule 1: only a definite negative changes anything.
  if (hubReachable !== false) return false;
  // Rule 2: and only when the local mirror can actually serve the load.
  return localReachable === true;
}
