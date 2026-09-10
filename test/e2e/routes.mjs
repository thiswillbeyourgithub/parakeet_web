// Shared network-routing helpers for the tier-3 E2E specs that exercise the
// "requested quant cannot be served by any source" guard. Centralised here for
// the same reason as seed.mjs: the no-downgrade specs used to carry a verbatim
// copy of this block each, and the copies shared a subtle bug (below).
//
// THE BUG THIS FIXES. The local-mirror route used to be the glob
// '**/models/**'. A HuggingFace repo listing is
// https://huggingface.co/api/models/<owner>/<repo>/tree/main, which also
// contains '/models/', so that glob matched it too. Playwright resolves
// overlapping route handlers most-recently-registered-first
// (`this._routes.unshift(...)`), and the '**/models/**' route was registered
// last, so it SHADOWED the HF listing route and 404'd the listing. The specs
// then silently tested "the repo listing is unreachable" instead of the
// documented "the repo lists a file set that lacks the requested variant".
// Anchoring the local route to the loopback origin removes the overlap, so
// registration order no longer matters.
//
// Built with Claude Code.

import { MANIFEST_FILE } from '../../scripts/model-manifest.mjs';

// The local /models mirror served by serve.mjs, anchored to the loopback origin
// so it can never match a huggingface.co URL that happens to contain /models/.
const LOCAL_MODELS_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/models\//;

// Whether a path names an encoder a GPU can run. Written to match a full URL
// and a bare repo-relative manifest entry alike (hence the `^` alternative on
// the directory), because both spellings of the same file have to disappear
// together for routeLocalMirrorWithoutGpuEncoders to be honest.
//
// EVERY GPU-runnable precision has to be in here, not just fp32. The app now
// answers a precision this source cannot serve by trying the next precision on
// the SAME backend before it considers changing backend (App.jsx's
// QuantUnavailableError catch, via nextGpuEncoderQuant), which is what a
// visitor wants: keep the GPU, change the file. That behaviour also means a
// mirror still serving w4a8 or fp16 is NOT a source that cannot serve WebGPU,
// so hiding fp32 alone would leave the fallback spec passing while testing a
// GPU-to-GPU substitution instead of the GPU-to-WASM fallback it is named for.
const GPU_ENCODER_RE =
  /(?:^|\/)(?:fp32|sharded|w4a8|fp16)\/|encoder-model\.onnx\.data\.\d+|encoder-model\.(?:w4a8|fp16)\.onnx/;
const isGpuEncoderPath = (path) => GPU_ENCODER_RE.test(path);

/** Serve `files` as the repo's HuggingFace file listing (the /api/... endpoints). */
export async function routeHfRepoListing(page, files) {
  await page.route('**/huggingface.co/api/**', (route) =>
    route.fulfill({ json: files.map((path) => ({ type: 'file', path })) }));
}

/**
 * Abort every HuggingFace *file* download (the listing above still resolves).
 *
 * The listing route is what keeps the background reachability preflight
 * (lib/hubReachability.js) happy: it probes `/api/models/<repo>`, so a spec
 * that fulfils the API while aborting the weights simulates exactly what it
 * means to (a HuggingFace that answers but cannot serve this load), and the
 * app does not switch to a local-first path the spec never meant to exercise.
 */
export async function abortHfDownloads(page) {
  await page.route(
    /https:\/\/(huggingface\.co|cdn-lfs[^/]*\.huggingface\.co)\/(?!api\/).*/,
    (route) => route.abort(),
  );
}

/** 404 every local /models probe, so the local auto-upgrade cannot rescue the load. */
export async function routeNoLocalMirror(page) {
  await page.route(LOCAL_MODELS_RE, (route) =>
    route.fulfill({ status: 404, body: 'not found' }));
}

