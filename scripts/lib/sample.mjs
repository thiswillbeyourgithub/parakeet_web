// Deterministic sampling helpers shared by the dataset/fixture generators
// (`scripts/gen-fleurs-fixtures.mjs`, `scripts/gen-medical-val-sets.mjs`).
//
// A given seed must reproduce the same sample forever: these sets are committed
// or benchmarked against, so "regenerate it" has to be a no-op when nothing
// changed. That rules out Math.random, hence the explicit PRNG.
//
// Built with Claude Code.

// mulberry32: 32-bit, seedable, no state beyond one integer. Good enough for
// picking clips out of a manifest (we are not doing cryptography here).
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates on a copy, driven by the supplied rng.
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
