// Tier-1 unit test for the TDT beam decoder (app/src/parakeet.js) and its pure
// helpers. No ONNX/model download is needed: we borrow the prototype methods
// onto a stub `model` and mock the joiner with a scripted, context-free
// response (logits depend only on the frame index, encoded into the fake
// encoder tensor). That makes greedy globally optimal, so beam search of ANY
// width must reproduce the greedy output exactly. We then check that phrase
// boosting steers the beam.
//
// The stub scripts the joiner at BOTH entry points the decoder uses: the
// batch-1 `_runCombinedStep` (greedy path, prefix-search, blank closure, and
// single-hypothesis expansion steps) and a batched fake `joinerSession.run`
// consumed by the REAL `_runCombinedStepBatch` (multi-hypothesis expansion
// steps), so every multi-width test exercises the real batch gather/scatter
// plumbing against the same script.
//
// Migrated from scripts/test-beam-decode.mjs to node:test. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel, lengthNormalizedScore, mergeHypotheses, pruneBeam, reconstructBeamPath } from '../../app/src/parakeet.js';
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
let joinerCalls = 0;   // scripted joiner evaluations (one per hypothesis row)
let maxBatch = 0;      // largest batch the fake batched session received

const fakeOrt = {
  Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } dispose() {} },
};

// Tiny prediction-net dims for the stub (real model: 2 layers x 640 hidden).
const PRED_L = 2;
const PRED_H = 3;
const fakeState = () =>
  new fakeOrt.Tensor('float32', new Float32Array(PRED_L * PRED_H), [PRED_L, 1, PRED_H]);

// Scripted duration logits for frame spec: explicit durLogits, else one-hot at
// spec.step (chosen) so the beam's (token, duration) branching picks the same
// duration the greedy argmax would, keeping the context-free script
// greedy-optimal. Tests that exercise duration branching override this by
// supplying spec.durLogits.
const specDurLogits = (spec) =>
  spec.durLogits
    ? Float32Array.from(spec.durLogits)
    : Float32Array.from({ length: spec.step + 1 }, (_, i) => (i === spec.step ? 0 : -Infinity));

