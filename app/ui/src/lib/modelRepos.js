// Pure policy for the model-repo picker: parsing the operator's repo list,
// labelling each entry for the sidebar, and resolving a `?model=` link to one
// of them. Kept out of App.jsx (and free of any DOM/CONFIG access) so every
// rule below is unit-testable, which matters because the failure mode of a
// wrong answer here is silent: the app loads a real model and transcribes
// happily, just not the one the visitor asked for.

/** Repo used when the operator configured nothing at all. */
export const DEFAULT_MODEL_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';

// A HuggingFace repo id: `owner/name`, both segments limited to the characters
// HF itself allows. Deliberately the same shape entrypoint.sh validates, so an
// entry the container accepted cannot be dropped here (and vice versa).
const REPO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Parse VITE_MODEL_REPO into the ordered list of repos to offer.
 *
 * Accepts a single repo id (the historical value, still the common case) or a
 * comma-separated list. Order is meaningful: the FIRST entry is the default for
 * a visitor with no saved choice. Blank entries, surrounding whitespace and
 * duplicates are dropped; anything that is not a valid repo id is dropped too,
 * because a malformed entry would otherwise become a picker option that fails
 * at download time with a confusing 404.
 *
 * @param {string|undefined|null} raw The configured value.
 * @returns {string[]} Repo ids, at least one (falls back to DEFAULT_MODEL_REPO).
 */
export function parseModelRepos(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? '').split(',')) {
    const id = part.trim();
    if (!id || !REPO_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : [DEFAULT_MODEL_REPO];
}

/**
 * Short, human-readable label for a repo, for a narrow sidebar row.
 *
 * Strips the owner, the shared `parakeet-tdt-<size>-<version>` stem and the
 * `-onnx` suffix, leaving the part that actually distinguishes one entry from
 * another ('optimized', 'UltiMed'). Original casing is kept: 'UltiMed' is a
 * product name, and lowercasing it would make the picker read as a typo.
 * Falls back to the bare repo name when nothing is left to strip, and to the
 * full id when even that is empty.
 *
 * @param {string} repoId
 * @returns {string}
 */
export function shortRepoLabel(repoId) {
  const name = String(repoId ?? '').split('/').pop() || '';
  const trimmed = name
    .replace(/^parakeet[-_]?tdt[-_]?[\d.]+b[-_]?v\d+[-_]?/i, '')
    .replace(/[-_]?onnx$/i, '')
    .replace(/^[-_]+|[-_]+$/g, '');
  return trimmed || name || String(repoId ?? '');
}

/**
 * Resolve a `?model=` value to one of the offered repos, by closest match.
 *
 * The point of the param is shareable links, so it must tolerate what someone
 * would actually type: `?model=ultimed` rather than the full
 * `Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx`. Matching runs in decreasing
 * order of confidence and stops at the first tier that yields exactly one
 * candidate:
 *
 *   1. exact repo id
 *   2. exact repo name (the part after the owner) or exact short label
 *   3. prefix of the short label
 *   4. substring of the whole repo id
 *
 * An ambiguous tier (two repos matching equally well) is NOT resolved by
 * picking one: the link author meant something specific, and quietly loading a
 * coin-flip model is worse than ignoring the param, so we fall through to the
 * next, stricter-in-practice tier and ultimately return null. Returning null
 * means "no opinion", and the caller keeps the saved/default choice.
 *
 * @param {string|undefined|null} query The raw ?model= value.
 * @param {string[]} repos The offered repo ids (from parseModelRepos).
 * @returns {string|null} The matched repo id, or null when nothing matches.
 */
export function matchModelRepo(query, repos) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !Array.isArray(repos) || repos.length === 0) return null;

  const only = (list) => (list.length === 1 ? list[0] : null);
  const name = (r) => r.split('/').pop().toLowerCase();
  const label = (r) => shortRepoLabel(r).toLowerCase();

  return (
    only(repos.filter(r => r.toLowerCase() === q))
    || only(repos.filter(r => name(r) === q || label(r) === q))
    || only(repos.filter(r => label(r).startsWith(q)))
    || only(repos.filter(r => r.toLowerCase().includes(q)))
    || null
  );
}

/**
 * Decide which repo to load, given everything that can have an opinion.
 *
 * Precedence is the whole point: a `?model=` link overrides the saved setting
 * (that is what makes a link shareable to someone who already used the app),
 * and the saved setting overrides the operator's default. A saved repo that is
 * no longer offered is discarded rather than loaded, so removing an entry from
 * VITE_MODEL_REPO actually takes it out of circulation.
 *
 * @param {object} opts
 * @param {string[]} opts.repos Offered repo ids (from parseModelRepos).
 * @param {string|null} [opts.urlParam] Raw ?model= value, if any.
 * @param {string|null} [opts.saved] Persisted repo id, if any.
 * @returns {{repoId: string, fromUrl: boolean}} The repo to load, and whether
 *   the URL decided it (the caller must not persist a URL-driven choice).
 */
export function resolveModelRepo({ repos, urlParam = null, saved = null }) {
  const offered = Array.isArray(repos) && repos.length ? repos : [DEFAULT_MODEL_REPO];
  const fromUrl = matchModelRepo(urlParam, offered);
  if (fromUrl) return { repoId: fromUrl, fromUrl: true };
  if (saved && offered.includes(saved)) return { repoId: saved, fromUrl: false };
  return { repoId: offered[0], fromUrl: false };
}
