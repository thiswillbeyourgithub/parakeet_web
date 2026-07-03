// Tier-1 unit test for the opt-in decode-debug collection (collectDecodeDebug
// in app/src/parakeet.js): the per-token records (true logit, log-prob, boost
// bonus, TDT duration, top-k alternatives) behind the UI's per-entry "Debug"
// token view, plus the beam timeline and transcribeChunked's per-chunk
// aggregation.
//
// Same mocking approach as beam-decode.test.mjs (scripted, context-free joiner
// borrowed onto a stub via the real prototype methods), but driven through
// transcribe() itself using the `opts.encoded` bypass so the GREEDY loop's
// collection code runs too (beam-decode.test.mjs only enters _decodeBeam).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel } from '../../app/src/parakeet.js';
import { BoostingTrie } from '../../app/src/phraseBoost.js';

const V = 6;        // vocab size (token ids 0..4, blank = 5)
const BLANK = 5;
const D = 2;        // fake encoder feature dim

const fakeOrt = {
  Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } dispose() {} },
};

const PRED_L = 2;
const PRED_H = 3;
const fakeState = () =>
  new fakeOrt.Tensor('float32', new Float32Array(PRED_L * PRED_H), [PRED_L, 1, PRED_H]);

// One-hot duration logits at spec.step so beam duration-branching picks the
// same duration greedy would (keeps the context-free script greedy-optimal).
const specDurLogits = (spec) =>
  Float32Array.from({ length: spec.step + 1 }, (_, i) => (i === spec.step ? 0 : -Infinity));

const proto = ParakeetModel.prototype;

