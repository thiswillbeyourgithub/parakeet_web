// Tier-1 unit test for the grid-level ETA estimator AND the tqdm-style stacked
// progress region in scripts/grid_search_benchmark.mjs. The grid sweep does not
// run at a uniform pace (the first cell pays the one-time preprocess+encode for
// every utterance, then it is cached, and later cells change the beam width), so
// the overall ETA must NOT be a flat elapsed/done average: it has to track the
// current pace and weight the most recent steps. makeEtaEstimator is an
// exponential moving average over per-step durations; these tests pin that
// behaviour with injected timestamps so nothing depends on wall-clock timing.
// renderLiveRegion builds the cursor-addressing bytes that redraw the two
// stacked bars in place; the tests assert that escape-sequence shape without a
// real terminal.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeEtaEstimator, fmtDuration, renderLiveRegion } from '../../scripts/grid_search_benchmark.mjs';

describe('makeEtaEstimator: EMA-smoothed ETA that weights recent steps', () => {
  test('no estimate before the first step is measured (unseeded)', () => {
    const eta = makeEtaEstimator(0.2); // no start seed
    // First call only records "now"; there is no prior to measure a duration.
    assert.ok(Number.isNaN(eta(1000, 5)));
    // Second call: one 100 ms step measured -> 100 ms * 5 remaining = 500 ms.
    assert.equal(eta(1100, 5), 500);
  });

  test('seeding with the grid start yields an estimate on the first step', () => {
    const eta = makeEtaEstimator(0.2, 0); // seeded at t=0
    // First step took 200 ms; 4 remaining -> 800 ms, immediately.
    assert.equal(eta(200, 4), 800);
  });

  test('reacts to a pace change faster than a flat average would', () => {
    // 5 slow steps (1000 ms each) then the pace drops to 100 ms/step. After two
    // fast steps the EMA must already be far below the flat all-time average.
    const alpha = 0.2;
    const eta = makeEtaEstimator(alpha, 0);
    let t = 0;
    for (let i = 0; i < 5; i++) { t += 1000; eta(t, 100); } // EMA ~ 1000 ms/step
    t += 100; const after1 = eta(t, 1); // one fast step
    t += 100; const after2 = eta(t, 1); // two fast steps
    // The flat all-time average per step here is (5*1000 + 2*100)/7 ~= 743 ms.
    const flatAvg = (5 * 1000 + 2 * 100) / 7;
    // EMA after two fast steps must be well under the flat average: it is
    // following the new, faster pace instead of staying anchored to the slow run.
    assert.ok(after2 < flatAvg, `EMA ${after2} should be < flat avg ${flatAvg}`);
    // And it keeps dropping as more fast steps confirm the new pace.
    assert.ok(after2 < after1, `EMA should keep falling: ${after2} < ${after1}`);
  });

  test('a constant pace converges to the true per-step time', () => {
    const eta = makeEtaEstimator(0.5, 0);
    let t = 0, last = NaN;
    for (let i = 0; i < 50; i++) { t += 250; last = eta(t, 1); } // 250 ms/step, 1 left
    // With a steady 250 ms/step the EMA (1 remaining) settles on ~250 ms.
    assert.ok(Math.abs(last - 250) < 1e-6, `expected ~250, got ${last}`);
  });

  test('higher alpha weights the most recent step more', () => {
    // Same history (slow then one fast step); a higher alpha drops faster.
    const run = (alpha) => {
      const eta = makeEtaEstimator(alpha, 0);
      let t = 0;
      for (let i = 0; i < 3; i++) { t += 1000; eta(t, 1); }
      t += 100; return eta(t, 1);
    };
    assert.ok(run(0.4) < run(0.1), 'higher alpha should react more to the recent fast step');
  });

  test('clamps a negative time delta to zero (clock going backwards)', () => {
    const eta = makeEtaEstimator(1.0, 0); // alpha=1 => "use only the last step"
    eta(1000, 1);              // first step: 1000 ms
    const v = eta(500, 3);     // "now" < previous: dt clamped to 0
    assert.equal(v, 0);        // 0 ms/step * 3 remaining
  });

  test('NaN ETA renders as the placeholder duration', () => {
    const eta = makeEtaEstimator(0.2); // unseeded
    assert.equal(fmtDuration(eta(0, 5)), '--:--');
  });
});

describe('renderLiveRegion: in-place redraw of the stacked progress bars', () => {
  const UP = (n) => `\x1b[${n}A`; // cursor up n lines
  const CLR = '\x1b[2K\r';        // clear whole line, return to column 0

  test('first draw (prevCount 0) does not move the cursor up', () => {
    const out = renderLiveRegion(['run bar', 'grid bar'], 0);
    assert.ok(!/\x1b\[\d+A/.test(out), 'no cursor-up escape at all on the first draw');
    // Both lines are cleared+written and the block ends on a fresh line below.
    assert.equal(out, `${CLR}run bar\n${CLR}grid bar\n`);
  });

  test('a redraw moves up exactly prevCount lines before rewriting', () => {
    const out = renderLiveRegion(['run bar 2', 'grid bar 2'], 2);
    assert.equal(out, `${UP(2)}${CLR}run bar 2\n${CLR}grid bar 2\n`);
  });

  test('each line is cleared (\\x1b[2K\\r) so a shorter line cannot leave a tail', () => {
    const out = renderLiveRegion(['short', 'x'], 2);
    // Every line must be preceded by the clear-line + carriage-return sequence.
    const clears = out.split(CLR).length - 1;
    assert.equal(clears, 2, 'both lines are individually cleared before rewrite');
  });

  test('the block always ends on a fresh line below (trailing newline)', () => {
    assert.ok(renderLiveRegion(['a', 'b'], 0).endsWith('\n'));
    assert.ok(renderLiveRegion(['a', 'b'], 2).endsWith('\n'));
  });

  test('supports an arbitrary line count (not hard-coded to two)', () => {
    const out = renderLiveRegion(['l1', 'l2', 'l3'], 3);
    assert.equal(out, `${UP(3)}${CLR}l1\n${CLR}l2\n${CLR}l3\n`);
  });
});
