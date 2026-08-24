// Tier-1 unit test for the in-graph TOP-K decoder outputs (app/src/parakeet.js
// TOPK_FETCHES / _readTopkStep / the greedy loop's `topkStepOpts` plan).
//
// The stage-2 decoder artifact (decoder_joint-model*.lse.topk.onnx) appends
// topk_logits / topk_ids / duration_logits to the stock outputs, so a decode
// step can fetch a few dozen floats instead of reading the whole ~8.2k-float
// `outputs` row back out of ORT. What has to hold:
//   - when the fast path engages, session.run() is called with EXACTLY the
//     reduced fetch list,
//   - when it does not (switched off, phrase boosting, beam search, a decoder
//     that lacks the outputs, a row too short for what the step reads),
//     session.run() is called with the explicit FULL-ROW list: the logit row,
//     both states, and the lse pair only when the decoder declares it. Naming
//     them matters, because an unnamed run() fetches EVERY declared output, so
//     on a top-K decoder the full-row paths would compute and marshal
//     topk_logits / topk_ids / duration_logits they never read (+27% wall over
//     800 steps at batch 8, onnxruntime-node, CPU EP),
//   - the decoded result is identical to the full-row path, except that ties
//     between exactly-equal top logits may be broken in a different ORDER by
//     the ONNX TopK than by the JS argmax scan (accepted divergence, the
//     candidate SET still matches).
//
// No ONNX/model download: a real ParakeetModel is built on a fake `ort` and a
// scripted joiner session that records every `fetches` argument it is handed.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel } from '../../app/src/parakeet.js';
import { BoostingTrie } from '../../app/src/phraseBoost.js';

const V = 8;          // token logits (ids 0..6, blank = 7)
const BLANK = 7;
const N_DUR = 3;      // TDT duration logits (index == frame advance)
const D = 2;          // fake encoder feature dim
// Match the real model's prediction-network geometry: the ParakeetModel
// constructor allocates its zero states from these, and _runCombinedStepBatch
// validates the batched state size against them.
const PRED_L = 2, PRED_H = 640;

const STOCK_OUTPUTS = ['outputs', 'prednet_lengths', 'output_states_1', 'output_states_2'];
const LSE_OUTPUTS = [...STOCK_OUTPUTS, 'lse_token', 'lse_duration'];
const TOPK_OUTPUTS = [...LSE_OUTPUTS, 'topk_logits', 'topk_ids', 'duration_logits'];
// What parakeet.js must ask for when the fast path engages (order included: it
// is a fixed module constant there, so pinning it here catches a silent edit).
const EXPECTED_FETCHES = [
  'output_states_1', 'output_states_2',
  'lse_token', 'lse_duration',
  'topk_logits', 'topk_ids', 'duration_logits',
];
// What the FULL-ROW paths must ask for on a decoder that declares the lse pair.
// Order included, same reason as above: it is assembled from fixed module
// constants in parakeet.js, so pinning it catches a silent edit.
const FULL_ROW_FETCHES = [
  'outputs', 'output_states_1', 'output_states_2', 'lse_token', 'lse_duration',
];
// Same list on a decoder WITHOUT the lse pair. The optional half has to drop
// out rather than be requested: ORT throws on an output name the graph does not
// declare, which is why the list is built from the session instead of hardcoded.
const FULL_ROW_FETCHES_STOCK = ['outputs', 'output_states_1', 'output_states_2'];

// --- fake ORT -------------------------------------------------------------
// Tensors track disposal so a run can assert the fast path frees every buffer
// it reads (the full path's leak-safety is covered by beam-decode.test.mjs).
let liveTensors = [];
class FakeTensor {
  constructor(type, data, dims) {
    this.type = type; this.data = data; this.dims = dims; this.disposed = false;
  }
  dispose() { this.disposed = true; }
}
const fakeOrt = {
  Tensor: class extends FakeTensor {
    constructor(type, data, dims) { super(type, data, dims); }
  },
};
// Tensors minted by the scripted session. Only the ones actually HANDED to the
// decode loop are tracked (see the return paths below): a real ORT run never
// materialises an output that was not fetched, so tracking the rest would make
// the leak assertion meaningless.
const sessionTensor = (type, data, dims) => new fakeOrt.Tensor(type, data, dims);
const track = (out) => { liveTensors.push(...Object.values(out)); return out; };

