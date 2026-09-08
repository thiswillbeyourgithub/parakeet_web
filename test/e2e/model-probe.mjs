// Where a spec should look for an optional model file, given that the mirror it
// runs against can be laid out either way.
//
// Two layouts are legitimate and both are in daily use:
//   - NESTED, <base>/<repo>/<path>: what scripts/fetch-e2e-models.mjs builds for
//     CI, and what a mount serving several repos must look like (hub.js asks for
//     a repo by name, and refuses an unattributable flat tree once the app
//     offers a choice of models).
//   - FLAT, <base>/<path>: the single-repo LOCAL_MODEL_PATH contract, and what a
//     maintainer's fallback_models checkout has historically been.
//
// The specs that HEAD-probe for optional weights (fp32 shards, the lite int8
// encoder, the diarization pair) must not care which one they got. Hard-coding
// the flat URL made a nested mirror look like MISSING weights, which is the
// worst failure available here: strict-weights turns a missing weight into a
// local FAILURE, so the tier would blame the checkout rather than the probe.
// Hard-coding the nested URL would do the same to every flat checkout.
//
// So probe both, nearest-first, and hand the spec back the URL that answered.
// This deliberately mirrors hub.js resolveLocalModelBase: same order, same
// "either layout is fine" contract, so the harness and the app agree on what
// counts as served.
//
// Agreeing means the flat arm is dropped once the repo HAS a root here, not
// merely ordered after it. hub.js resolves a repo to its own folder and then
// reads only from there, so on a mirror that is both (a repo root AND a flat
// tree, which every maintainer checkout with root symlinks is) a file found
// flat is one the app will never load. The first version of this file missed
// that and reported the lite int8 encoder as served from the flat tree while
// the app, resolving to the repo root that no longer carries it, failed on a
// quant-unavailable banner seven minutes later. A gate that green-lights a run
// the app cannot complete is worse than no gate: it moves the failure far away
// from its cause.
//
// Within a layout the directory is not guessed either: candidatePaths owns the
// "a file's directory is a pure function of its basename" rule (int8/, fp32/,
// int8-lite/, with the root and sharded/ as the historical spellings), and
// serve.mjs already resolves a bare basename through it. Reusing it here is
// what keeps a probe from missing shards that sit in sharded/ rather than
// fp32/, without this file holding an opinion of its own about layout.
//
// Built with Claude Code.

import { candidatePaths, findRepoFile, basenameOf } from '../../app/src/modelLayout.js';
import { LOCAL_MANIFEST_FILE } from '../../app/src/hub.js';

/**
 * The canary hub.js uses to decide a repo has its own root on this mirror.
 *
 * @param {string} repo HuggingFace repo id.
 * @param {string} [base='/models']
 * @returns {string}
 */
export function repoRootUrl(repo, base = '/models') {
  return `${base}/${repo}/vocab.txt`;
}

/**
 * Every URL a file could be served at, in probe order: the nested set for its
 * repo first, then the flat set.
 *
 * `repoRootServed` is what keeps this honest rather than merely tolerant. When
 * the mirror has a root for this repo, hub.js resolves to it and reads ONLY
 * from there, so a copy of the file sitting in the flat tree is not a file the
 * app can load. Reporting it as served is worse than reporting nothing: the
 * spec sails past its weights gate and dies minutes later inside the app, on a
 * quant-unavailable banner that says nothing about the mirror. So with a repo
 * root present the flat candidates are dropped, and the answer is the same one
 * the app will get.
 *
 * @param {string} repo HuggingFace repo id the file belongs to.
 * @param {string} basename File basename (e.g. 'encoder-model.onnx.data.000').
 * @param {object} [opts]
 * @param {string} [opts.base='/models'] Local mirror base.
 * @param {boolean} [opts.repoRootServed=false] Whether repoRootUrl(repo) answers.
 * @returns {string[]}
 */
