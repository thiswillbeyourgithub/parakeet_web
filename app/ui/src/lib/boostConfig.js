// Module-level configuration for phrase boosting (context biasing): the
// sentinels the source selector uses, the defaults the sliders boot at, the
// thresholds that decide when a list is too big to render or slow enough to
// warrant a spinner, and the two pure helpers that name a list and identify a
// trie build.
//
// These live here rather than in App.jsx because both the app shell (the
// sidebar controls, the settings restore, the medical-mode preset) and the
// usePhraseBoost hook that owns the machinery need them, and a second copy of
// a default would mean the app booted at one value and reset to another.

// Default for the global min-p gate override (the "Min-p gate override" knob).
// The value IS the min-p, monotonic in [0, 1]: 0 = boost every candidate (no
// gate), 1 = disabled (only the model's own top token is ever boosted). null
// (a blank field) turns the override off, so each phrase keeps its own baked
// min-p. An earlier default of 0.01 was near-widest so a wanted phrase was not
// silently gated out (the failure mode a strict default produced); the 2026-08
// French-medical 100-cell sweep moved it to 0.1: versus a looser gate it costs
// nothing at boost strengths 0.5-1 (mean CER delta under 0.01, within run
// noise) and guards against insertion storms when the strength is set too
// high (recovering up to ~1.8 CER at strength 4).
export const BOOST_MINP_DEFAULT = 0.1;

// Default for the global boost-strength multiplier (the "Boost strength"
// slider). 1 = apply each phrase's own weight as written; 0 disables boosting
// entirely. Named rather than repeated as a literal because it is asserted in
// four places (initial state, the load default, the restore fallback, and the
// medical-mode preset) and a drifting copy would mean the app booted at one
// strength and reset to another.
export const BOOST_STRENGTH_DEFAULT = 1;

// Sentinel for the boost-phrase source selector meaning "the user's own
// manually-typed text" rather than one of the operator-supplied files. Not a
// valid manifest entry (those all end in .txt), so it can never collide.
export const BOOST_SOURCE_CUSTOM = '__custom__';

// Sentinel for the boost-phrase source selector meaning "boosting is turned
// off". Like the Custom sentinel it is not a valid manifest entry (those end in
// .txt), so it never collides. Selecting it clears the phrase text, which hits
// the empty-phrase fast path in the trie-rebuild effect (no encode, no build),
// so switching to it from a very large curated list is instant.
export const BOOST_SOURCE_DISABLED = '__disabled__';

// Normalise a curated-list name to a manifest entry: manifest entries all end
// in `.txt`, so a bare name (e.g. "medical", as supplied via the
// ?phrase_boost= query param or the VITE_PHRASE_BOOST_DEFAULT env default) gets
// the extension appended. Returns null for an empty/blank value, and passes the
// Custom sentinel through untouched so ?phrase_boost=__custom__ forces manual
// entry. Validation against the actual served files happens later (boost-init),
// so an unknown name simply falls back to Custom rather than erroring.
export function normalizeBoostName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return null;
  if (name === BOOST_SOURCE_CUSTOM) return name;
  if (name === BOOST_SOURCE_DISABLED) return name;
  return name.endsWith('.txt') ? name : `${name}.txt`;
}

// Debounce (ms) before rebuilding the boosting trie after the phrase text
// changes. Pasting or fast-typing a large list (10k-100k phrases) would
// otherwise trigger an encode per keystroke; we wait for the input to settle.
export const BOOST_REBUILD_DEBOUNCE_MS = 300;

// Phrase count past which a rebuild is slow enough to warrant the header
// spinner. Lists below this encode in a few ms, so showing a spinner would
// only flicker; above it the user benefits from knowing to wait.
export const BOOST_SPINNER_MIN_PHRASES = 500;

// Identity of one boost-trie build: exactly the inputs whose change forces a
// rebuild (the phrase text, the depth scaling baked into node bonuses, and the
// vocab the phrases are encoded against). The rebuild effect stamps the key of
// every COMPLETED build into boostBuiltKeyRef; waitForBoostReady() compares it
// against the key expected for the live config to know whether the async
// rebuild has caught up. Strength and min-p are absent by design: they mutate
// the live trie and never need a rebuild.
export const boostBuildKey = (text, depthScaling, vocabSig) =>
  `${vocabSig ?? 'no-vocab'}|${depthScaling}|${text}`;

// Byte cap for a server-prebuilt boost encoding (token ids). Larger than the
// 5 MB text cap because the encoded JSON of a 100k-phrase list is bigger than
// its source text; oversize just falls back to encoding the .txt in-browser.
export const BOOST_PREBUILT_MAX_BYTES = 64 * 1024 * 1024;

// Line count past which a *served* (non-Custom) list is collapsed to a
// read-only summary instead of being dumped into the editable textarea. A
// curated list this large (e.g. a 60k-line medical lexicon) is never hand
// edited, and rendering it in a controlled textarea makes the field scroll and
// the whole sidebar lag (mounting one costs ~1 s for a 75k-line list). The text
// still lives in `boostPhrases` for the rebuild/prebuilt path; we just don't
// render it.
export const BOOST_COLLAPSE_MIN_LINES = 100;

// Line count past which the user's OWN (Custom) text is collapsed the same way,
// behind an explicit "edit anyway" button. Custom text used to be rendered at
// any size on the grounds that the user must be able to edit what they typed,
// but a list this large is pasted, not typed, and mounting the textarea for it
// blocked the main thread for ~1 s on every source switch and every reopen of
// the sidebar section. The threshold is an order of magnitude above the curated
// one so an ordinary hand-written list is never hidden; past it the editor
// becomes lazy (mounted only when asked for), which is the whole point.
export const BOOST_CUSTOM_COLLAPSE_MIN_LINES = 1000;
