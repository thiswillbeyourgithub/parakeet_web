// Tier-1 unit test for the TDT beam decoder (app/src/parakeet.js) and its pure
// helpers. No ONNX/model download is needed: we borrow the prototype methods
// onto a stub `model` and mock _runCombinedStep with a scripted, context-free
// joiner (logits depend only on the frame index, encoded into the fake encoder
// tensor). That makes greedy globally optimal, so beam search of ANY width must
// reproduce the greedy output exactly. We then check that phrase boosting steers
// the beam.
//
// Migrated from scripts/test-beam-decode.mjs to node:test. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel } from '../../app/src/parakeet.js';
import { BoostingTrie } from '../../app/src/phraseBoost.js';

const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const eqFloatArr = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => close(v, b[i], eps));

const V = 6;        // vocab size (token ids 0..4, blank = 5)
const BLANK = 5;
const D = 2;        // fake encoder feature dim

// Counters wired into the stub so we can assert leak-safety.
let statesCreated = 0;
let statesDisposed = 0;
let joinerCalls = 0;

const fakeOrt = {
  Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } dispose() {} },
};

// Build a stub that delegates to the real prototype methods under test.
const proto = ParakeetModel.prototype;
function makeModel(script) {
  return {
    blankId: BLANK,
    maxTokensPerStep: 10,
    subsampling: 8,
    windowStride: 0.01,
    ort: fakeOrt,
    _pickArgmax: proto._pickArgmax,
    _frameConfidence: proto._frameConfidence,
    _advanceDecision: proto._advanceDecision,
    _logSumExp: proto._logSumExp,
    _topK: proto._topK,
    _expandHyp: proto._expandHyp,
    _decodeBeam: proto._decodeBeam,
    _disposeDecoderState: () => { statesDisposed++; },
    _runCombinedStep: async (encTensor) => {
      joinerCalls++;
      const t = Math.round(encTensor.data[0]); // frame index encoded in feature 0
      const spec = script[t];
      statesCreated++;
      return {
        tokenLogits: Float32Array.from(spec.logits),
        step: spec.step,
        // Duration logits: one-hot at spec.step (chosen) so the beam's (token,
        // duration) branching picks the same duration the greedy argmax would,
        // keeping the context-free script greedy-optimal. Tests that exercise
        // duration branching override this by supplying spec.durLogits.
        durLogits: spec.durLogits
          ? Float32Array.from(spec.durLogits)
          : Float32Array.from({ length: spec.step + 1 }, (_, i) => (i === spec.step ? 0 : -Infinity)),
        newState: { state1: {}, state2: {} },
        _logitsTensor: { dispose() {} },
      };
    },
  };
}

// transposed[t*D] = t so the mocked joiner can recover the frame index.
function makeTransposed(n) {
  const a = new Float32Array(n * D);
  for (let t = 0; t < n; t++) a[t * D] = t;
  return a;
}

// Reference greedy decode over the same context-free script.
function refGreedy(model, script, temperature) {
  let t = 0, emittedAtFrame = 0, overall = 0;
  const ids = [], frames = [];
  while (t < script.length) {
    const spec = script[t];
    const logits = Float32Array.from(spec.logits);
    const { maxId, maxLogit } = model._pickArgmax(logits);
    const confVal = model._frameConfidence(logits, maxLogit, temperature);
    frames.push(confVal);
    overall += Math.log(confVal);
    const dec = model._advanceDecision(t, emittedAtFrame, maxId, spec.step, 1);
    if (dec.emit) ids.push(maxId);
    t = dec.nextT;
    emittedAtFrame = dec.nextEmitted;
  }
  return { ids, frames, overall };
}

