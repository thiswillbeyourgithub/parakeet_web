// Unit test for the TDT beam decoder (app/src/parakeet.js) and its pure helpers.
// No ONNX/model download is needed: we borrow the prototype methods onto a stub
// `model` and mock _runCombinedStep with a scripted, context-free joiner (logits
// depend only on the frame index, encoded into the fake encoder tensor). That
// makes greedy globally optimal, so beam search of ANY width must reproduce the
// greedy output exactly. We then check that phrase boosting steers the beam.
//
// Run from the repo root:  node scripts/test-beam-decode.mjs
// Built with Claude Code.

import { ParakeetModel } from '../app/src/parakeet.js';
import { BoostingTrie } from '../app/src/phraseBoost.js';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { console.log(`FAIL  ${name}`); failures++; }
}
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
  const model = {
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
        newState: { state1: {}, state2: {} },
        _logitsTensor: { dispose() {} },
      };
    },
  };
  return model;
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

// --- Pure helpers --------------------------------------------------------
console.log('pure helpers:');
{
  const m = makeModel([]);
  const lg = Float32Array.from([0.1, 3.0, -1, 2.9, 0.0, -5]);
  check('_pickArgmax finds the max index', m._pickArgmax.call(m, lg).maxId === 1);
  check('_pickArgmax reports the max value', close(m._pickArgmax.call(m, lg).maxLogit, 3.0));
  const top = m._topK.call(m, lg, 3).sort((a, b) => a - b);
  check('_topK returns the 3 largest indices', eqArr(top, [0, 1, 3]) || eqArr(top, [1, 3, 0].sort((a, b) => a - b)));
  // logSumExp sanity: for all-equal logits, lse = log(n) + c
  const flat = Float32Array.from([2, 2, 2, 2]);
  check('_logSumExp of equal logits', close(m._logSumExp.call(m, flat), 2 + Math.log(4)));
  // _frameConfidence at temperature 0 is 1.0 (greedy); at T=1 it is a softmax prob
  check('_frameConfidence temp 0 => 1.0', m._frameConfidence.call(m, lg, 3.0, 0) === 1.0);
  const c1 = m._frameConfidence.call(m, lg, 3.0, 1.0);
  check('_frameConfidence temp 1 in (0,1)', c1 > 0 && c1 < 1);
  // _advanceDecision branches
  const d1 = m._advanceDecision.call(m, 4, 0, 2, 3, 1);   // step>0 => +step
  check('_advanceDecision step>0 advances by step', d1.nextT === 7 && d1.nextEmitted === 0 && d1.emit === true);
  const d2 = m._advanceDecision.call(m, 4, 0, BLANK, 0, 1); // blank, step0 => +frameStride
  check('_advanceDecision blank advances by frameStride', d2.nextT === 5 && d2.emit === false);
  const d3 = m._advanceDecision.call(m, 4, 0, 2, 0, 1);   // non-blank, step0, under cap => stay
  check('_advanceDecision stays for multi-emit', d3.nextT === 4 && d3.nextEmitted === 1 && d3.emit === true);
  const d4 = m._advanceDecision.call(m, 4, 9, 2, 0, 1);   // at cap (9+1>=10) => advance
  check('_advanceDecision advances at max-tokens cap', d4.nextT === 5 && d4.nextEmitted === 0);
}

// --- A scripted, context-free utterance ----------------------------------
// Each frame's argmax is a distinct token; step>=1 so the frame pointer always
// advances (no degenerate same-frame multi-emit in this script).
const script = [
  { logits: [3.0, 0.1, 0.0, 0.2, 0.1, -1.0], step: 1 }, // argmax 0
  { logits: [0.0, 2.5, 0.3, 0.1, 0.0, -1.0], step: 1 }, // argmax 1
  { logits: [0.1, 0.2, 0.1, 0.0, 0.0,  4.0], step: 1 }, // argmax BLANK (5)
  { logits: [0.2, 0.1, 3.1, 0.4, 0.0, -1.0], step: 2 }, // argmax 2, duration 2
  { logits: [0.0, 0.1, 0.2, 3.3, 0.1, -1.0], step: 1 }, // argmax 3
  { logits: [0.1, 0.0, 0.1, 0.2, 2.7, -1.0], step: 1 }, // argmax 4
];
const Tenc = script.length;

