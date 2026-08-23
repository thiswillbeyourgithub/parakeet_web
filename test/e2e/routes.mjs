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

// The local /models mirror served by serve.mjs, anchored to the loopback origin
// so it can never match a huggingface.co URL that happens to contain /models/.
const LOCAL_MODELS_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/models\//;

/** Serve `files` as the repo's HuggingFace file listing (the /api/... endpoints). */
export async function routeHfRepoListing(page, files) {
  await page.route('**/huggingface.co/api/**', (route) =>
    route.fulfill({ json: files.map((path) => ({ type: 'file', path })) }));
}

/** Abort every HuggingFace *file* download (the listing above still resolves). */
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
 * set), leaving int8 and everything else served normally. That is a
 * model source which cannot serve WebGPU but can serve WASM, which is exactly
 * the deployment the GPU-to-WASM fallback exists for. Routed rather than relying
 * on what `fallback_models` happens to contain, so the premise holds on any box
 * (a developer who ran shard-fp32.py locally would otherwise not reproduce it).
 */
export async function routeLocalMirrorWithoutGpuEncoders(page) {
  await page.route(LOCAL_MODELS_RE, (route) => {
    const url = route.request().url();
    const isGpuEncoder = /\/sharded\/|encoder-model\.onnx\.data\.\d+/.test(url);
    return isGpuEncoder ? route.fulfill({ status: 404, body: 'not found' }) : route.continue();
  });
}