// Build a stub that delegates to the real prototype methods under test.
const proto = ParakeetModel.prototype;
function makeModel(script) {
  // Fixed duration-logit width for the batched output rows (a real model has a
  // constant duration head; the per-spec arrays just vary in the mock). Rows
  // are padded with -Infinity, which carries no probability mass, so the
  // batched and batch-1 paths score identically.
  const nDur = Math.max(2, ...script.filter(Boolean).map((s) => (s.durLogits ? s.durLogits.length : s.step + 1)));
  return {
    blankId: BLANK,
    maxTokensPerStep: 10,
    subsampling: 8,
    windowStride: 0.01,
    ort: fakeOrt,
    predLayers: PRED_L,
    predHidden: PRED_H,
    tokenizer: { id2token: new Array(V) },
    _combState1: fakeState(),
    _combState2: fakeState(),
    _pickArgmax: proto._pickArgmax,
    _frameConfidence: proto._frameConfidence,
    _advanceDecision: proto._advanceDecision,
    _logSumExp: proto._logSumExp,
    _logAddExp: proto._logAddExp,
    _topK: proto._topK,
    _expandHyp: proto._expandHyp,
    _applyBlankClosureBatch: proto._applyBlankClosureBatch,
    _prefixSearch: proto._prefixSearch,
    _hypIds: proto._hypIds,
    _decodeBeam: proto._decodeBeam,
    _runCombinedStepBatch: proto._runCombinedStepBatch,
    _disposeDecoderState: () => { statesDisposed++; },
    _runCombinedStep: async (encTensor) => {
      joinerCalls++;
      const t = Math.round(encTensor.data[0]); // frame index encoded in feature 0
      const spec = script[t];
      statesCreated++;
      return {
        tokenLogits: Float32Array.from(spec.logits),
        step: spec.step,
        durLogits: specDurLogits(spec),
        newState: { state1: fakeState(), state2: fakeState() },
        _logitsTensor: { dispose() {} },
      };
    },
    // Batched scripted joiner consumed by the real _runCombinedStepBatch
    // (multi-hypothesis expansion steps): one logit row per batch entry,
    // recovered from the frame index in that entry's encoder row.
    joinerSession: {
      run: async (feeds) => {
        const B = feeds.targets.dims[0];
        maxBatch = Math.max(maxBatch, B);
        const total = V + nDur;
        const out = new Float32Array(B * total).fill(-Infinity);
        for (let b = 0; b < B; b++) {
          joinerCalls++;
          statesCreated++; // _runCombinedStepBatch mints one newState per row
          const spec = script[Math.round(feeds.encoder_outputs.data[b * D])];
          out.set(spec.logits, b * total);
          out.set(specDurLogits(spec), b * total + V);
        }
        return {
          outputs: new fakeOrt.Tensor('float32', out, [B, 1, 1, total]),
          output_states_1: new fakeOrt.Tensor('float32', new Float32Array(PRED_L * B * PRED_H), [PRED_L, B, PRED_H]),
          output_states_2: new fakeOrt.Tensor('float32', new Float32Array(PRED_L * B * PRED_H), [PRED_L, B, PRED_H]),
        };
      },
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
  test('_logAddExp matches log(exp(a)+exp(b))', () => {
    assert.ok(close(m._logAddExp.call(m, -1, -1), -1 + Math.log(2)));
    assert.ok(close(m._logAddExp.call(m, 0, Math.log(3)), Math.log(4)));
  });
  test('_logAddExp is symmetric and handles -Infinity identity', () => {
    assert.ok(close(m._logAddExp.call(m, -2, -5), m._logAddExp.call(m, -5, -2)));
    assert.equal(m._logAddExp.call(m, -Infinity, -3), -3);
    assert.equal(m._logAddExp.call(m, -3, -Infinity), -3);
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

  // NeMo score_norm=True: final selection ranks by score / emitted-token count.
  // These are the real scores observed on a clip that went empty at beam 10
  // (11.wav): the empty/all-blank hyp had a HIGHER raw score (-5.237) than the
  // 7-token hyp (-6.690), but loses once normalized.
  test('lengthNormalizedScore divides by emitted-token count', () => {
    assert.ok(close(lengthNormalizedScore({ score: -6.690, numEmitted: 7 }), -6.690 / 7));
  });
  test('lengthNormalizedScore guards numEmitted 0 (empty hyp) against div-by-zero', () => {
    assert.equal(lengthNormalizedScore({ score: -5.237, numEmitted: 0 }), -5.237);
  });
  test('lengthNormalizedScore ranks a multi-token hyp above a higher-raw empty hyp', () => {
    const token = lengthNormalizedScore({ score: -6.690, numEmitted: 7 });
    const empty = lengthNormalizedScore({ score: -5.237, numEmitted: 0 });
    assert.ok(-5.237 > -6.690, 'empty hyp has the higher RAW score (the bug)');
    assert.ok(token > empty, 'but the token hyp wins once length-normalized (the fix)');
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
// maesPrefixAlpha: 0 keeps prefix-search recombination OFF for the equivalence,
// duration-branching and merge tests (recombination legitimately changes scores
// and is covered by its own test below); the other knobs disable pruning so the
// beam is free to find the globally-optimal path.
const MAES = { maesNumSteps: 10, maesExpansionBeta: V, maesExpansionGamma: 100, maesPrefixAlpha: 0 };

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

describe('duplicate-hypothesis merging (#3)', () => {
  // Two routes reach the same emitted sequence "X,Z" at the same frame in the
  // same round, so the decoder merges them and log-sum-exps their scores. The
  // construction makes either single route LOSE to a competitor "X,W", while the
  // recombined merge WINS, so the emitted ids prove recombination happened:
  //   - frame 0: emit X (id 0); durations 1 and 2 are equally likely, so X
  //     branches to frame 1 and frame 2.
  //   - frame 1 (X@t1): emit Z (id 1) duration 2 -> frame 3  [route R2]
  //                     emit W (id 2) duration 2 -> frame 3  [competitor]
  //   - frame 2 (X@t2): emit Z (id 1) duration 1 -> frame 3  [route R1]
  //   - both "X,Z" routes collide at frame 3 in the same round and merge.
  // Single-route X,Z score ~= -1.667 < X,W ~= -1.167, but merged X,Z ~= -0.974,
  // so X,Z wins only because of recombination. Without merging, ids would be
  // [0, 2, 1] (X,W,Z); with merging they are [0, 1, 1] (X,Z,Z).
  const NEG = -20;
  const mergeScript = [
    { logits: [0, NEG, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, 0] },     // f0: X, dur 1==2
    { logits: [NEG, -1.0, -0.5, NEG, NEG, NEG], step: 2, durLogits: [-Infinity, NEG, 0] }, // f1: Z/W, dur 2
    { logits: [NEG, -1.0, NEG, -0.5, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] }, // f2: Z/filler, dur 1
    { logits: [NEG, 0, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] },      // f3: Z, dur 1 -> finish
  ];

  test('recombined duplicate wins over a single-route competitor', async () => {
    statesCreated = statesDisposed = joinerCalls = 0;
    const model = makeModel(mergeScript);
    const out = await model._decodeBeam(makeTransposed(4), D, 4, {
      beamWidth: 6, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES,
    });
    assert.ok(eqArr(out.ids, [0, 1, 1]), 'merged X,Z path wins (would be [0,2,1] without merging)');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak across the merge');
  });
});

describe('empty-hypothesis length normalization (NeMo score_norm)', () => {
  // Regression for the beam-10 empty-transcript bug: on hard/ambiguous audio the
  // all-blank (empty) path has the highest UNNORMALIZED score (a sum of fewer,
  // near-zero blank log-probs), so a raw-score final selection returned it and the
  // transcript collapsed to empty at wide beam widths. Here every frame slightly
  // favours blank (logit 0.2) over its one real token (logit 0), so the 3-blank
  // empty path outscores the 3-token path on RAW score (-1.794 > -2.394) yet LOSES
  // once normalized by emitted-token count (-1.794 vs -0.798). With the fix the
  // decoder returns the token path [0, 1, 2]; before it, out.ids would be [].
  const NEG = -20;
  const emptyBiasScript = [
    { logits: [0, NEG, NEG, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
    { logits: [NEG, 0, NEG, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
    { logits: [NEG, NEG, 0, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
  ];

  // Width 6 and 10: wide enough that the (lower-raw) token path survives pruning
  // to finish, so the final selection is what decides token-vs-empty.
  for (const width of [6, 10]) {
    test(`width ${width} returns the token path, not the higher-raw empty hyp`, async () => {
      statesCreated = statesDisposed = joinerCalls = 0;
      const model = makeModel(emptyBiasScript);
      const out = await model._decodeBeam(makeTransposed(3), D, 3, {
        beamWidth: width, temperature: 1.0, frameStride: 1, phraseBoost: null,
        returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
        ...MAES, maesExpansionGamma: 2.3,
      });
      assert.ok(out.ids.length > 0, 'transcript is non-empty (the bug returned [])');
      assert.ok(eqArr(out.ids, [0, 1, 2]), 'length-normalized selection picks the 3-token path');
      assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak');
    });
  }
});

describe('prefix-search recombination (#2)', () => {
  // Frame 3's joiner output (the only frame the prefix scorer touches here).
  const pScript = [];
  pScript[3] = { logits: [-1.0, 0.5, -2.0, -20, -20, -20], step: 1, durLogits: [0.0, -0.7, -20] };

  // Two beam hypotheses on the SAME frame: short "X" (ids [0]) is a strict
  // prefix of long "X,Y" (ids [0,1]). The expected extension log-prob is the
  // duration-0 emission of Y from X's state at frame 3.
  function makeBeam(longScore = -1.2, shortScore = -0.4) {
    const root = { parent: null, emit: false, id: null };
    const short = { parent: root, emit: true, id: 0, t: 3, lastTok: 0, state: { tag: 'S' }, score: shortScore };
    const long = { parent: short, emit: true, id: 1, t: 3, lastTok: 1, state: { tag: 'L' }, score: longScore };
    return { root, short, long, beam: [long, short] };
  }
  function expectedExtLogp(model, tok = 1) {
    const lg = Float32Array.from(pScript[3].logits);
    const dl = Float32Array.from(pScript[3].durLogits);
    return (lg[tok] - model._logSumExp(lg)) + (dl[0] - model._logSumExp(dl));
  }

  test('folds the prefix score into its extension via log-sum-exp', async () => {
    const model = makeModel(pScript);
    const { short, long } = makeBeam();
    const longOrig = long.score, shortOrig = short.score;
    statesCreated = statesDisposed = 0;
    await model._prefixSearch([long, short], makeTransposed(4), D, { maesPrefixAlpha: 1 });
    const expected = model._logAddExp(longOrig, shortOrig + expectedExtLogp(model));
    assert.ok(close(long.score, expected), 'long score is recombined with short + extension');
    assert.ok(close(short.score, shortOrig), 'short (prefix) score is unchanged');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'extension state disposed, short.state kept');
  });

  test('maesPrefixAlpha=0 disables recombination', async () => {
    const model = makeModel(pScript);
    const { short, long } = makeBeam();
    const longOrig = long.score;
    await model._prefixSearch([long, short], makeTransposed(4), D, { maesPrefixAlpha: 0 });
    assert.ok(close(long.score, longOrig), 'no recombination when alpha is 0');
  });

  test('non-prefix pair is left untouched', async () => {
    const model = makeModel(pScript);
    // hypB ids [3] is NOT a prefix of hypA ids [0,1], so nothing recombines.
    const root = { parent: null, emit: false, id: null };
    const hypB = { parent: root, emit: true, id: 3, t: 3, lastTok: 3, state: {}, score: -0.4 };
    const xNode = { parent: root, emit: true, id: 0, t: 3, lastTok: 0, state: {}, score: -0.5 };
    const hypA = { parent: xNode, emit: true, id: 1, t: 3, lastTok: 1, state: {}, score: -1.2 };
    const aOrig = hypA.score, bOrig = hypB.score;
    await model._prefixSearch([hypA, hypB], makeTransposed(4), D, { maesPrefixAlpha: 1 });
    assert.ok(close(hypA.score, aOrig) && close(hypB.score, bOrig), 'unrelated sequences are not recombined');
  });

  test('scores multiple prefix pairs in one batched joiner call', async () => {
    // Two independent (long, short) pairs on the SAME frame: "0"<"0,1" and
    // "3"<"3,2". The lockstep scorer must run both extensions in ONE batched
    // call and fold each pair exactly as the serial path would.
    const model = makeModel(pScript);
    const root = { parent: null, emit: false, id: null };
    // Batched gather reads each short hypothesis' LSTM state, so use real
    // fake tensors (long states are never read).
    const mkHyp = (parent, id, score) => ({
      parent, emit: true, id, t: 3, lastTok: id, score,
      state: { state1: fakeState(), state2: fakeState() },
    });
    const short1 = mkHyp(root, 0, -0.4);
    const long1 = mkHyp(short1, 1, -1.2);
    const short2 = mkHyp(root, 3, -0.6);
    const long2 = mkHyp(short2, 2, -1.5);
    maxBatch = 0;
    statesCreated = statesDisposed = 0;

    await model._prefixSearch([long1, short1, long2, short2], makeTransposed(4), D, { maesPrefixAlpha: 1 });

    assert.equal(maxBatch, 2, 'both extensions shared one batched joiner call');
    assert.ok(close(long1.score, model._logAddExp(-1.2, -0.4 + expectedExtLogp(model, 1))), 'first pair folded');
    assert.ok(close(long2.score, model._logAddExp(-1.5, -0.6 + expectedExtLogp(model, 2))), 'second pair folded');
    assert.ok(close(short1.score, -0.4) && close(short2.score, -0.6), 'short (prefix) scores unchanged');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'extension states disposed, short states kept');
  });
});

describe('last-mAES-step blank closure (#closure)', () => {
  // _applyBlankClosureBatch implements NeMo's modified_adaptive_expansion_search
  // n == maes_num_steps-1 branch: a non-blank zero-duration emission that
  // exhausts the per-frame symbol budget is closed with an implicit blank. The
  // closure must (a) advance by the argmax (forced non-zero) TDT duration and
  // (b) add logp(blank)+logp(best_dur) to the score, while leaving
  // overallLogProb (token-only confidence) untouched. A bare one-frame advance
  // (the pre-fix behaviour) gets both the score and the landing frame wrong.
  // A step's closures all share the parent frame, so they run as ONE batched
  // joiner call.
  const PARENT_T = 3;

  // NeMo-faithful expected (scoreDelta, bestIdx) for a frame's token+duration
  // logits. Reads from Float32Array (as the implementation does) so the expected
  // score is bit-identical, not off by a float32-rounding epsilon.
  function expectClosure(model, lg, dl) {
    const lgf = Float32Array.from(lg), dlf = Float32Array.from(dl);
    const blankLogp = lgf[BLANK] - model._logSumExp(lgf);
    let bestIdx = 0, bestVal = -Infinity;
    dlf.forEach((v, i) => { if (v > bestVal) { bestVal = v; bestIdx = i; } });
    if (bestIdx === 0) bestIdx = dlf.length > 1 ? 1 : 0;
    const durLogp = dlf[bestIdx] - model._logSumExp(dlf);
    return { scoreDelta: blankLogp + durLogp, bestIdx };
  }

  // A post-emit child: lands on PARENT_T+frameStride before the closure runs.
  const makeChildAt = (score = -1.7, overall = -0.9) => ({
    emit: true, id: 1, lastTok: 1, state: { tag: 'C' },
    t: PARENT_T + 1, score, overallLogProb: overall,
  });

  test('argmax non-zero duration: advances by that duration and adds blank+dur logp', async () => {
    const lg = [-1.0, 0.5, -2.0, -20, -20, -0.3]; // BLANK (id 5) logit -0.3
    const dl = [0.0, 0.2, 2.5];                    // argmax index 2 (a >1 advance)
    const script = []; script[PARENT_T] = { logits: lg, durLogits: dl, step: 0 };
    const model = makeModel(script);
    const child = makeChildAt();
    const origScore = child.score, origOverall = child.overallLogProb;
    statesCreated = statesDisposed = 0;

    await model._applyBlankClosureBatch([child], PARENT_T, makeTransposed(PARENT_T + 1), D);

    const { scoreDelta, bestIdx } = expectClosure(model, lg, dl);
    assert.equal(bestIdx, 2, 'argmax duration is index 2');
    assert.ok(close(child.score, origScore + scoreDelta), 'score gains logp(blank)+logp(best_dur)');
    assert.equal(child.t, PARENT_T + 2, 'advances by the argmax duration (2), not frameStride');
    assert.ok(close(child.overallLogProb, origOverall), 'overallLogProb untouched (closing blank emits no token)');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'closure joiner state disposed');
  });

  test('argmax zero duration: falls back to the min non-zero duration (index 1)', async () => {
    const lg = [-1.0, 0.5, -2.0, -20, -20, -0.3];
    const dl = [3.0, 0.4, -1.0]; // argmax index 0 (zero) -> must fall back to index 1
    const script = []; script[PARENT_T] = { logits: lg, durLogits: dl, step: 0 };
    const model = makeModel(script);
    const child = makeChildAt();
    const origScore = child.score;
    statesCreated = statesDisposed = 0;

    await model._applyBlankClosureBatch([child], PARENT_T, makeTransposed(PARENT_T + 1), D);

    const { scoreDelta, bestIdx } = expectClosure(model, lg, dl);
    assert.equal(bestIdx, 1, 'zero-duration argmax falls back to min non-zero index 1');
    assert.ok(close(child.score, origScore + scoreDelta), 'score uses the fallback (index 1) duration logp');
    assert.equal(child.t, PARENT_T + 1, 'advances by 1 frame (the min non-zero duration)');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'closure joiner state disposed');
  });

  test('closes multiple children in one batched joiner call', async () => {
    const lg = [-1.0, 0.5, -2.0, -20, -20, -0.3];
    const dl = [0.0, 0.2, 2.5]; // argmax index 2
    const script = []; script[PARENT_T] = { logits: lg, durLogits: dl, step: 0 };
    const model = makeModel(script);
    // Batched gather reads each child's LSTM state, so use real fake tensors.
    const mkChild = (lastTok, score) => ({
      emit: true, id: lastTok, lastTok,
      state: { state1: fakeState(), state2: fakeState() },
      t: PARENT_T + 1, score, overallLogProb: -0.9,
    });
    const childA = mkChild(1, -1.7);
    const childB = mkChild(2, -2.4);
    statesCreated = statesDisposed = 0;
    maxBatch = 0;

    await model._applyBlankClosureBatch([childA, childB], PARENT_T, makeTransposed(PARENT_T + 1), D);

    const { scoreDelta } = expectClosure(model, lg, dl);
    assert.equal(maxBatch, 2, 'both closures shared one batched joiner call');
    assert.ok(close(childA.score, -1.7 + scoreDelta), 'first child gains logp(blank)+logp(best_dur)');
    assert.ok(close(childB.score, -2.4 + scoreDelta), 'second child gains logp(blank)+logp(best_dur)');
    assert.equal(childA.t, PARENT_T + 2);
    assert.equal(childB.t, PARENT_T + 2);
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'both throwaway joiner states disposed');
  });

  test('fires within _decodeBeam on a zero-duration burst and stays leak-safe', async () => {
    // durLogits favour duration 0, so the beam emits a zero-duration token that
    // re-expands on the same frame; the second emission hits the maesNumSteps=2
    // cap and triggers the closure. (The context-free joiner means the burst
    // never wins the beam, but the closure code path must run and free the
    // throwaway joiner state it mints.)
    const burst = [
      { logits: [4.0, -20, -20, -20, -20, 1.0], step: 0, durLogits: [2.0, 1.0, -20] }, // f0: token0, dur0 argmax
      { logits: [-20, -20, -20, -20, -20, 4.0], step: 1, durLogits: [-20, 2.0, -20] }, // f1: blank, dur1 -> finish
    ];
    const model = makeModel(burst);
    let closureCalls = 0; // children closed (the batch may close several at once)
    model._applyBlankClosureBatch = (...args) => { closureCalls += args[0].length; return proto._applyBlankClosureBatch.apply(model, args); };
    statesCreated = statesDisposed = 0;
    await model._decodeBeam(makeTransposed(2), D, 2, {
      beamWidth: 4, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
      maesNumSteps: 2, maesExpansionBeta: V, maesExpansionGamma: 100, maesPrefixAlpha: 0,
    });
    assert.ok(closureCalls > 0, 'the blank closure was exercised inside _decodeBeam');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'closure joiner states freed (no leak)');
  });
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

describe('frame-synchronous state GC (#frame-sync)', () => {
  // A longer, deterministic utterance with varied tokens and TDT durations so
  // hypotheses skip ahead and linger in the future pool across many frames. This
  // exercises the frame-synchronous loop's per-frame mark-and-sweep against
  // long-lived future hypotheses: every decoder state allocated must be disposed,
  // at every beam width, with prefix-search and merging both active.
  const longScript = [];
  for (let t = 0; t < 16; t++) {
    const logits = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    logits[t % 5] = 2.0 + (t % 3) * 0.3;     // a varying argmax token
    logits[(t + 2) % 5] = 1.0;               // a runner-up so the beam branches
    if (t % 4 === 3) logits[BLANK] = 2.5;    // occasional blank-dominant frame
    longScript.push({ logits, step: (t % 3) + 1 }); // durations cycle 1,2,3
  }

  for (const width of [2, 4, 8]) {
    test(`width ${width}: no decoder-state leak across 16 frames (prefix+merge on)`, async () => {
      statesCreated = statesDisposed = joinerCalls = 0;
      const model = makeModel(longScript);
      const out = await model._decodeBeam(makeTransposed(16), D, 16, {
        beamWidth: width, temperature: 1.0, frameStride: 1, phraseBoost: null,
        returnTimestamps: true, returnConfidences: true, timeStride: 0.08,
        maesNumSteps: 3, maesExpansionBeta: 4, maesExpansionGamma: 4.0, maesPrefixAlpha: 1,
      });
      assert.ok(out.ids.length > 0, 'produced a non-empty transcript');
      assert.equal(out.tokenTimes.length, out.ids.length, 'one timestamp per token');
      assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak');
    });
  }
});

describe('batched joiner expansion (#batch)', () => {
  // _runCombinedStepBatch turns the per-hypothesis serial joiner calls of a
  // MAES expansion step into ONE batched joinerSession.run. These tests pin the
  // batch plumbing: the gather layout it feeds the session, the scatter that
  // splits the session output back per hypothesis, the batch-1 delegation, and
  // end-to-end equivalence with a serial per-hypothesis loop.

  test('gathers per-hypothesis feeds and scatters per-row results', async () => {
    // A capturing fake session whose outputs are index-valued, so every element
    // of the scattered results can be traced back to its expected batch slot.
    const ND = 2;            // duration-logit width
    const total = V + ND;
    let captured = null;
    const m = {
      blankId: BLANK,
      ort: fakeOrt,
      predLayers: PRED_L,
      predHidden: PRED_H,
      tokenizer: { id2token: new Array(V) },
      _combState1: fakeState(),
      _combState2: fakeState(),
      _runCombinedStepBatch: proto._runCombinedStepBatch,
      _runCombinedStep: () => { throw new Error('B>1 must not delegate to the batch-1 path'); },
      joinerSession: {
        run: async (feeds) => {
          captured = feeds;
          const B = feeds.targets.dims[0];
          return {
            outputs: new fakeOrt.Tensor('float32', Float32Array.from({ length: B * total }, (_, i) => i), [B, 1, 1, total]),
            output_states_1: new fakeOrt.Tensor('float32', Float32Array.from({ length: PRED_L * B * PRED_H }, (_, i) => 100 + i), [PRED_L, B, PRED_H]),
            output_states_2: new fakeOrt.Tensor('float32', Float32Array.from({ length: PRED_L * B * PRED_H }, (_, i) => 200 + i), [PRED_L, B, PRED_H]),
          };
        },
      },
    };
    // Distinguishable per-hypothesis LSTM states ([PRED_L, 1, PRED_H], layers concatenated).
    const mkState = (base) => ({
      state1: new fakeOrt.Tensor('float32', Float32Array.from({ length: PRED_L * PRED_H }, (_, i) => base + i), [PRED_L, 1, PRED_H]),
      state2: new fakeOrt.Tensor('float32', Float32Array.from({ length: PRED_L * PRED_H }, (_, i) => base + 50 + i), [PRED_L, 1, PRED_H]),
    });
    const hyps = [
      { t: 0, lastTok: 1, state: mkState(1000) },
      { t: 2, lastTok: 4, state: null },        // null state -> shared zero state
      { t: 1, lastTok: 3, state: mkState(2000) },
    ];
    const B = hyps.length;
    const res = await m._runCombinedStepBatch(hyps, makeTransposed(3), D);

    // Gather: encoder rows carry each hypothesis' own frame (feature 0 == t).
    assert.ok(eqArr([...captured.encoder_outputs.dims], [B, D, 1]));
    assert.ok(eqFloatArr([captured.encoder_outputs.data[0], captured.encoder_outputs.data[D], captured.encoder_outputs.data[2 * D]], [0, 2, 1]));
    assert.ok(eqArr([...captured.targets.dims], [B, 1]));
    assert.ok(eqArr([...captured.targets.data], [1, 4, 3]));
    assert.ok(eqArr([...captured.target_length.data], [1, 1, 1]));
    // Gather: hypothesis b is COLUMN b of the [PRED_L, B, PRED_H] state, per layer.
    const colAt = (data, l, b) => Array.from(data.subarray((l * B + b) * PRED_H, (l * B + b + 1) * PRED_H));
    assert.ok(eqArr([...captured.input_states_1.dims], [PRED_L, B, PRED_H]));
    assert.ok(eqFloatArr(colAt(captured.input_states_1.data, 0, 0), [1000, 1001, 1002]));
    assert.ok(eqFloatArr(colAt(captured.input_states_1.data, 1, 0), [1003, 1004, 1005]));
    assert.ok(eqFloatArr(colAt(captured.input_states_1.data, 0, 1), [0, 0, 0]), 'null state gathers the zero state');
    assert.ok(eqFloatArr(colAt(captured.input_states_1.data, 1, 2), [2003, 2004, 2005]));
    assert.ok(eqFloatArr(colAt(captured.input_states_2.data, 0, 2), [2050, 2051, 2052]));

    // Scatter: row b's logits split into token/duration views of its own copy.
    assert.equal(res.length, B);
    assert.ok(eqFloatArr(Array.from(res[1].tokenLogits), [8, 9, 10, 11, 12, 13]));
    assert.ok(eqFloatArr(Array.from(res[1].durLogits), [14, 15]));
    assert.ok(eqFloatArr(Array.from(res[2].tokenLogits), [16, 17, 18, 19, 20, 21]));
    // Scatter: newState column b regrouped into a [PRED_L, 1, PRED_H] tensor.
    // output_states value at flat index (l*B + b)*PRED_H + i is 100 + that
    // index (state1) / 200 + it (state2), so column b of layer l starts at
    // 100 + (l*B + b)*PRED_H.
    const expectedCol = (base, b) =>
      [0, 1].flatMap((l) => [0, 1, 2].map((i) => base + (l * B + b) * PRED_H + i));
    assert.ok(eqArr([...res[1].newState.state1.dims], [PRED_L, 1, PRED_H]));
    assert.ok(eqFloatArr(Array.from(res[1].newState.state1.data), expectedCol(100, 1)));
    assert.ok(eqFloatArr(Array.from(res[2].newState.state2.data), expectedCol(200, 2)));
  });

  test('a single hypothesis delegates to the batch-1 _runCombinedStep path', async () => {
    const model = makeModel(script);
    let singleCalls = 0;
    const orig = model._runCombinedStep;
    model._runCombinedStep = (...a) => { singleCalls++; return orig.apply(model, a); };
    model.joinerSession = { run: async () => { throw new Error('batch-1 must not hit the batched session'); } };
    const res = await model._runCombinedStepBatch([{ t: 1, lastTok: BLANK, state: null }], makeTransposed(2), D);
    assert.equal(singleCalls, 1, 'delegated to _runCombinedStep');
    assert.equal(res.length, 1);
    // Compare in float32 (the scripted joiner stores logits as Float32Array).
    assert.ok(eqFloatArr(Array.from(res[0].tokenLogits), Array.from(Float32Array.from(script[1].logits))));
  });

  test('batched decode == serial per-hypothesis decode (width 8, prefix+merge on)', async () => {
    // Same longScript shape as the GC suite: branching, varied TDT durations,
    // multi-hypothesis frames. The batched run must reproduce the serial loop
    // exactly (the -Infinity duration padding in the batched rows carries no
    // probability mass).
    const longScript = [];
    for (let t = 0; t < 16; t++) {
      const logits = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
      logits[t % 5] = 2.0 + (t % 3) * 0.3;
      logits[(t + 2) % 5] = 1.0;
      if (t % 4 === 3) logits[BLANK] = 2.5;
      longScript.push({ logits, step: (t % 3) + 1 });
    }
    const beamOpts = {
      beamWidth: 8, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: true, returnConfidences: true, timeStride: 0.08,
      maesNumSteps: 3, maesExpansionBeta: 4, maesExpansionGamma: 4.0, maesPrefixAlpha: 1,
    };

    const serialModel = makeModel(longScript);
    serialModel._runCombinedStepBatch = async function (hyps, transposed, dim) {
      const outs = [];
      for (const h of hyps) {
        const enc = new fakeOrt.Tensor('float32', transposed.subarray(h.t * dim, (h.t + 1) * dim), [1, dim, 1]);
        outs.push(await this._runCombinedStep(enc, h.lastTok, h.state));
      }
      return outs;
    };
    const serial = await serialModel._decodeBeam(makeTransposed(16), D, 16, beamOpts);

    maxBatch = 0;
    const batchedModel = makeModel(longScript);
    const batched = await batchedModel._decodeBeam(makeTransposed(16), D, 16, beamOpts);

    assert.ok(maxBatch > 1, 'the batched session actually received multi-hypothesis batches');
    assert.ok(eqArr(batched.ids, serial.ids), 'ids match the serial decode');
    assert.ok(close(batched.overallLogProb, serial.overallLogProb), 'overallLogProb matches');
    assert.ok(eqFloatArr(batched.frameConfs, serial.frameConfs), 'frameConfs match');
    assert.ok(eqFloatArr(batched.tokenConfs, serial.tokenConfs), 'tokenConfs match');
    assert.equal(batched.tokenTimes.length, serial.tokenTimes.length);
    for (let i = 0; i < serial.tokenTimes.length; i++) {
      assert.ok(eqFloatArr(batched.tokenTimes[i], serial.tokenTimes[i]), `tokenTimes[${i}] match`);
    }
  });

  test('batched decode == serial decode on a zero-duration burst (closures fire)', async () => {
    // Frames favouring duration 0 make zero-duration emissions hit the
    // maesNumSteps cap, so the deferred batched blank closures fire (the
    // previous test's script never emits at duration 0). The batched run must
    // still reproduce the serial per-hypothesis loop exactly.
    const zScript = [];
    for (let t = 0; t < 12; t++) {
      const logits = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
      logits[t % 5] = 2.2;
      logits[(t + 1) % 5] = 1.4;
      if (t % 5 === 4) logits[BLANK] = 2.0;
      // Every third frame favours duration 0 so the symbol cap triggers closures.
      zScript.push({ logits, step: 1, durLogits: (t % 3 === 0) ? [1.2, 0.6, -20] : [-20, 0.8, 0.2] });
    }
    const beamOpts = {
      beamWidth: 6, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: true, returnConfidences: true, timeStride: 0.08,
      maesNumSteps: 2, maesExpansionBeta: 3, maesExpansionGamma: 4.0, maesPrefixAlpha: 1,
    };

    const serialModel = makeModel(zScript);
    serialModel._runCombinedStepBatch = async function (hyps, transposed, dim) {
      const outs = [];
      for (const h of hyps) {
        const enc = new fakeOrt.Tensor('float32', transposed.subarray(h.t * dim, (h.t + 1) * dim), [1, dim, 1]);
        outs.push(await this._runCombinedStep(enc, h.lastTok, h.state));
      }
      return outs;
    };
    const serial = await serialModel._decodeBeam(makeTransposed(12), D, 12, beamOpts);

    statesCreated = statesDisposed = 0;
    const batchedModel = makeModel(zScript);
    let closedChildren = 0;
    batchedModel._applyBlankClosureBatch = (...args) => { closedChildren += args[0].length; return proto._applyBlankClosureBatch.apply(batchedModel, args); };
    const batched = await batchedModel._decodeBeam(makeTransposed(12), D, 12, beamOpts);

    assert.ok(closedChildren > 0, 'blank closures fired during the batched decode');
    assert.ok(batched.ids.length > 0, 'produced a non-empty transcript');
    assert.ok(eqArr(batched.ids, serial.ids), 'ids match the serial decode');
    assert.ok(close(batched.overallLogProb, serial.overallLogProb), 'overallLogProb matches');
    assert.ok(eqFloatArr(batched.frameConfs, serial.frameConfs), 'frameConfs match');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no decoder-state leak with closures batched');
  });
});

describe('beam-stats instrumentation (collectBeamStats, opt-in)', () => {
  // The opt-in flag must: (a) attach a per-utterance `beamStats` whose
  // expansionSizes (the per-step joint-net batch size B = working.length) line
  // up one-to-one with `steps`, each an integer in [1, beamWidth]; (b) leave the
  // result byte-for-byte unchanged when OFF (no beamStats field at all), so
  // production / e2e / the existing tests are unaffected.
  for (const width of [1, 2, 4]) {
    test(`width ${width}: beamStats present, expansionSizes line up and stay in [1, ${width}]`, async () => {
      const model = makeModel(script);
      const out = await model._decodeBeam(makeTransposed(Tenc), D, Tenc, {
        beamWidth: width, temperature: 1.0, frameStride: 1, phraseBoost: null,
        returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
        ...MAES, collectBeamStats: true,
      });
      assert.ok(out.beamStats, 'beamStats is present when collectBeamStats is on');
      const bs = out.beamStats;
      assert.ok(Array.isArray(bs.expansionSizes), 'expansionSizes is an array');
      assert.ok(Array.isArray(bs.keptSizes), 'keptSizes is an array');
      assert.equal(bs.expansionSizes.length, bs.steps, 'steps == expansionSizes.length');
      assert.ok(bs.steps > 0, 'at least one expansion step happened');
      for (const b of bs.expansionSizes) {
        assert.ok(Number.isInteger(b) && b >= 1 && b <= width, `expansion size ${b} is an int in [1, ${width}]`);
      }
      for (const k of bs.keptSizes) {
        assert.ok(Number.isInteger(k) && k >= 0 && k <= width, `kept size ${k} is an int in [0, ${width}]`);
      }
      // Aggregates equal a straight reduction over the raw expansion series.
      const maxB = bs.expansionSizes.reduce((a, b) => Math.max(a, b), 0);
      const meanB = bs.expansionSizes.reduce((a, b) => a + b, 0) / bs.expansionSizes.length;
      assert.equal(bs.expansion.max, maxB, 'expansion.max == max(expansionSizes)');
      assert.ok(close(bs.expansion.mean, meanB), 'expansion.mean == mean(expansionSizes)');
      assert.ok(bs.expansion.median >= 1 && bs.expansion.median <= maxB, 'expansion.median within [1, max]');
    });
  }

  test('flag OFF: the result carries no beamStats field (opt-in guard)', async () => {
    const out = await runBeam(makeModel(script), 4);
    assert.equal(out.beamStats, undefined, 'no beamStats when the flag is off');
    assert.ok(!('beamStats' in out), 'the beamStats key is absent, not merely undefined');
  });

  test('Tenc=0 with the flag on returns an empty beamStats (zero steps)', async () => {
    const out = await makeModel(script)._decodeBeam(new Float32Array(0), D, 0, {
      beamWidth: 4, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
      ...MAES, collectBeamStats: true,
    });
    assert.ok(out.beamStats, 'beamStats is present even for an empty decode');
    assert.equal(out.beamStats.steps, 0, 'no decode steps');
    assert.ok(eqArr(out.beamStats.expansionSizes, []), 'no expansion sizes');
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

// ---------------------------------------------------------------------------
// Diagnostic decoder knobs (mergeDuplicates / lengthNormPrune / nBest). These
// exist to A/B the beam's scoring against greedy in the murmure #338 study.
// The tests pin each knob so a future refactor cannot silently change its
// meaning: the whole point of the study is that the *default* behaviour is
// exactly what it always was, and each knob flips one specific mechanism.
// ---------------------------------------------------------------------------

// Reference log(exp(a)+exp(b)) for the pure merge tests (mirrors _logAddExp).
const refLogAddExp = (a, b) => {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
};

describe('mergeHypotheses (pure): merge on/off', () => {
  // Two hyps share sequence "0," at frame 3 (a duplicate reached two ways); a
  // third distinct "1," is a separate hypothesis that must never merge.
  const mk = (seqKey, t, score) => ({ seqKey, t, score });

  test('merge ON recombines duplicate scores via log-sum-exp', () => {
    const hyps = [mk('0,', 3, -1.0), mk('0,', 3, -1.5), mk('1,', 3, -2.0)];
    const out = mergeHypotheses(hyps, { mergeDuplicates: true, logAddExp: refLogAddExp });
    assert.equal(out.length, 2, 'the two "0," routes collapse to one; "1," stays');
    assert.equal(out[0].seqKey, '0,', 'representative keeps first-seen order');
    assert.ok(close(out[0].score, refLogAddExp(-1.0, -1.5)), 'duplicate score is recombined');
    assert.equal(out[1].seqKey, '1,', 'distinct hypothesis is untouched');
    assert.ok(close(out[1].score, -2.0), 'distinct score unchanged');
  });

  test('merge OFF keeps the single best route (Viterbi), no recombination', () => {
    const hyps = [mk('0,', 3, -1.0), mk('0,', 3, -1.5), mk('1,', 3, -2.0)];
    const out = mergeHypotheses(hyps, { mergeDuplicates: false, logAddExp: refLogAddExp });
    assert.equal(out.length, 2, 'still one survivor per distinct sequence');
    assert.equal(out[0].seqKey, '0,');
    assert.ok(close(out[0].score, -1.0), 'survivor is the max-score route, score NOT recombined');
  });

  test('representative is the highest-raw member regardless of arrival order', () => {
    // Lower-scoring route arrives first, higher second.
    for (const merge of [true, false]) {
      const out = mergeHypotheses([{ seqKey: 'x,', t: 1, score: -3.0 }, { seqKey: 'x,', t: 1, score: -1.0 }],
        { mergeDuplicates: merge, logAddExp: refLogAddExp });
      assert.equal(out.length, 1);
      const expected = merge ? refLogAddExp(-1.0, -3.0) : -1.0;
      assert.ok(close(out[0].score, expected), `merge=${merge} keeps the max route as representative`);
    }
  });
});

describe('pruneBeam (pure): raw vs length-normalized survival key', () => {
  // Same numbers as the empty-transcript regression: a 0-token "empty" hyp with
  // the higher RAW score vs a 7-token hyp with the lower raw score.
  const empty = { seqKey: '', t: 3, score: -5.237, numEmitted: 0 };
  const token = { seqKey: 'a,b,', t: 3, score: -6.690, numEmitted: 7 };

  test('lengthNormPrune=false ranks by raw score (empty hyp survives)', () => {
    const kept = pruneBeam([token, empty], 1, { lengthNormPrune: false });
    assert.equal(kept.length, 1);
    assert.equal(kept[0], empty, 'raw-score prune keeps the higher-raw empty hyp');
  });

  test('lengthNormPrune=true ranks by length-normalized score (token hyp survives)', () => {
    const kept = pruneBeam([token, empty], 1, { lengthNormPrune: true });
    assert.equal(kept.length, 1);
    assert.equal(kept[0], token, 'length-normalized prune keeps the longer correct hyp');
  });

  test('does not mutate its input array', () => {
    const input = [token, empty];
    pruneBeam(input, 1, { lengthNormPrune: true });
    assert.ok(input.length === 2 && input[0] === token && input[1] === empty, 'input order preserved');
  });
});

describe('reconstructBeamPath (pure)', () => {
  test('walks the backpointer chain, keeps emit tokens in order, skips the seed', () => {
    const seed = { parent: null, emit: false, id: null, confVal: null };
    const n1 = { parent: seed, emit: true, id: 7, confVal: 0.9, tokenTime: [0, 1] };
    const n2 = { parent: n1, emit: false, id: null, confVal: 0.5 };
    const n3 = { parent: n2, emit: true, id: 8, confVal: 0.8, tokenTime: [1, 2], overallLogProb: -1.23 };
    const r = reconstructBeamPath(n3, { returnTimestamps: true, returnConfidences: true });
    assert.ok(eqArr(r.idsR, [7, 8]), 'emitted ids in forward order');
    assert.ok(eqFloatArr(r.framesR, [0.9, 0.5, 0.8]), 'per-frame confs include the blank frame');
    assert.ok(close(r.overall, -1.23), 'overall log-prob is the leaf value');
    assert.equal(r.timesR.length, 2, 'one timestamp per emitted token');
    assert.equal(r.confsR.length, 2, 'one confidence per emitted token');
  });

  test('null hypothesis yields empty arrays and zero overall', () => {
    const r = reconstructBeamPath(null);
    assert.ok(eqArr(r.idsR, []) && r.overall === 0);
  });
});

describe('mergeDuplicates flag end-to-end (_decodeBeam)', () => {
  // Reuses the merging construction: with recombination ON the merged X,Z path
  // ([0,1,1]) wins; with it OFF the single-route competitor X,W,Z ([0,2,1])
  // wins. So the emitted ids alone prove which mode ran.
  const NEG = -20;
  const mergeScript = [
    { logits: [0, NEG, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, 0] },
    { logits: [NEG, -1.0, -0.5, NEG, NEG, NEG], step: 2, durLogits: [-Infinity, NEG, 0] },
    { logits: [NEG, -1.0, NEG, -0.5, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] },
    { logits: [NEG, 0, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] },
  ];
  const runMerge = (mergeDuplicates) => makeModel(mergeScript)._decodeBeam(makeTransposed(4), D, 4, {
    beamWidth: 6, temperature: 1.0, frameStride: 1, phraseBoost: null,
    returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES, mergeDuplicates,
  });

  test('merge ON (default) picks the recombined path [0,1,1]', async () => {
    statesCreated = statesDisposed = 0;
    const out = await runMerge(true);
    assert.ok(eqArr(out.ids, [0, 1, 1]), 'recombined X,Z wins');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no state leak');
  });

  test('merge OFF picks the single-route competitor [0,2,1]', async () => {
    statesCreated = statesDisposed = 0;
    const out = await runMerge(false);
    assert.ok(eqArr(out.ids, [0, 2, 1]), 'Viterbi: no recombination, competitor wins');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no state leak with merge off');
  });
});

describe('lengthNormPrune flag end-to-end (_decodeBeam)', () => {
  // The plumbing must reach the prune and still produce a valid decode. On the
  // empty-bias script both the default (final-selection norm) and prune-time
  // norm return the token path; this pins that turning the knob on doesn't
  // break or empty the decode.
  const NEG = -20;
  const emptyBiasScript = [
    { logits: [0, NEG, NEG, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
    { logits: [NEG, 0, NEG, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
    { logits: [NEG, NEG, 0, NEG, NEG, 0.2], step: 1, durLogits: [-Infinity, 0, -Infinity] },
  ];
  test('length-normalized pruning keeps the token path non-empty', async () => {
    statesCreated = statesDisposed = 0;
    const out = await makeModel(emptyBiasScript)._decodeBeam(makeTransposed(3), D, 3, {
      beamWidth: 6, temperature: 1.0, frameStride: 1, phraseBoost: null,
      returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
      ...MAES, maesExpansionGamma: 2.3, lengthNormPrune: true,
    });
    assert.ok(eqArr(out.ids, [0, 1, 2]), 'token path returned under prune-time normalization');
    assert.ok(statesCreated > 0 && statesCreated === statesDisposed, 'no state leak');
  });
});

describe('nBest (oracle) list (_decodeBeam)', () => {
  const NEG = -20;
  // Same merge construction: it finishes with (at least) two distinct
  // sequences, [0,1,1] (merged winner) and [0,2,1] (competitor), so the n-best
  // list must surface both.
  const mergeScript = [
    { logits: [0, NEG, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, 0] },
    { logits: [NEG, -1.0, -0.5, NEG, NEG, NEG], step: 2, durLogits: [-Infinity, NEG, 0] },
    { logits: [NEG, -1.0, NEG, -0.5, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] },
    { logits: [NEG, 0, NEG, NEG, NEG, NEG], step: 1, durLogits: [-Infinity, 0, NEG] },
  ];
  const run = (nBest) => makeModel(mergeScript)._decodeBeam(makeTransposed(4), D, 4, {
    beamWidth: 6, temperature: 1.0, frameStride: 1, phraseBoost: null,
    returnTimestamps: false, returnConfidences: false, timeStride: 0.08, ...MAES, nBest,
  });

  test('default (nBest=1) carries no nbest field', async () => {
    const out = await run(1);
    assert.equal(out.nbest, undefined, 'nbest absent on the default path');
  });

  test('nBest>1 returns distinct sequences, best first, 1-best on top', async () => {
    const out = await run(3);
    assert.ok(Array.isArray(out.nbest), 'nbest is an array');
    assert.ok(out.nbest.length >= 2 && out.nbest.length <= 3, 'between 2 and nBest entries');
    assert.ok(eqArr(out.nbest[0].ids, out.ids), '1-best equals the top of the n-best list');
    // strictly descending length-normalized scores
    for (let i = 1; i < out.nbest.length; i++) {
      assert.ok(out.nbest[i - 1].score >= out.nbest[i].score, 'scores are non-increasing');
    }
    // distinct id-sequences
    const keys = out.nbest.map((h) => h.ids.join(','));
    assert.equal(new Set(keys).size, keys.length, 'all n-best sequences are distinct');
    assert.ok(keys.includes('0,1,1') && keys.includes('0,2,1'), 'both finishing routes are present');
  });

  test('collecting the n-best does not perturb the 1-best decode', async () => {
    const base = await run(1);
    const withN = await run(5);
    assert.ok(eqArr(base.ids, withN.ids), 'the winning path is identical with or without n-best');
  });
});