const logSumExp = (arr) => {
  const m = Math.max(...arr);
  if (!Number.isFinite(m)) return m;
  return m + Math.log(arr.reduce((s, v) => s + Math.exp(v - m), 0));
};

/**
 * Scripted joiner session. `script[t]` is the full token-logit row for encoder
 * frame t plus its duration logits; the session recovers t from the encoder
 * feed (makeTransposed writes the frame index there), so the script is
 * context-free and greedy is globally optimal.
 *
 * `tieBreak` decides how the in-graph top-K orders EXACTLY equal logits: 'asc'
 * mimics lowest-index-first (what the JS argmax scan does), 'desc' the opposite,
 * which is the divergence the ONNX TopK is allowed to introduce.
 */
function makeSession({ script, outputNames = TOPK_OUTPUTS, k = 16, tieBreak = 'asc' }) {
  const calls = [];
  return {
    calls,
    outputNames,
    async run(feeds, fetches) {
      calls.push(arguments.length < 2 ? null : fetches);
      // One row per batch entry (the beam decoder batches its hypotheses into
      // one call, see _runCombinedStepBatch); the frame index rides in the
      // encoder feed, so the script stays context-free.
      const B = feeds.targets.dims[0];
      const total = V + N_DUR;
      const full = new Float32Array(B * total);
      const kOf = [];
      for (let b = 0; b < B; b++) {
        const t = Math.round(feeds.encoder_outputs.data[b * D]);
        const spec = script[t];
        assert.ok(spec, `script has no entry for frame ${t}`);
        assert.equal(spec.logits.length, V);
        assert.equal(spec.durLogits.length, N_DUR);
        full.set(spec.logits, b * total);
        full.set(spec.durLogits, b * total + V);
        kOf.push(spec);
      }

      const all = {};
      all['outputs'] = sessionTensor('float32', full, [B, 1, 1, total]);
      all['prednet_lengths'] = sessionTensor('int32', new Int32Array(B).fill(1), [B]);
      all['output_states_1'] = sessionTensor('float32', new Float32Array(PRED_L * B * PRED_H), [PRED_L, B, PRED_H]);
      all['output_states_2'] = sessionTensor('float32', new Float32Array(PRED_L * B * PRED_H), [PRED_L, B, PRED_H]);
      if (outputNames.includes('lse_token')) {
        all['lse_token'] = sessionTensor('float32', Float32Array.from(kOf, (s) => logSumExp(s.logits)), [B, 1, 1]);
        all['lse_duration'] = sessionTensor('float32', Float32Array.from(kOf, (s) => logSumExp(s.durLogits)), [B, 1, 1]);
      }
      if (outputNames.includes('topk_logits')) {
        const width = Math.min(k, V);
        const tl = new Float32Array(B * width);
        const ti = new Int32Array(B * width);
        const dl = new Float32Array(B * N_DUR);
        kOf.forEach((spec, b) => {
          const order = spec.logits.map((_, i) => i).sort((x, y) => (
            spec.logits[y] - spec.logits[x] || (tieBreak === 'asc' ? x - y : y - x)
          )).slice(0, width);
          order.forEach((id, i) => { tl[b * width + i] = spec.logits[id]; ti[b * width + i] = id; });
          dl.set(spec.durLogits, b * N_DUR);
        });
        all['topk_logits'] = sessionTensor('float32', tl, [B, 1, 1, width]);
        all['topk_ids'] = sessionTensor('int32', ti, [B, 1, 1, width]);
        all['duration_logits'] = sessionTensor('float32', dl, [B, 1, 1, N_DUR]);
      }
      if (arguments.length < 2) return track(all);
      // ORT returns ONLY what was requested; anything else must never be read.
      assert.ok(Array.isArray(fetches) && fetches.length > 0, 'fetches must be a non-empty string array');
      const out = {};
      for (const name of fetches) {
        assert.ok(outputNames.includes(name), `fetched unknown output ${name}`);
        out[name] = all[name];
      }
      return track(out);
    },
  };
}

// transposed[t*D] = t so the scripted joiner can recover the frame index.
function makeTransposed(n) {
  const a = new Float32Array(n * D);
  for (let t = 0; t < n; t++) a[t * D] = t;
  return a;
}

