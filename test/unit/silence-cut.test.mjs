// Tier-1 unit test for the diarization silence-excision helpers
// (app/ui/src/lib/silenceCut.js) and the dense energy profile they rely on
// (createEnergySampler.hopProfile in app/src/parakeet.js). Pure logic: no model,
// no DOM. Synthetic 16 kHz-style PCM is built from sine bursts (speech) separated
// by near-zero runs (silence).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findSilenceCuts,
  excisePcm,
  remapSegments,
  DEFAULT_MIN_SILENCE_SEC,
} from '../../app/ui/src/lib/silenceCut.js';
import { createEnergySampler } from '../../app/src/parakeet.js';

const SR = 1000; // 1 kHz keeps the arrays small; every conversion is rate-relative.

// Fill [from, to) of `buf` with a sine burst of the given amplitude.
function fillSine(buf, from, to, amp = 0.5, freq = 100) {
  for (let i = from; i < to; i += 1) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
}

// speech(1s) | silence(sil s) | speech(1s)
function makeGapped(silenceSec) {
  const s = SR; // 1 s of speech
  const gap = Math.round(silenceSec * SR);
  const buf = new Float32Array(s + gap + s);
  fillSine(buf, 0, s);
  // silence stays exactly 0
  fillSine(buf, s + gap, s + gap + s);
  return buf;
}

describe('createEnergySampler.hopProfile', () => {
  test('block-prefix energies equal a direct block-aligned mean-square', () => {
    // Non-trivial signal so blocks differ.
    const n = 5000;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i += 1) pcm[i] = Math.sin(i * 0.013) * (0.2 + (i % 97) / 200);
    const hop = Math.max(1, Math.round(0.010 * SR)); // 10 samples
    const sampler = createEnergySampler(pcm, SR);
    const { energies, hopSamples, count } = sampler.hopProfile(hop);
    assert.equal(hopSamples, hop);
    assert.equal(count, energies.length);

    // Reference: recompute each hop's block-aligned window mean-square directly.
    const energyWindow = Math.max(1, Math.round(0.15 * SR));
    const windowHops = Math.max(1, Math.round(energyWindow / hop));
    const half = windowHops >> 1;
    const nHops = Math.max(1, Math.ceil(n / hop));
    for (let h = 0; h < nHops; h += 1) {
      const lo = Math.max(0, h - half);
      const hi = Math.min(nHops, lo + windowHops);
      let s = 0;
      const a = lo * hop;
      const b = Math.min(n, hi * hop);
      for (let k = a; k < b; k += 1) s += pcm[k] * pcm[k];
      const ref = s / Math.max(1, b - a);
      assert.ok(Math.abs(energies[h] - ref) < 1e-9, `hop ${h}: ${energies[h]} vs ${ref}`);
    }
  });

  test('energyAt stays the exact byte-identical closure', () => {
    const pcm = new Float32Array(3000);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin(i * 0.02) * 0.3;
    const { energyAt } = createEnergySampler(pcm, SR);
    const energyWindow = Math.max(1, Math.round(0.15 * SR));
    const energyHalf = energyWindow >> 1;
    for (const i of [0, 1, 137, 1500, 2999]) {
      const a = Math.max(0, i - energyHalf);
      const b = Math.min(pcm.length, a + energyWindow);
      let s = 0;
      for (let k = a; k < b; k += 1) s += pcm[k] * pcm[k];
      assert.equal(energyAt(i), s / Math.max(1, b - a));
    }
  });
});

describe('findSilenceCuts', () => {
  test('finds the one long silence, inside the true silent region', () => {
    const pcm = makeGapped(3.0); // 1s speech | 3s silence | 1s speech
    const cuts = findSilenceCuts(pcm, SR);
    assert.equal(cuts.length, 1);
    const c = cuts[0];
    // The excised run sits strictly inside the real silence [1000, 4000).
    assert.ok(c.start > 1000 && c.start < 2000, `start ${c.start}`);
    assert.ok(c.end < 4000 && c.end > 3000, `end ${c.end}`);
    assert.ok(c.end > c.start);
  });

  test('does not cut a silence shorter than minSilenceSec', () => {
    const pcm = makeGapped(1.0); // 1 s gap < 2 s default
    assert.deepEqual(findSilenceCuts(pcm, SR), []);
  });

  test('pads are honored exactly: only the pad changes when padSec changes', () => {
    const pcm = makeGapped(3.0);
    const small = findSilenceCuts(pcm, SR, { padSec: 0.35 });
    const large = findSilenceCuts(pcm, SR, { padSec: 0.5 });
    assert.equal(small.length, 1);
    assert.equal(large.length, 1);
    // Same detected run, so the excised span shrinks by exactly the pad delta on
    // each edge (independent of energy-window smearing).
    const delta = Math.round((0.5 - 0.35) * SR); // 150 samples
    assert.equal(large[0].start - small[0].start, delta);
    assert.equal(small[0].end - large[0].end, delta);
  });

  test('all-speech yields no cuts; all-silence yields one big cut', () => {
    const speech = new Float32Array(3 * SR);
    fillSine(speech, 0, speech.length);
    assert.deepEqual(findSilenceCuts(speech, SR), []);

    const silence = new Float32Array(3 * SR); // all zeros
    const cuts = findSilenceCuts(silence, SR);
    assert.equal(cuts.length, 1);
    assert.ok(cuts[0].end > cuts[0].start);
  });

  test('empty / degenerate input is safe', () => {
    assert.deepEqual(findSilenceCuts(new Float32Array(0), SR), []);
    assert.deepEqual(findSilenceCuts(null, SR), []);
  });
});