// Stub delegating to the real prototype methods under test. Includes
// transcribe()/transcribeChunked() (unlike beam-decode.test.mjs's stub) plus
// the tokenizer/normalizer/encode collaborators they touch. `▁`-prefixed
// pieces exercise the piece mapping the debug payload reports.
function makeModel(script) {
  const nDur = Math.max(2, ...script.filter(Boolean).map((s) => s.step + 1));
  const id2token = ['▁a', 'b', '▁c', 'd', 'e', '<blk>'];
  const model = {
    blankId: BLANK,
    maxTokensPerStep: 10,
    subsampling: 8,
    windowStride: 0.01,
    verbose: false,
    ort: fakeOrt,
    predLayers: PRED_L,
    predHidden: PRED_H,
    tokenizer: {
      id2token,
      blankToken: '<blk>',
      unkToken: '<unk>',
      decode: (ids) => ids.map((i) => id2token[i]).join(''),
    },
    _normalizer: (s) => s,
    _combState1: fakeState(),
    _combState2: fakeState(),
    transcribe: proto.transcribe,
    transcribeChunked: proto.transcribeChunked,
    _debugEmitRecord: proto._debugEmitRecord,
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
    _disposeDecoderState: () => {},
    _runCombinedStep: async (encTensor) => {
      const t = Math.round(encTensor.data[0]); // frame index encoded in feature 0
      const spec = script[t];
      return {
        tokenLogits: Float32Array.from(spec.logits),
        step: spec.step,
        durLogits: specDurLogits(spec),
        newState: { state1: fakeState(), state2: fakeState() },
        _logitsTensor: { dispose() {} },
      };
    },
    joinerSession: {
      run: async (feeds) => {
        const B = feeds.targets.dims[0];
        const total = V + nDur;
        const out = new Float32Array(B * total).fill(-Infinity);
        for (let b = 0; b < B; b++) {
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
  // transposed[t*D] = t so the mocked joiner can recover the frame index.
  model.encodedFor = (Tenc) => {
    const transposed = new Float32Array(Tenc * D);
    for (let t = 0; t < Tenc; t++) transposed[t * D] = t;
    return { transposed, D, Tenc };
  };
  model.encode = async () => model.encodedFor(script.length);
  return model;
}

// Deterministic 3-frame script: emit token 2, emit token 0, then blank. Token
// 1 is the runner-up on the emitting frames so alternatives are non-trivial.
const SCRIPT = [
  { logits: [0.5, 1.0, 3.0, 0.0, 0.0, 0.2], step: 1 }, // argmax token 2
  { logits: [2.5, 1.5, 0.0, 0.0, 0.0, 0.3], step: 1 }, // argmax token 0
  { logits: [0.0, 0.0, 0.0, 0.0, 0.0, 4.0], step: 1 }, // argmax blank
];

const baseOpts = { returnTimestamps: true, temperature: 1.0 };

describe('collectDecodeDebug: greedy path', () => {
  test('off by default: result carries no decodeDebug', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      ...baseOpts, encoded: model.encodedFor(SCRIPT.length),
    });
    assert.equal(res.decodeDebug, undefined);
  });

  test('per-token records aligned with the emitted sequence', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      ...baseOpts, encoded: model.encodedFor(SCRIPT.length), collectDecodeDebug: true,
    });
    const dbg = res.decodeDebug;
    assert.ok(dbg, 'decodeDebug present');
    assert.equal(dbg.strategy, 'greedy');
    assert.equal(dbg.beamWidth, 1);
    assert.equal(dbg.beamTimeline, null);
    assert.equal(dbg.tokens.length, 2); // tokens 2 then 0 emitted
    const [t2, t0] = dbg.tokens;
    assert.equal(t2.id, 2);
    assert.equal(t2.piece, '▁c');
    assert.equal(t2.frame, 0);
    assert.equal(t2.duration, 1);
    assert.equal(t2.logit, 3.0);
    assert.ok(t2.logp < 0, 'log-prob is negative');
    assert.equal(t2.boostBonus, 0);
    assert.equal(t2.start, 0);         // frame 0 * 0.08s
    assert.equal(t0.id, 0);
    assert.equal(t0.frame, 1);
    assert.equal(t0.logit, 2.5);
    // Alternatives: top-k of the true distribution, chosen included, sorted
    // best-first, each with piece + logit + logp.
    assert.ok(t2.alternatives.length >= 2);
    assert.equal(t2.alternatives[0].id, 2, 'chosen token ranks first (no boost)');
    assert.equal(t2.alternatives[1].id, 1, 'runner-up is the next-best logit');
    for (const a of t2.alternatives) {
      assert.equal(typeof a.piece, 'string');
      assert.ok(Number.isFinite(a.logit) && Number.isFinite(a.logp));
    }
  });

  test('boost flip: bonus reported on the chosen token and its alternatives', async () => {
    // Blank (2.0) beats token 0 (1.0) unboosted; a strength-10 weight-5 boost
    // (+50) flips the argmax to token 0. The record must show the true logit
    // (1.0) with boostBonus 50, and rank the winner by boosted value.
    const script = [{ logits: [1.0, 0.0, 0.0, 0.0, 0.0, 2.0], step: 1 }];
    const model = makeModel(script);
    const trie = new BoostingTrie({ strength: 10 });
    trie.insert([0], 5);
    trie.reset();
    const res = await model.transcribe(new Float32Array(0), 16000, {
      ...baseOpts, encoded: model.encodedFor(1), collectDecodeDebug: true, phraseBoost: trie,
    });
    assert.equal(res.decodeDebug.tokens.length, 1);
    const tok = res.decodeDebug.tokens[0];
    assert.equal(tok.id, 0);
    assert.equal(tok.logit, 1.0, 'true (unboosted) logit reported');
    assert.equal(tok.boostBonus, 50);
    assert.equal(tok.alternatives[0].id, 0, 'boosted winner ranks first');
    assert.equal(tok.alternatives[0].boostBonus, 50);
    const blankAlt = tok.alternatives.find((a) => a.id === BLANK);
    assert.ok(blankAlt && blankAlt.boostBonus === 0, 'unboosted alternative has zero bonus');
  });
});