const PIECES = ['▁a', 'b', '▁c', 'd', '▁e', 'f', '▁g', '<blk>'];
const fakeTokenizer = () => ({
  id2token: PIECES.slice(),
  blankId: BLANK,
  blankToken: '<blk>',
  unkToken: '<unk>',
  decode: (ids) => ids.map((i) => PIECES[i]).join('').replace(/▁/g, ' ').trim(),
});

function makeModel(sessionCfg) {
  const joinerSession = makeSession(sessionCfg);
  const model = new ParakeetModel({
    tokenizer: fakeTokenizer(),
    encoderSession: null,
    joinerSession,
    preprocessor: null,
    ort: fakeOrt,
  });
  return { model, joinerSession };
}

// One-hot-ish logit row helper: `top` is the winning token id.
const row = (top, { step = 1, ties = [], base = -6 } = {}) => {
  const logits = new Array(V).fill(base).map((v, i) => v - i * 0.25);
  logits[top] = 3;
  for (const id of ties) logits[id] = 3;
  const durLogits = new Array(N_DUR).fill(-4);
  durLogits[step] = 2;
  return { logits, durLogits };
};

const runTranscribe = async (model, script, opts = {}) => {
  const Tenc = script.length;
  const encoded = { transposed: makeTransposed(Tenc), D, Tenc, preprocess_ms: 0, encode_ms: 0 };
  const res = await model.transcribe(new Float32Array(16000), 16000, {
    temperature: 0,
    returnTimestamps: true,
    returnConfidences: true,
    encoded,
    ...opts,
  });
  delete res.metrics; // wall-clock only, never comparable between two runs
  return res;
};

// A short scripted utterance: three emissions then a blank that runs the
// remaining frames out.
const SCRIPT = [
  row(0, { step: 1 }),
  row(1, { step: 1 }),
  row(2, { step: 1 }),
  row(BLANK, { step: 1 }),
  row(BLANK, { step: 1 }),
];
const SCRIPT_TEXT = 'ab c'; // PIECES: '▁a' + 'b' + '▁c'

