// Debug override for where model weights come from: HuggingFace directly, or
// this instance's /models (the HF relay in the docker deployment, a static
// mirror elsewhere).
//
// The operator's VITE_MODEL_SOURCE says what the DEPLOYMENT offers; this
// setting lets someone checking that deployment pin one side of it, because
// in the default 'auto' the relay only serves a load when HuggingFace failed
// or looked unreachable, and on a machine where HuggingFace works the relay
// path is otherwise never exercised at all.
//
//   auto   : the operator's configuration, untouched (the default).
//   force  : every weight through /models, HuggingFace never asked. On a
//            deployment without a relay or mirror the load FAILS, which is the
//            point: it is a check, not a fallback.
//   forbid : HuggingFace only. /models is never touched, not as a fallback,
//            not for the precision-upgrade probe, not for diarization.
//
// Built with Claude Code.

export const RELAY_MODES = Object.freeze(['auto', 'force', 'forbid']);
export const DEFAULT_RELAY_MODE = 'auto';

/**
 * Coerce a stored value to a known mode (anything else is 'auto', so a stale
 * or hand-edited setting can never silently pin a source).
 *
 * @param {unknown} value
 * @returns {'auto'|'force'|'forbid'}
 */
export function normalizeRelayMode(value) {
  return RELAY_MODES.includes(value) ? value : DEFAULT_RELAY_MODE;
}

/**
 * Combine the operator's model source with the debug override.
 *
 * `mirrorAllowed` is separate from `modelSource` because 'hf' alone does not
 * keep a load off /models: the reachability reorder, the precision-upgrade
 * probe and the "offer the local copy" probe all still consult it. Only
 * 'forbid' turns every one of those off.
 *
 * @param {string} configSource 'hf' | 'local' | 'both' (already normalised).
 * @param {unknown} mode The stored relay mode.
 * @returns {{modelSource: 'hf'|'local'|'both', mirrorAllowed: boolean}}
 */
export function resolveModelSourcing(configSource, mode) {
  switch (normalizeRelayMode(mode)) {
    case 'force': return { modelSource: 'local', mirrorAllowed: true };
    case 'forbid': return { modelSource: 'hf', mirrorAllowed: false };
    default: return { modelSource: configSource, mirrorAllowed: true };
  }
}
