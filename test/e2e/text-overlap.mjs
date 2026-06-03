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

// Word Error Rate = (substitutions + deletions + insertions) / reference words,
// via word-level Levenshtein distance between the normalised reference and
// hypothesis. Unlike overlap(), WER is order- and count-sensitive, so it catches
// content that a chunk silently drops (the failure mode the int8 encoder shows
// past ~20 s). Can exceed 1 when the hypothesis inserts more than the reference
// holds. Pass already-normalised word arrays (words(ref), words(hyp)).
export function wer(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return m === 0 ? 0 : 1;
  // Rolling two-row edit-distance table to stay O(min) in memory.
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / n;
}
