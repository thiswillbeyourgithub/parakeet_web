// Pure policy for the auto-coupled beam width default.
//
// The 2026-08 French-medical grid sweep (894 utterances, 100 cells) showed
// beam width and phrase boosting are NOT independent: without a phrase list,
// accuracy DEGRADES monotonically as the beam widens (WER 11.90 -> 12.69 from
// beam 1 to 8, concentrated on term-dense audio where a wider beam has more
// room to pick a fluent-but-wrong reading), while with a phrase list it
// improves monotonically (11.21 -> 9.92). A fixed device-tier default of 5 was
// therefore paying decode cost to get WORSE transcripts for every user with
// no phrase list loaded.
//
// So while the user has never chosen a width themselves, the default follows
// the boost state: greedy (1) with no active phrase list, the device-tier
// default with one. The moment the user edits the width the coupling stops
// (the choice is persisted with a beamWidthAuto=false flag) and their value
// is used unconditionally.
//
// Because usePersistedSetting writes every setting's value back on first
// boot, installs that predate the flag have a beamWidth persisted even though
// the user never touched it. restoreBeamWidthAuto therefore infers: a stored
// width that exactly equals this device's tier default is treated as "never
// chosen" (auto stays on); any other value must have been picked on purpose
// and is honoured. Written with the help of Claude Code.

/**
 * Decide whether the beam width is still auto-coupled to phrase boosting.
 *
 * @param {object} args
 * @param {*} args.savedAuto Persisted beamWidthAuto flag (boolean when the
 *   install has seen this feature; null/undefined on legacy or fresh installs).
 * @param {*} args.savedBeamWidth Persisted beamWidth (any type; null = unset).
 * @param {number} args.deviceDefault This device's tier default width.
 * @returns {boolean} true = keep coupling the width to the boost state.
 */
export function restoreBeamWidthAuto({ savedAuto, savedBeamWidth, deviceDefault }) {
  if (typeof savedAuto === 'boolean') return savedAuto;
  if (!Number.isFinite(savedBeamWidth)) return true; // fresh install: nothing saved yet
  return savedBeamWidth === deviceDefault; // legacy install: tier default = never chosen
}

/**
 * The width the auto mode resolves to.
 *
 * @param {boolean} boostActive A non-empty phrase list with a non-zero strength.
 * @param {number} deviceDefault This device's tier default width.
 * @returns {number} 1 (greedy) without boosting, the tier default with it.
 */
export function resolveAutoBeamWidth(boostActive, deviceDefault) {
  if (!boostActive) return 1;
  return Number.isFinite(deviceDefault) && deviceDefault >= 1 ? deviceDefault : 1;
}
