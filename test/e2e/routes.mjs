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

// Whether a path names an encoder only a GPU can run. Written to match a full
// URL and a bare repo-relative manifest entry alike (hence the `^` alternative
// on the directory), because both spellings of the same file have to disappear
// together for routeLocalMirrorWithoutGpuEncoders to be honest.
const GPU_ENCODER_RE = /(?:^|\/)(?:fp32|sharded)\/|encoder-model\.onnx\.data\.\d+/;
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
 * 404 only the GPU-runnable encoder layout in the local mirror (the fp32 shard
 * set and the graph that points at it), leaving int8 and everything else served
 * normally. That is a model source which cannot serve WebGPU but can serve WASM,
 * which is exactly the deployment the GPU-to-WASM fallback exists for. Routed
 * rather than relying on what `fallback_models` happens to contain, so the
 * premise holds on any box (a developer who sharded the fp32 encoder locally
 * would otherwise not reproduce it).
 *
 * The pattern has to cover BOTH directories the shards may live in: `fp32/` in
 * the current layout (app/src/modelLayout.js) and `sharded/` in the layout the
 * optimized repo published before the move. Matching only `sharded/` would let
 * a nested mirror serve fp32 after all, and the spec would quietly stop testing
 * the fallback.
 */
export async function routeLocalMirrorWithoutGpuEncoders(page) {
  await page.route(LOCAL_MODELS_RE, async (route) => {
    const url = route.request().url();
    // A mirror that ships model-manifest.json is BELIEVED over any probing
    // (hub.js reads it verbatim and never HEADs behind it), so 404-ing the
    // shard files is no longer enough on its own: the manifest would still
    // announce them, resolveModelQuant would find a servable fp32 shard set,
    // and the spec's premise (a source with no GPU-runnable encoder) would
    // quietly evaporate. That is exactly how this spec broke the day the
    // maintainer mirror grew a manifest. So describe the mirror the same way
    // through both discovery paths: hand back its own listing with the GPU
    // encoders removed.
    if (url.endsWith(`/${MANIFEST_FILE}`)) {
      const res = await route.fetch().catch(() => null);
      const files = res && res.ok() ? await res.json().catch(() => null) : null;
      if (!Array.isArray(files)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ json: files.filter((f) => !isGpuEncoderPath(f)) });
    }
    return isGpuEncoderPath(url) ? route.fulfill({ status: 404, body: 'not found' }) : route.continue();
  });
}