describe('collectDecodeDebug: confidence is the intrinsic (temperature-1) token probability', () => {
  // Regression for "confidence always 1.0 in the debug view": the app pins the
  // decoder temperature to 0, and _frameConfidence returns a constant 1.0 at
  // temperature 0 (a point-mass softmax). The debug conf must instead report the
  // chosen token's temperature-1 softmax probability exp(logp), so it stays a
  // real, sub-1.0 confidence at the app's actual temperature.
  const expectedProb = (logits, chosenId) => {
    const m = Math.max(...logits);
    const Z = logits.reduce((s, v) => s + Math.exp(v - m), 0);
    return Math.exp(logits[chosenId] - m) / Z;
  };

  test('greedy: temperature 0 yields a meaningful (<1) conf equal to exp(logp)', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      returnTimestamps: true, temperature: 0, // the app's pinned default
      encoded: model.encodedFor(SCRIPT.length), collectDecodeDebug: true,
    });
    const [t2, t0] = res.decodeDebug.tokens;
    // The bug: this used to be exactly 1.0 for every token.
    assert.ok(t2.conf < 1 && t2.conf > 0, `token 2 conf is a real probability, got ${t2.conf}`);
    assert.ok(t0.conf < 1 && t0.conf > 0, `token 0 conf is a real probability, got ${t0.conf}`);
    // conf == exp(logp) == softmax prob of the chosen token on the true logits.
    assert.ok(Math.abs(t2.conf - Math.exp(t2.logp)) < 1e-3, 'conf tracks exp(logp)');
    assert.ok(Math.abs(t2.conf - expectedProb(SCRIPT[0].logits, 2)) < 1e-3, 'conf is the token-2 softmax prob');
    assert.ok(Math.abs(t0.conf - expectedProb(SCRIPT[1].logits, 0)) < 1e-3, 'conf is the token-0 softmax prob');
  });

  test('greedy: conf is identical at temperature 0 and temperature 1 (decoupled from the UI knob)', async () => {
    const at = async (temperature) => {
      const model = makeModel(SCRIPT);
      const res = await model.transcribe(new Float32Array(0), 16000, {
        returnTimestamps: true, temperature,
        encoded: model.encodedFor(SCRIPT.length), collectDecodeDebug: true,
      });
      return res.decodeDebug.tokens.map((tk) => tk.conf);
    };
    assert.deepEqual(await at(0), await at(1));
  });

  test('beam: temperature 0 conf is the same intrinsic probability, not 1.0', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      returnTimestamps: true, temperature: 0,
      encoded: model.encodedFor(SCRIPT.length), collectDecodeDebug: true, beamWidth: 2,
    });
    const [t2, t0] = res.decodeDebug.tokens;
    assert.ok(t2.conf < 1 && t2.conf > 0, `beam token 2 conf is a real probability, got ${t2.conf}`);
    assert.ok(Math.abs(t2.conf - Math.exp(t2.logp)) < 1e-3, 'beam conf tracks exp(logp)');
    assert.ok(Math.abs(t2.conf - expectedProb(SCRIPT[0].logits, 2)) < 1e-3, 'beam conf is the token-2 softmax prob');
    assert.ok(Math.abs(t0.conf - expectedProb(SCRIPT[1].logits, 0)) < 1e-3, 'beam conf is the token-0 softmax prob');
  });
});