describe('pure helpers', () => {
  const m = makeModel([]);
  const lg = Float32Array.from([0.1, 3.0, -1, 2.9, 0.0, -5]);

  test('_pickArgmax finds the max index', () => {
    assert.equal(m._pickArgmax.call(m, lg).maxId, 1);
  });
  test('_pickArgmax reports the max value', () => {
    assert.ok(close(m._pickArgmax.call(m, lg).maxLogit, 3.0));
  });
  test('_topK returns the 3 largest indices', () => {
    const top = m._topK.call(m, lg, 3).sort((a, b) => a - b);
    assert.ok(eqArr(top, [0, 1, 3]));
  });
  test('_logSumExp of equal logits', () => {
    const flat = Float32Array.from([2, 2, 2, 2]);
    assert.ok(close(m._logSumExp.call(m, flat), 2 + Math.log(4)));
  });
  test('_frameConfidence temp 0 => 1.0', () => {
    assert.equal(m._frameConfidence.call(m, lg, 3.0, 0), 1.0);
  });
  test('_frameConfidence temp 1 in (0,1)', () => {
    const c1 = m._frameConfidence.call(m, lg, 3.0, 1.0);
    assert.ok(c1 > 0 && c1 < 1);
  });
  test('_advanceDecision step>0 advances by step', () => {
    const d1 = m._advanceDecision.call(m, 4, 0, 2, 3, 1);
    assert.ok(d1.nextT === 7 && d1.nextEmitted === 0 && d1.emit === true);
  });
  test('_advanceDecision blank advances by frameStride', () => {
    const d2 = m._advanceDecision.call(m, 4, 0, BLANK, 0, 1);
    assert.ok(d2.nextT === 5 && d2.emit === false);
  });
  test('_advanceDecision stays for multi-emit', () => {
    const d3 = m._advanceDecision.call(m, 4, 0, 2, 0, 1);
    assert.ok(d3.nextT === 4 && d3.nextEmitted === 1 && d3.emit === true);
  });
  test('_advanceDecision advances at max-tokens cap', () => {
    const d4 = m._advanceDecision.call(m, 4, 9, 2, 0, 1);
    assert.ok(d4.nextT === 5 && d4.nextEmitted === 0);
  });
});

// A scripted, context-free utterance. Each frame's argmax is a distinct token;
// step>=1 so the frame pointer always advances.
const script = [
  { logits: [3.0, 0.1, 0.0, 0.2, 0.1, -1.0], step: 1 }, // argmax 0
  { logits: [0.0, 2.5, 0.3, 0.1, 0.0, -1.0], step: 1 }, // argmax 1
  { logits: [0.1, 0.2, 0.1, 0.0, 0.0,  4.0], step: 1 }, // argmax BLANK (5)
  { logits: [0.2, 0.1, 3.1, 0.4, 0.0, -1.0], step: 2 }, // argmax 2, duration 2
  { logits: [0.0, 0.1, 0.2, 3.3, 0.1, -1.0], step: 1 }, // argmax 3
  { logits: [0.1, 0.0, 0.1, 0.2, 2.7, -1.0], step: 1 }, // argmax 4
];
const Tenc = script.length;

// MAES knobs chosen to NOT prune: expandK covers the whole vocab (beta = V) and
// gamma is large enough that no non-blank candidate is dropped, so the beam is
// free to find the globally-optimal path. maesNumSteps matches the maxSymbols
// default refGreedy relies on (model.maxTokensPerStep = 10). Under these the
// context-free script makes greedy globally optimal, so beam == greedy holds.
// (The decoder gained MAES after the original script was written, which is why
// the migrated test must thread these through; without them expandK is NaN.)
const MAES = { maesNumSteps: 10, maesExpansionBeta: V, maesExpansionGamma: 100 };

async function runBeam(model, beamWidth, { phraseBoost = null, temperature = 1.0 } = {}) {
  phraseBoost?.reset();
  return model._decodeBeam(makeTransposed(Tenc), D, Tenc, {
    beamWidth, temperature, frameStride: 1, phraseBoost,
    returnTimestamps: true, returnConfidences: true,
    timeStride: model.subsampling * model.windowStride,
    ...MAES,
  });
}