export function modelProbeUrls(repo, basename, { base = '/models', repoRootServed = false } = {}) {
  const candidates = candidatePaths(basename);
  const nested = candidates.map((p) => `${base}/${repo}/${p}`);
  return repoRootServed ? nested : [...nested, ...candidates.map((p) => `${base}/${p}`)];
}

/**
 * HEAD-probe the layouts and return the first URL that answers, or null.
 *
 * Returns the URL rather than a boolean so a caller that needs the file (not
 * just proof it exists) reads the one that answered instead of rebuilding it
 * and landing on the other layout.
 *
 * The repo-root canary is only paid when the nested candidates all miss, which
 * is exactly when the flat fallback is about to be considered and its honesty
 * is in question.
 *
 * @param {import('@playwright/test').APIRequestContext} request Playwright's `request` fixture.
 * @param {string} repo HuggingFace repo id.
 * @param {string} basename File basename.
 * @param {string} [base='/models']
 * @returns {Promise<string|null>}
 */
export async function probeModelUrl(request, repo, basename, base = '/models') {
  const ok = async (url) => {
    const head = await request.head(url).catch(() => null);
    return !!(head && head.ok());
  };
  // A mirror that declares its own file list is answering the question directly,
  // and the app believes it over any probing, so the harness must too. Skipping
  // this would leave a spec skipping for "missing weights" on a mirror whose
  // manifest names the file and whose app loads it happily: the same harness/app
  // disagreement as the flat-arm bug above, in the other direction.
  // A manifest is the WHOLE answer for the base that has one, not a first
  // guess: hub.js returns it verbatim and never probes behind it, so a file it
  // omits is one the app cannot load however many HEADs would find it.
  const nested = `${base}/${repo}`;
  const declaredNested = await manifestPath(request, nested, basename);
  if (declaredNested !== undefined) return declaredNested && `${nested}/${declaredNested}`;
  for (const url of modelProbeUrls(repo, basename, { base, repoRootServed: true })) {
    if (await ok(url)) return url;
  }
  // Nothing under the repo's own folder. Whether the flat tree may answer for
  // it is the same question hub.js asks, so ask it the same way.
  if (await ok(repoRootUrl(repo, base))) return null;
  const declaredFlat = await manifestPath(request, base, basename);
  if (declaredFlat !== undefined) return declaredFlat && `${base}/${declaredFlat}`;
  for (const url of modelProbeUrls(repo, basename, { base }).filter((u) => !u.includes(`/${repo}/`))) {
    if (await ok(url)) return url;
  }
  return null;
}

/**
 * What a mirror's own manifest says, when it has one.
 *
 * Resolved with findRepoFile, the same call hub.js makes over the same listing,
 * so the harness cannot decide a file is served from somewhere the app would not
 * read it from. Takes the base whose manifest to ask, because a repo-nested
 * mirror and a flat one are separate questions asked at separate points.
 *
 * Three outcomes, and the distinction matters: `undefined` for no usable
 * manifest (probe, as before), a path for one that lists the file, and `null`
 * for one that does not. That last is not the same as "keep looking": the app
 * reads the manifest verbatim, so a file it omits is unreachable no matter what
 * a HEAD would find.
 *
 * @param {import('@playwright/test').APIRequestContext} request Playwright's `request` fixture.
 * @param {string} base Base URL of the repo root to ask (e.g. '/models/owner/repo').
 * @param {string} basename File basename.
 * @returns {Promise<string|null|undefined>} Path relative to `base`, null if the
 *   manifest does not list it, undefined if there is no usable manifest.
 */
async function manifestPath(request, base, basename) {
  const res = await request.get(`${base}/${LOCAL_MANIFEST_FILE}`).catch(() => null);
  if (!res || !res.ok()) return undefined;
  const files = await res.json().catch(() => null);
  if (!Array.isArray(files) || files.length === 0) return undefined;
  return findRepoFile(files, basenameOf(basename));
}