/**
 * 404 every GPU-runnable encoder layout in the local mirror (the fp32 shard set
 * and the graph that points at it, plus the w4a8 and fp16 single files),
 * leaving int8 and everything else served normally. That is a model source
 * which cannot serve WebGPU at all but can serve WASM, which is exactly the
 * deployment the GPU-to-WASM fallback exists for. Routed rather than relying on
 * what `fallback_models` happens to contain, so the premise holds on any box (a
 * developer who sharded the fp32 encoder locally would otherwise not reproduce
 * it).
 *
 * The pattern has to cover BOTH directories the fp32 shards may live in:
 * `fp32/` in the current layout (app/src/modelLayout.js) and `sharded/` in the
 * layout the optimized repo published before the move. Matching only `sharded/`
 * would let a nested mirror serve fp32 after all, and the spec would quietly
 * stop testing the fallback. The same reasoning is why w4a8 and fp16 are hidden
 * too: see the note on GPU_ENCODER_RE.
 */
export async function routeLocalMirrorWithoutGpuEncoders(page) {
  await routeLocalMirrorHiding(page, isGpuEncoderPath);
}

// Whether a path names the fp16 encoder, the one precision the maintainer's own
// mirror does not carry. Used by routeLocalMirrorWithoutFp16 below.
const isFp16EncoderPath = (path) => /(?:^|\/)fp16\/|encoder-model\.fp16\.onnx/.test(path);

/**
 * 404 only the fp16 encoder in the local mirror, leaving every other precision
 * (fp32 shards included) served normally. This is the deployment the maintainer
 * actually runs: a mirror built from the optimized repo's fp32/int8/w4a8 files,
 * with no fp16 in it, behind a network that blocks HuggingFace, so the mirror is
 * the ONLY source. A GPU there can run fp16 perfectly well and the source simply
 * has no fp16 file to hand it, which is a different condition from "your GPU
 * lacks shader-f16" and has to be reported as one.
 */
export async function routeLocalMirrorWithoutFp16(page) {
  await routeLocalMirrorHiding(page, isFp16EncoderPath);
}

/**
 * Serve a made-up local mirror that holds exactly `files` and nothing else.
 *
 * Where routeLocalMirrorWithoutGpuEncoders SUBTRACTS from whatever the box
 * happens to have, this one states the whole file set, which is what a spec
 * about the PRECISION RADIOS needs: those radios are decided entirely by the
 * source listing, so a spec that has to be model-free and identical on every
 * machine (CI has no weights at all, a developer box may have any subset) has to
 * supply the listing rather than subtract from an unknown one. Nothing is
 * downloaded, so the files need no bytes behind them: the canary HEAD that
 * resolveLocalModelBase uses gets a body, everything else answers empty.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} files Repo-relative paths, as model-manifest.json lists them.
 */
export async function routeSyntheticLocalMirror(page, files) {
  await page.route(LOCAL_MODELS_RE, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/${MANIFEST_FILE}`)) return route.fulfill({ json: files });
    // Anchored on the trailing path so both layouts resolve: `/models/vocab.txt`
    // (flat) and `/models/<owner>/<repo>/vocab.txt` (nested).
    if (files.some((f) => path.endsWith(`/${f}`))) {
      return route.fulfill({ status: 200, body: 'x', contentType: 'application/octet-stream' });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
}

/**
 * Shared core: serve the local mirror as-is except for the files `hide` names,
 * which disappear from BOTH discovery paths.
 *
 * Both paths, because a mirror that ships model-manifest.json is BELIEVED over
 * any probing (hub.js reads it verbatim and never HEADs behind it), so 404-ing
 * the bytes is not enough on its own: the manifest would still announce the
 * files, resolveModelQuant would find them servable, and the caller's premise (a
 * source that cannot serve some precision) would quietly evaporate. That is
 * exactly how the GPU fallback spec broke the day the maintainer mirror grew a
 * manifest. So describe the mirror the same way through both paths: hand back
 * its own listing with the hidden files removed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(path: string) => boolean} hide Matches full URLs and bare
 *   repo-relative manifest entries alike, since it is asked both questions.
 */
async function routeLocalMirrorHiding(page, hide) {
  await page.route(LOCAL_MODELS_RE, async (route) => {
    const url = route.request().url();
    if (url.endsWith(`/${MANIFEST_FILE}`)) {
      const res = await route.fetch().catch(() => null);
      const files = res && res.ok() ? await res.json().catch(() => null) : null;
      if (!Array.isArray(files)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ json: files.filter((f) => !hide(f)) });
    }
    return hide(url) ? route.fulfill({ status: 404, body: 'not found' }) : route.continue();
  });
}