describe('top-K decoder outputs: engagement and fetch list', () => {
  test('greedy on a top-K decoder fetches ONLY the reduced output list, once per step', async () => {
    liveTensors = [];
    const { model, joinerSession } = makeModel({ script: SCRIPT });
    const res = await runTranscribe(model, SCRIPT);

    assert.ok(joinerSession.calls.length > 0);
    for (const fetches of joinerSession.calls) {
      assert.deepEqual(fetches, EXPECTED_FETCHES, 'every fast-path call fetches exactly TOPK_FETCHES');
    }
    assert.ok(!EXPECTED_FETCHES.includes('outputs'), 'the ~8.2k-float row must never be fetched');
    assert.equal(res.utterance_text, SCRIPT_TEXT);
    // Nothing the fast path read may stay alive: the small tensors are copied
    // out and freed inside _readTopkStep, the states by the decode loop.
    const leaked = liveTensors.filter((t) => !t.disposed);
    assert.deepEqual(leaked, [], `fast path leaked ${leaked.length} tensors`);
  });

  test('logs the engaged marker exactly once per model', async () => {
    const { model } = makeModel({ script: SCRIPT });
    const seen = [];
    const orig = console.log;
    console.log = (...a) => { seen.push(a.join(' ')); };
    try {
      await runTranscribe(model, SCRIPT);
      await runTranscribe(model, SCRIPT);
    } finally { console.log = orig; }
    const markers = seen.filter((l) => l.includes('TopK decoder outputs engaged'));
    assert.equal(markers.length, 1, `expected one marker, saw: ${seen.join(' | ')}`);
    assert.equal(markers[0], '[Parakeet.js] TopK decoder outputs engaged (k=8)');
  });

  test('useTopkOutputs:false (model level and per call) fetches the explicit full-row list', async () => {
    const perCall = makeModel({ script: SCRIPT });
    await runTranscribe(perCall.model, SCRIPT, { useTopkOutputs: false });
    assert.deepEqual(perCall.joinerSession.calls, perCall.joinerSession.calls.map(() => FULL_ROW_FETCHES),
      'a disabled fast path still names the outputs it reads');

    const joinerSession = makeSession({ script: SCRIPT });
    const model = new ParakeetModel({
      tokenizer: fakeTokenizer(), encoderSession: null, joinerSession,
      preprocessor: null, ort: fakeOrt, useTopkOutputs: false,
    });
    await runTranscribe(model, SCRIPT);
    assert.deepEqual(joinerSession.calls, joinerSession.calls.map(() => FULL_ROW_FETCHES));
  });

  test('the full-row list never carries the top-K outputs or prednet_lengths', async () => {
    // The regression this guards, and the reason the list is explicit at all:
    // run(feeds) with NO fetches argument returns EVERY declared output, so on
    // a decoder carrying the repo's topk surgery the beam and boosting paths
    // silently computed and marshalled topk_logits / topk_ids / duration_logits
    // they never read, plus prednet_lengths that nothing has ever read.
    const waste = ['topk_logits', 'topk_ids', 'duration_logits', 'prednet_lengths'];
    for (const opts of [{ beamWidth: 3 }, { temperature: 1.2 }, { useTopkOutputs: false }]) {
      const { model, joinerSession } = makeModel({ script: SCRIPT });
      await runTranscribe(model, SCRIPT, opts);
      assert.ok(joinerSession.calls.length > 0);
      for (const fetches of joinerSession.calls) {
        assert.ok(Array.isArray(fetches),
          `${JSON.stringify(opts)}: the full-row path must NAME its outputs, not fetch all of them`);
        for (const name of waste) {
          assert.ok(!fetches.includes(name),
            `${JSON.stringify(opts)}: full-row list must not carry ${name}`);
        }
        assert.ok(fetches.includes('outputs'), 'the full-row path does need the logit row');
      }
    }
  });

  test('a phrase-boost trie keeps the full logit row (boosting reads arbitrary ids)', async () => {
    const { model, joinerSession } = makeModel({ script: SCRIPT });
    const trie = new BoostingTrie();
    trie.insert([1, 2], 5);
    const res = await runTranscribe(model, SCRIPT, { phraseBoost: trie });
    assert.deepEqual(joinerSession.calls, joinerSession.calls.map(() => FULL_ROW_FETCHES),
      'a boosted run must take the full row and never the top-K one');
    assert.ok(res.utterance_text.length > 0);
  });

  test('beam search keeps the full logit row (blank lookup / prefix search need it)', async () => {
    const { model, joinerSession } = makeModel({ script: SCRIPT });
    await runTranscribe(model, SCRIPT, { beamWidth: 3 });
    assert.deepEqual(joinerSession.calls, joinerSession.calls.map(() => FULL_ROW_FETCHES));
    // Same for a width-1 beam forced through the beam decoder.
    const forced = makeModel({ script: SCRIPT });
    await runTranscribe(forced.model, SCRIPT, { forceBeam: true });
    assert.deepEqual(forced.joinerSession.calls, forced.joinerSession.calls.map(() => FULL_ROW_FETCHES));
  });

  test('a decoder without the top-K outputs (stock or lse-only) keeps the full row', async () => {
    // The stock fixture declares no lse pair, so the optional half of the
    // full-row list must drop out: asking for an undeclared output would throw.
    for (const [outputNames, expected] of [
      [STOCK_OUTPUTS, FULL_ROW_FETCHES_STOCK],
      [LSE_OUTPUTS, FULL_ROW_FETCHES],
    ]) {
      const { model, joinerSession } = makeModel({ script: SCRIPT, outputNames });
      const res = await runTranscribe(model, SCRIPT);
      assert.deepEqual(joinerSession.calls, joinerSession.calls.map(() => expected));
      assert.equal(res.utterance_text, SCRIPT_TEXT);
    }
  });

  test('a positive temperature keeps the full row (confidence needs the whole vocab)', async () => {
    const { model, joinerSession } = makeModel({ script: SCRIPT });
    await runTranscribe(model, SCRIPT, { temperature: 1.2 });
    assert.deepEqual(joinerSession.calls, joinerSession.calls.map(() => FULL_ROW_FETCHES));
  });

  test('a top-K row shorter than the step needs falls back to the full row for that step', async () => {
    // decode-debug reports 5 alternatives; a k=3 graph cannot serve them, so
    // the step re-runs on the full-row list and the report stays complete.
    const { model, joinerSession } = makeModel({ script: SCRIPT, k: 3 });
    const res = await runTranscribe(model, SCRIPT, { collectDecodeDebug: true });
    // Every step probes the short row, then re-runs the same feeds full.
    assert.ok(joinerSession.calls.length > 0 && joinerSession.calls.length % 2 === 0);
    joinerSession.calls.forEach((f, i) => {
      assert.deepEqual(f, i % 2 === 0 ? EXPECTED_FETCHES : FULL_ROW_FETCHES,
        `call ${i} should ${i % 2 === 0 ? 'probe the top-K row' : 'fall back to the full row'}`);
    });
    assert.equal(res.decodeDebug.tokens[0].alternatives.length, 5);
    // Same k=3 graph WITHOUT decode-debug only needs the argmax, so it engages.
    const lean = makeModel({ script: SCRIPT, k: 3 });
    await runTranscribe(lean.model, SCRIPT);
    assert.deepEqual(lean.joinerSession.calls, lean.joinerSession.calls.map(() => EXPECTED_FETCHES));
  });
});

