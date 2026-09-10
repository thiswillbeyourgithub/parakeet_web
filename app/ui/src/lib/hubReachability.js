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
//  2. The reorder is REVERSIBLE. Callers retry against HF when the local
//     attempt fails, mirroring the HF -> local retry that already existed, so a
//     false negative (an extension blocking the probe on a machine where HF
//     works) costs one fast same-origin miss and nothing else. This is what
//     replaced an earlier, stricter rule that only went local-first once
//     `/models` had been verified to hold the repo: on a network that really
//     does block HF, that check gated the whole feature behind a mirror probe
//     that is easy to miss, while the failure it guarded against cannot happen
//     (if HF is unreachable, the HF attempt was never going to succeed either).
//  3. It only ever changes the ORDER of two sources that were both going to be
//     tried. Nothing is skipped, so no load that used to work can stop working.
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
 * It used to demand a second condition: that `/models` had been VERIFIED to
 * hold this repo, on the reasoning that reordering on an uncertain answer would
 * trade a slow success for a fast failure. That reasoning does not survive
 * contact with the case this module exists for. When the probe has come back
 * negative, the HuggingFace attempt cannot succeed either, so there is no slow
 * success left to protect: both orders end in failure, and the local-first one
 * fails in milliseconds against a same-origin 404 instead of waiting out a
 * connect timeout. Meanwhile the extra condition made the whole feature
 * conditional on a mirror check that is easy to miss (a mount serving a
 * different repo, a layout the probe cannot attribute), which is precisely how
 * a deployment on a network that blocks HuggingFace still spent every load
 * talking to HuggingFace.
 *
 * What keeps this safe is not the check, it is that the reorder is REVERSIBLE:
 * callers retry against HuggingFace when the local attempt fails, mirroring the
 * HF -> local retry that already existed. So a false negative (an extension
 * blocking the probe on a machine where HuggingFace works fine) costs one fast
 * local miss, not a failed load.
 *
 * @param {object} args
 * @param {string} args.modelSource 'hf' | 'local' | 'both'.
 * @param {boolean|null} args.hubReachable Probe result, null while unknown.
 * @returns {boolean} true to start local, false to behave exactly as before.
 */
export function preferLocalFirst({ modelSource, hubReachable } = {}) {
  // 'local' already skips HF, so there is nothing to reorder and saying "yes"
  // here would only make the caller's intent harder to read.
  if (modelSource === 'local') return false;
  // Only a definite negative changes anything: an unanswered probe leaves the
  // ordinary HuggingFace-first path running untouched.
  return hubReachable === false;
}