describe('collectDecodeDebug: beam path', () => {
  test('winner-path records + beam timeline', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      ...baseOpts, encoded: model.encodedFor(SCRIPT.length), collectDecodeDebug: true, beamWidth: 2,
    });
    const dbg = res.decodeDebug;
    assert.equal(dbg.strategy, 'beam');
    assert.equal(dbg.beamWidth, 2);
    // Context-free script: the beam reproduces greedy, records aligned.
    assert.deepEqual(dbg.tokens.map((tk) => tk.id), [2, 0]);
    for (const tk of dbg.tokens) {
      assert.ok(Number.isFinite(tk.score), 'beam tokens carry the joint (token+duration) rank score');
      assert.ok(tk.alternatives.length >= 2, 'expansion alternatives recorded');
      assert.ok(tk.alternatives.some((a) => a.id === tk.id), 'chosen token present in alternatives');
    }
    // Timeline: one snapshot per worked frame, hypotheses labelled with score
    // + decoded tail. (On the final blank frame the survivors move past Tenc
    // into the finished set, so inspect the last snapshot with a live beam.)
    assert.ok(Array.isArray(dbg.beamTimeline) && dbg.beamTimeline.length > 0);
    const withBeam = dbg.beamTimeline.filter((f) => f.hyps.length > 0);
    assert.ok(withBeam.length > 0, 'at least one snapshot holds live hypotheses');
    const snap = withBeam[withBeam.length - 1];
    assert.equal(typeof snap.frame, 'number');
    assert.equal(typeof snap.merged, 'number');
    for (const h of snap.hyps) {
      assert.ok(Number.isFinite(h.score) && Number.isFinite(h.normScore));
      assert.ok(Array.isArray(h.tail) && Array.isArray(h.tailPieces));
      assert.equal(h.tail.length, h.tailPieces.length);
    }
    // The winning sequence's tail must be visible somewhere in the timeline.
    assert.ok(withBeam.some((f) => f.hyps.some((h) => h.tail.join(',').endsWith('2,0'))),
      'winner tail visible in a timeline snapshot');
  });

  test('off by default on the beam path too', async () => {
    const model = makeModel(SCRIPT);
    const res = await model.transcribe(new Float32Array(0), 16000, {
      ...baseOpts, encoded: model.encodedFor(SCRIPT.length), beamWidth: 2,
    });
    assert.equal(res.decodeDebug, undefined);
  });
});

describe('collectDecodeDebug: transcribeChunked aggregation', () => {
  test('single pass wraps as one chunk', async () => {
    const model = makeModel(SCRIPT);
    const audio = new Float32Array(16000); // 1 s
    const res = await model.transcribeChunked(audio, 16000, {
      ...baseOpts, enableChunking: false, collectDecodeDebug: true,
    });
    assert.ok(res.decodeDebug);
    assert.equal(res.decodeDebug.chunks.length, 1);
    const c = res.decodeDebug.chunks[0];
    assert.equal(c.chunkNum, 1);
    assert.equal(c.startSec, 0);
    assert.equal(c.endSec, 1);
    assert.equal(c.tokens.length, 2);
  });

  test('chunked run: one debug entry per chunk with absolute windows', async () => {
    const model = makeModel(SCRIPT);
    const audio = new Float32Array(32000); // 2 s -> two 1 s chunks (no overlap)
    const res = await model.transcribeChunked(audio, 16000, {
      temperature: 1.0, chunkDurationSec: 1, overlapSec: 0, collectDecodeDebug: true,
    });
    assert.ok(res.decodeDebug);
    assert.equal(res.decodeDebug.chunks.length, 2);
    assert.deepEqual(res.decodeDebug.chunks.map((c) => c.chunkNum), [1, 2]);
    assert.deepEqual(res.decodeDebug.chunks.map((c) => c.startSec), [0, 1]);
    assert.deepEqual(res.decodeDebug.chunks.map((c) => c.endSec), [1, 2]);
    for (const c of res.decodeDebug.chunks) assert.equal(c.tokens.length, 2);
  });

  test('chunked run without the flag stays clean', async () => {
    const model = makeModel(SCRIPT);
    const audio = new Float32Array(32000);
    const res = await model.transcribeChunked(audio, 16000, {
      temperature: 1.0, chunkDurationSec: 1, overlapSec: 0,
    });
    assert.equal(res.decodeDebug, undefined);
  });
});