describe('top-K decoder outputs: numeric equivalence with the full-row path', () => {
  const compare = async (script, opts = {}) => {
    const fast = makeModel({ script, ...(opts.sessionCfg || {}) });
    const full = makeModel({ script, ...(opts.sessionCfg || {}) });
    const a = await runTranscribe(fast.model, script, opts.transcribe);
    const b = await runTranscribe(full.model, script, { ...opts.transcribe, useTopkOutputs: false });
    return { fastRes: a, fullRes: b, fastCalls: fast.joinerSession.calls };
  };

  test('identical output on a clean script, with and without decode-debug', async () => {
    for (const transcribe of [{}, { collectDecodeDebug: true }]) {
      const { fastRes, fullRes, fastCalls } = await compare(SCRIPT, { transcribe });
      assert.deepEqual(fastCalls, fastCalls.map(() => EXPECTED_FETCHES));
      assert.deepStrictEqual(fastRes, fullRes);
    }
  });

  test('tie between two equal top logits: identical when the graph breaks ties lowest-id first', async () => {
    // The JS argmax keeps the FIRST index it sees, so an ascending in-graph tie
    // break reproduces it exactly, down to the decode-debug alternatives.
    const script = [row(2, { step: 1, ties: [5] }), row(BLANK, { step: 1 })];
    const { fastRes, fullRes } = await compare(script, { transcribe: { collectDecodeDebug: true } });
    assert.deepStrictEqual(fastRes, fullRes);
    assert.equal(fastRes.decodeDebug.tokens[0].id, 2);
  });

  test('tie: a highest-id-first graph may pick the other tied id, everything else matches', async () => {
    // The accepted divergence. The chosen token is still A maximum of the row,
    // its score/duration/confidence are unchanged, and the candidate SET the
    // debug view reports is the same (only its order inside the tie moves).
    const script = [row(2, { step: 1, ties: [5] }), row(BLANK, { step: 1 })];
    const { fastRes, fullRes } = await compare(script, {
      sessionCfg: { tieBreak: 'desc' },
      transcribe: { collectDecodeDebug: true },
    });
    const fastTok = fastRes.decodeDebug.tokens[0];
    const fullTok = fullRes.decodeDebug.tokens[0];
    assert.notEqual(fastTok.id, fullTok.id, 'this fixture is only meaningful when the tie flips');
    assert.deepEqual([fastTok.id, fullTok.id].sort(), [2, 5]);
    assert.equal(fastTok.logit, fullTok.logit);
    assert.equal(fastTok.logp, fullTok.logp);
    assert.equal(fastTok.conf, fullTok.conf);
    assert.equal(fastTok.duration, fullTok.duration);
    assert.equal(fastTok.frame, fullTok.frame);
    assert.deepEqual(
      fastTok.alternatives.map((a) => a.id).sort((x, y) => x - y),
      fullTok.alternatives.map((a) => a.id).sort((x, y) => x - y),
      'the candidate SET must match even when the tie order differs',
    );
    assert.deepStrictEqual(fastRes.confidence_scores.frame, fullRes.confidence_scores.frame);
    assert.equal(fastRes.confidence_scores.overall_log_prob, fullRes.confidence_scores.overall_log_prob);
  });

  test('duration branching and multi-frame skips agree with the full row', async () => {
    const script = [
      row(0, { step: 2 }),
      row(BLANK, { step: 1 }),
      row(4, { step: 0 }),
      row(6, { step: 2 }),
      row(BLANK, { step: 1 }),
      row(BLANK, { step: 1 }),
    ];
    const { fastRes, fullRes } = await compare(script, { transcribe: { collectDecodeDebug: true } });
    assert.deepStrictEqual(fastRes, fullRes);
    assert.ok(fastRes.words.length > 0);
  });
});
