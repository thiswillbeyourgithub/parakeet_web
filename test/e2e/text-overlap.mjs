// Shared word-overlap helpers for the tier-3 transcription E2E specs. The model's
// output differs trivially from a golden in casing, accents and punctuation, so
// specs compare on a normalised word set rather than exact strings. Centralised
// here so the transcription and chunking specs share one comparison and cannot
// drift.
//
// Built with Claude Code.

// Normalise a transcript to a list of lowercase, accent- and punctuation-free
// words, so the comparison is robust to trivial rendering differences but still
// pins the actual words spoken.
export function words(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Fraction of the words in `a` that also appear somewhere in `b` (0..1). Used as
// overlap(words(golden), words(got)): how much of the expected transcript the
// model actually produced.
export function overlap(a, b) {
  const setB = new Set(b);
  const hit = a.filter((w) => setB.has(w)).length;
  return hit / Math.max(a.length, 1);
}