async function runBeam(model, beamWidth, { phraseBoost = null, temperature = 1.0 } = {}) {
  phraseBoost?.reset();
  return model._decodeBeam(makeTransposed(Tenc), D, Tenc, {
    beamWidth, temperature, frameStride: 1, phraseBoost,
    returnTimestamps: true, returnConfidences: true,
    timeStride: model.subsampling * model.windowStride,
  });
}

// --- Equivalence: beam(width) == greedy on a context-free model ----------
console.log('beam == greedy (context-free):');
{
  const ref = refGreedy(makeModel(script), script, 1.0);
  for (const width of [1, 2, 4]) {
    statesCreated = statesDisposed = joinerCalls = 0;
    const model = makeModel(script);
    const out = await runBeam(model, width);
    check(`width ${width}: ids match greedy`, eqArr(out.ids, ref.ids));
    check(`width ${width}: frameConfs match greedy`, eqFloatArr(out.frameConfs, ref.frames));
    check(`width ${width}: overallLogProb matches greedy`, close(out.overallLogProb, ref.overall));
    // Frame 2 argmax is blank (no emit); frame 3 has TDT duration 2 so it skips
    // frame 4's token (3), giving [0, 1, 2, 4].
    check(`width ${width}: emitted tokens are 0,1,2,4`, eqArr(out.ids, [0, 1, 2, 4]));
    check(`width ${width}: tokenConfs length == #emitted`, out.tokenConfs.length === out.ids.length);
    check(`width ${width}: timestamps length == #emitted`, out.tokenTimes.length === out.ids.length);
    check(`width ${width}: all decoder states disposed (no leak)`, statesCreated > 0 && statesCreated === statesDisposed);
  }
}

// --- Phrase boosting steers the beam -------------------------------------
console.log('phrase boosting steers the beam:');
{
  // At frame 4 the argmax is token 3. Boost the single-token phrase [2] hard so
  // that, when token 2 is a live continuation, it wins. Easiest deterministic
  // check: boost a token that is NOT any frame's argmax and confirm a strong
  // enough reward makes it appear in the output where it otherwise never would.
  const model = makeModel(script);
  // Boost token 4's *prefix* won't help (it is already emitted last). Instead
  // boost token 0 as a standalone phrase with a big weight and verify that at a
  // frame where token 0 is runner-up it can flip the choice. Build a tailored
  // 1-frame script for an unambiguous assertion.
  const tinyScript = [
    { logits: [1.0, 0.0, 0.0, 0.0, 0.0, 2.0], step: 1 }, // argmax BLANK; token 0 runner-up
  ];
  const tinyModel = makeModel(tinyScript);
  const noBoost = await tinyModel._decodeBeam(makeTransposed(1), D, 1, {
    beamWidth: 3, temperature: 1.0, frameStride: 1, phraseBoost: null,
    returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
  });
  check('without boost: frame emits nothing (blank wins)', eqArr(noBoost.ids, []));

  const trie = new BoostingTrie({ strength: 10 });
  trie.insert([0], 5);   // phrase = token 0, weight 5 => boosted logit 1.0 + 50
  trie.reset();
  const boosted = await tinyModel._decodeBeam(makeTransposed(1), D, 1, {
    beamWidth: 3, temperature: 1.0, frameStride: 1, phraseBoost: trie,
    returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
  });
  check('with strong boost: token 0 is emitted', eqArr(boosted.ids, [0]));
  check('boost does not corrupt the true overallLogProb (<= 0)', boosted.overallLogProb <= 0);
}

// --- Degenerate input ----------------------------------------------------
console.log('degenerate input:');
{
  const model = makeModel(script);
  const out = await model._decodeBeam(new Float32Array(0), D, 0, {
    beamWidth: 4, temperature: 1.0, frameStride: 1, phraseBoost: null,
    returnTimestamps: false, returnConfidences: false, timeStride: 0.08,
  });
  check('Tenc=0 returns empty result', eqArr(out.ids, []) && out.overallLogProb === 0);
}

console.log(`\n${failures === 0 ? 'PASS' : failures + ' FAILED'}`);
process.exit(failures ? 1 : 0);
