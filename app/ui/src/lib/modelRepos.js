// Pure policy for reading the operator's model configuration: parsing the repo
// list for the picker, labelling each entry for the sidebar, resolving a
// `?model=` link to one of them, and normalising the diarization filename
// settings. Kept out of App.jsx (and free of any DOM/CONFIG access) so every
// rule below is unit-testable, which matters because the failure mode of a
// wrong answer here is silent: the app loads a real model and transcribes
// happily, just not the one the visitor asked for, or it quietly abandons the
// local mirror and goes back to HuggingFace for weights it was told to
// self-host.

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
 * Reduce an operator-supplied VITE_DIARIZATION_*_FILE to the bare filename it
 * is contractually supposed to be (docker/env.example documents it as
 * `model.onnx`, not a path).
 *
 * This exists because the value is JOINED under the repo, both on the hub and
 * on a local mirror. A well-meant absolute path such as
 * `/fallback_models/csukuangfj/speaker-embedding-models/model.onnx` was
 * therefore appended WHOLE to the repo prefix, producing a URL that can only
 * ever 404. Nothing then failed loudly: the mirror answered the SPA's index
 * page, the local attempt was written off as "this mirror does not carry the
 * diarization models", and the loader quietly went to huggingface.co instead,
 * which on a network that blocks it means diarization just stops working. A
 * self-hoster reading their own env file sees a path that looks exactly right.
 *
 * So take the basename rather than rejecting: the operator's intent is never
 * ambiguous (they named a real file), and the only reachable place for it is
 * under the repo prefix anyway. A blank or path-only value falls back.
 */
export function diarizationFileName(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  const base = raw.split(/[\\/]/).pop();
  return base || fallback;
}