describe('beam == greedy (context-free)', () => {
  for (const width of [1, 2, 4]) {
    test(`width ${width} reproduces greedy decode`, async () => {
      const ref = refGreedy(makeModel(script), script, 1.0);
      statesCreated = statesDisposed = joinerCalls = 0;
      const model = makeModel(script);
      const out = await runBeam(model, width);
      assert.ok(eqArr(out.ids, ref.ids), 'ids match greedy');
      assert.ok(eqFloatArr(out.frameConfs, ref.frames), 'frameConfs match greedy');
      assert.ok(close(out.overallLogProb, ref.overall), 'overallLogProb matches greedy');
      // Frame 2 argmax is blank (no emit); frame 3 has TDT duration 2 so it skips
      // frame 4's token (3), giving [0, 1, 2, 4].
      assert.ok(eqArr(out.ids, [0, 1, 2, 4]), 'emitted tokens are 0,1,2,4');
      assert.equal(out.tokenConfs.length, out.ids.length);
      assert.equal(out.tokenTimes.length, out.ids.length);
      assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak');
    });
  }
});

describe('duration branching (#1)', () => {
  // The beam must score/select the TDT duration from the duration logits, not
  // from the pre-argmaxed `step` the greedy path uses. Here frame 0's `step`
  // field says duration 1, but its durLogits strongly favour duration 2. A beam
  // that reads durLogits jumps from frame 0 straight to frame 2 (== Tenc),
  // emitting only token 0; a beam still keyed on `step` would land on frame 1
  // and emit token 3 as well. So ids == [0] and the token spans 2 frames proves
  // duration is sourced from the logits.
  const durScript = [
    { logits: [4.0, 0, 0, 0, 0, -1.0], step: 1, durLogits: [-Infinity, 0.0, 5.0] }, // token 0; durLogits argmax = 2
    { logits: [0, 0, 0, 4.0, 0, -1.0], step: 1 }, // token 3, only reached if duration 1 were chosen
  ];
  const ts = 0.08; // subsampling(8) * windowStride(0.01)

  for (const width of [2, 4]) {
    test(`width ${width} selects the high-logp duration (skips frame 1)`, async () => {
      statesCreated = statesDisposed = joinerCalls = 0;
      const model = makeModel(durScript);
      const out = await model._decodeBeam(makeTransposed(2), D, 2, {
        beamWidth: width, temperature: 1.0, frameStride: 1, phraseBoost: null,
        returnTimestamps: true, returnConfidences: true, timeStride: ts, ...MAES,
      });
      assert.ok(eqArr(out.ids, [0]), 'only token 0 is emitted (duration 2 skipped frame 1)');
      assert.ok(eqFloatArr(out.tokenTimes[0], [0, 2 * ts]), 'token 0 spans 2 frames (duration 2)');
      assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak');
    });
  }
});

describe('phrase boosting steers the beam', () => {
  // At a frame where blank wins and token 0 is the runner-up, a strong enough
  // boost on the standalone phrase [0] flips the emission.
  const tinyScript = [
    { logits: [1.0, 0.0, 0.0, 0.0, 0.0, 2.0], step: 1 }, // argmax BLANK; token 0 runner-up
  ];

  test('without boost: frame emits nothing (blank wins)', async () => {
    const tinyModel = makeModel(tinyScript);
    const noBoost = await tinyModel._decodeBeam(makeTransposed(1), D, 1, {
      beamWidth: 3, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES,
    });
    assert.ok(eqArr(noBoost.ids, []));
  });

  test('with strong boost: token 0 is emitted, overallLogProb stays <= 0', async () => {
    const tinyModel = makeModel(tinyScript);
    const trie = new BoostingTrie({ strength: 10 });
    trie.insert([0], 5);   // phrase = token 0, weight 5 => boosted logit 1.0 + 50
    trie.reset();
    const boosted = await tinyModel._decodeBeam(makeTransposed(1), D, 1, {
      beamWidth: 3, temperature: 1.0, frameStride: 1, phraseBoost: trie,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES,
    });
    assert.ok(eqArr(boosted.ids, [0]), 'token 0 is emitted');
    assert.ok(boosted.overallLogProb <= 0, 'boost does not corrupt the true overallLogProb');
  });
});

describe('degenerate input', () => {
  test('Tenc=0 returns empty result', async () => {
    const model = makeModel(script);
    const out = await model._decodeBeam(new Float32Array(0), D, 0, {
      beamWidth: 4, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES,
    });
    assert.ok(eqArr(out.ids, []) && out.overallLogProb === 0);
  });
});