describe('excisePcm', () => {
  test('no cuts: returns the same buffer and an identity map', () => {
    const pcm = new Float32Array([1, 2, 3, 4]);
    const { pcm: out, map } = excisePcm(pcm, []);
    assert.equal(out, pcm);
    assert.deepEqual(map, [{ condStart: 0, origStart: 0, length: 4 }]);
  });

  test('condensed length equals the sum of kept spans; map is contiguous', () => {
    const pcm = new Float32Array(5000);
    fillSine(pcm, 0, 5000, 0.4);
    const cuts = [{ start: 1000, end: 3000 }]; // remove 2000 samples
    const { pcm: out, map } = excisePcm(pcm, cuts, SR);
    assert.equal(out.length, 5000 - 2000);
    const kept = map.reduce((s, m) => s + m.length, 0);
    assert.equal(kept, out.length);
    // Contiguous in condensed space.
    let expect = 0;
    for (const m of map) { assert.equal(m.condStart, expect); expect += m.length; }
    assert.deepEqual(map, [
      { condStart: 0, origStart: 0, length: 1000 },
      { condStart: 1000, origStart: 3000, length: 2000 },
    ]);
  });

  test('splice fade tapers the join toward zero but does not change length', () => {
    const pcm = new Float32Array(4000);
    fillSine(pcm, 0, 4000, 0.5);
    const { pcm: out } = excisePcm(pcm, [{ start: 1000, end: 3000 }], SR);
    assert.equal(out.length, 2000);
    // The last sample before the join (index 999) is scaled by 1/(fade+1) ~ small.
    // Compare to the un-excised amplitude at the same original sample (999).
    assert.ok(Math.abs(out[999]) < Math.abs(pcm[999]) + 1e-9);
    assert.ok(Math.abs(out[999]) <= Math.abs(pcm[999]));
  });
});

describe('remapSegments', () => {
  const map = [
    { condStart: 0, origStart: 0, length: 1000 },
    { condStart: 1000, origStart: 3000, length: 1000 },
  ];

  test('segment fully inside a kept span maps by that span offset', () => {
    const out = remapSegments([{ start: 0.1, end: 0.5, speaker: 0 }], map, SR);
    assert.equal(out.length, 1);
    assert.ok(Math.abs(out[0].start - 0.1) < 1e-9);
    assert.ok(Math.abs(out[0].end - 0.5) < 1e-9);
    assert.equal(out[0].speaker, 0);

    const out2 = remapSegments([{ start: 1.2, end: 1.8, speaker: 1 }], map, SR);
    assert.equal(out2.length, 1);
    assert.ok(Math.abs(out2[0].start - 3.2) < 1e-9); // 3000 + 200 samples
    assert.ok(Math.abs(out2[0].end - 3.8) < 1e-9);
  });

  test('a joint-crossing segment is SPLIT, never inflated across the gap', () => {
    const out = remapSegments([{ start: 0.9, end: 1.1, speaker: 2 }], map, SR);
    assert.equal(out.length, 2);
    // span0 part: [0.9, 1.0]
    assert.ok(Math.abs(out[0].start - 0.9) < 1e-9);
    assert.ok(Math.abs(out[0].end - 1.0) < 1e-9);
    // span1 part: cond [1.0,1.1] -> orig [3.0, 3.1]
    assert.ok(Math.abs(out[1].start - 3.0) < 1e-9);
    assert.ok(Math.abs(out[1].end - 3.1) < 1e-9);
    // No output segment spans the excised gap.
    for (const s of out) assert.ok(s.end - s.start < 0.25);
  });

  test('identity map / empty inputs round-trip', () => {
    const identity = [{ condStart: 0, origStart: 0, length: 10000 }];
    const segs = [{ start: 1, end: 2, speaker: 0 }, { start: 3, end: 4, speaker: 1 }];
    const out = remapSegments(segs, identity, SR);
    assert.deepEqual(out, segs);
    assert.deepEqual(remapSegments([], map, SR), []);
  });

  test('durations are preserved and monotonic inside a kept span', () => {
    const segs = [{ start: 1.0, end: 1.3, speaker: 0 }, { start: 1.5, end: 1.9, speaker: 1 }];
    const out = remapSegments(segs, map, SR);
    assert.equal(out.length, 2);
    for (let i = 0; i < segs.length; i += 1) {
      assert.ok(Math.abs((out[i].end - out[i].start) - (segs[i].end - segs[i].start)) < 1e-9);
    }
    assert.ok(out[0].end <= out[1].start);
  });
});

// Sanity anchor so the default constant does not silently drift.
test('minSilence default is 2 s', () => assert.equal(DEFAULT_MIN_SILENCE_SEC, 2.0));
