// planPipelineWorkers decides which off-thread halves a freshly loaded model
// gets. Every failure in this area falls back to the in-thread path, which
// produces the same transcript, so a gate that stops matching reality costs
// throughput and nothing else notices. These tests are the only thing that can
// notice.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planPipelineWorkers, buildWorkerInitParams } from '../../app/ui/src/lib/pipelinePlan.js';

// A machine that clears the hardware gate (>= 12 logical cores, >= 8 GB, >= 2
// threads), so a test that is not about hardware never trips over it.
const BIG = { cpuThreads: 6, maxCores: 12, deviceMemory: 16 };
const base = {
  backend: 'wasm',
  wasmEncoderRequest: 'int8',
  wasmDecodePipelineEnabled: true,
  parallelEncode: true,
  ...BIG,
};
const plan = (over = {}) => planPipelineWorkers({ ...base, ...over });

describe('planPipelineWorkers: encode pool eligibility', () => {
  test('a WASM int8 load on capable hardware is pool-eligible', () => {
    assert.equal(plan().poolEligible, true);
  });

  test('fp32 is refused a pool: each worker would hold its own ~2.4 GB copy', () => {
    assert.equal(plan({ wasmEncoderRequest: 'fp32' }).poolEligible, false);
  });

  test('the other WASM builds are pool-eligible', () => {
    for (const q of ['int8', 'int8lite', 'w4a8']) {
      assert.equal(plan({ wasmEncoderRequest: q }).poolEligible, true, q);
    }
  });

  test('WebGPU never gets a pool: the encoder is on the GPU', () => {
    for (const backend of ['webgpu', 'webgpu-hybrid']) {
      assert.equal(plan({ backend }).poolEligible, false, backend);
    }
  });

  test('an unrecognised backend gets neither half', () => {
    // A corrupted stored setting. A pool stashed for a backend the transcribe
    // path will never recognise could not engage anyway, so stashing it is pure
    // waste; the decode worker is not WebGPU so it is refused too.
    const p = plan({ backend: 'nonsense' });
    assert.equal(p.poolEligible, false);
    assert.equal(p.decodeWorkerEligible, false);
  });

  test('eligibility survives the toggle being off, so it can be flipped back on', () => {
    // The STASH is what lets the sidebar toggle start the pool later without a
    // model reload; only `startPool` follows the toggle.
    const p = plan({ parallelEncode: false });
    assert.equal(p.poolEligible, true);
    assert.equal(p.startPool, false);
    assert.equal(p.poolStopReason, 'parallel encode disabled');
  });

  test('an ineligible model reports a different stop reason than a disabled toggle', () => {
    assert.equal(plan({ wasmEncoderRequest: 'fp32' }).poolStopReason, 'encode pool unsupported for this model');
  });

  test('a started pool carries no stop reason', () => {
    const p = plan();
    assert.equal(p.startPool, true);
    assert.equal(p.poolStopReason, null);
  });
});

describe('planPipelineWorkers: WASM composed mode', () => {
  test('WASM composed needs the model, the operator opt-in AND the hardware', () => {
    assert.equal(plan().composedEligible, true);
    assert.equal(plan({ wasmDecodePipelineEnabled: false }).composedEligible, false);
    assert.equal(plan({ wasmEncoderRequest: 'fp32' }).composedEligible, false);
    assert.equal(plan({ maxCores: 8 }).composedEligible, false);
  });

  test('the hardware gate is the pool\'s own, asked in advance', () => {
    // No point building a decode worker for a composed mode that can never form
    // because the pool half will be refused at start time.
    assert.equal(plan({ maxCores: 11 }).composedEligible, false, 'cores');
    assert.equal(plan({ deviceMemory: 4 }).composedEligible, false, 'memory');
    assert.equal(plan({ cpuThreads: 1 }).composedEligible, false, 'threads');
    assert.equal(plan({ deviceMemory: undefined }).composedEligible, true, 'unknown RAM passes');
  });

  test('composed is never claimed on WebGPU', () => {
    assert.equal(plan({ backend: 'webgpu-hybrid' }).composedEligible, false);
  });
});

describe('planPipelineWorkers: decode worker', () => {
  test('WebGPU always gets one, pool and toggle irrelevant', () => {
    for (const parallelEncode of [true, false]) {
      for (const wasmDecodePipelineEnabled of [true, false]) {
        const p = plan({ backend: 'webgpu-hybrid', parallelEncode, wasmDecodePipelineEnabled, maxCores: 2 });
        assert.equal(p.decodeWorkerEligible, true);
        assert.equal(p.startDecodeWorker, true);
        assert.equal(p.decodeWorkerStopReason, null);
      }
    }
  });

  test('WASM gets one only in composed mode', () => {
    assert.equal(plan().decodeWorkerEligible, true);
    assert.equal(plan({ wasmDecodePipelineEnabled: false }).decodeWorkerEligible, false);
    assert.equal(plan({ wasmDecodePipelineEnabled: false }).decodeWorkerStopReason,
      'decode pipeline unsupported for this model');
  });

  test('the WASM worker follows the parallelEncode toggle, the WebGPU one does not', () => {
    const wasm = plan({ parallelEncode: false });
    assert.equal(wasm.decodeWorkerEligible, true, 'stash kept so the toggle can compose later');
    assert.equal(wasm.startDecodeWorker, false);
    assert.equal(wasm.decodeWorkerStopReason, 'parallel encode disabled');

    const gpu = plan({ backend: 'webgpu-hybrid', parallelEncode: false });
    assert.equal(gpu.startDecodeWorker, true);
  });

  test('the worker takes 2 threads on WASM and the user budget on WebGPU', () => {
    // The decode loop's joiner GEMMs do not scale with threads, and on WASM the
    // pool already budgets ~all the cores.
    assert.equal(plan({ cpuThreads: 6 }).decodeNumThreads, 2);
    assert.equal(plan({ backend: 'webgpu-hybrid', cpuThreads: 6 }).decodeNumThreads, 6);
  });
});

describe('planPipelineWorkers: invariants', () => {
  const BACKENDS = ['wasm', 'webgpu-hybrid', 'nonsense'];
  const QUANTS = ['int8', 'int8lite', 'w4a8', 'fp32'];
  const CORES = [2, 8, 12, 24];

  function* every() {
    for (const backend of BACKENDS) {
      for (const wasmEncoderRequest of QUANTS) {
        for (const wasmDecodePipelineEnabled of [true, false]) {
          for (const parallelEncode of [true, false]) {
            for (const maxCores of CORES) {
              for (const deviceMemory of [4, 16, undefined]) {
                const args = {
                  backend, wasmEncoderRequest, wasmDecodePipelineEnabled,
                  parallelEncode, maxCores, deviceMemory, cpuThreads: 6,
                };
                yield [args, planPipelineWorkers(args)];
              }
            }
          }
        }
      }
    }
  }

  test('a half never starts unless it is eligible', () => {
    for (const [args, p] of every()) {
      const where = JSON.stringify(args);
      if (p.startPool) assert.equal(p.poolEligible, true, where);
      if (p.startDecodeWorker) assert.equal(p.decodeWorkerEligible, true, where);
    }
  });

  test('a started half has no stop reason and a stopped one always has one', () => {
    for (const [args, p] of every()) {
      const where = JSON.stringify(args);
      assert.equal(p.poolStopReason === null, p.startPool, where);
      assert.equal(p.decodeWorkerStopReason === null, p.startDecodeWorker, where);
    }
  });

  test('composed mode implies both halves are eligible', () => {
    for (const [args, p] of every()) {
      if (!p.composedEligible) continue;
      const where = JSON.stringify(args);
      assert.equal(p.poolEligible, true, where);
      assert.equal(p.decodeWorkerEligible, true, where);
      assert.equal(args.backend, 'wasm', where);
    }
  });

  test('a WASM decode worker is only ever eligible as part of composed mode', () => {
    // The measured reason: alone it is a slight LOSS, because the pool already
    // overlaps decode with encode.
    for (const [args, p] of every()) {
      if (args.backend !== 'wasm') continue;
      assert.equal(p.decodeWorkerEligible, p.composedEligible, JSON.stringify(args));
    }
  });

  test('the two WASM halves start and stop together', () => {
    for (const [args, p] of every()) {
      if (args.backend !== 'wasm' || !p.composedEligible) continue;
      assert.equal(p.startDecodeWorker, p.startPool, JSON.stringify(args));
    }
  });
});

describe('buildWorkerInitParams: what each allowed half is handed', () => {
  const URLS = {
    encoderUrl: 'blob:enc',
    encoderDataUrl: 'blob:enc.data',
    preprocessorUrl: 'blob:pre',
    decoderUrl: 'blob:dec',
    decoderDataUrl: 'blob:dec.data',
    tokenizerUrl: 'blob:tok',
  };
  const build = (plan, extra = {}) => buildWorkerInitParams({
    plan,
    urls: URLS,
    filenames: ['encoder-model.onnx'],
    nMels: 128,
    preprocessorBackend: 'wasm',
    ortVariant: 'jspi',
    ...extra,
  });

  test('an eligible pool is handed the encoder, the preprocessor and its mel count', () => {
    const { encodePoolInit } = build({ poolEligible: true, decodeWorkerEligible: false, decodeNumThreads: 2 });
    assert.equal(encodePoolInit.type, 'init');
    assert.equal(encodePoolInit.encoderUrl, 'blob:enc');
    assert.equal(encodePoolInit.encoderDataUrl, 'blob:enc.data');
    assert.equal(encodePoolInit.preprocessorUrl, 'blob:pre');
    assert.equal(encodePoolInit.preprocessorBackend, 'wasm');
    assert.equal(encodePoolInit.nMels, 128);
    assert.deepEqual(encodePoolInit.filenames, ['encoder-model.onnx']);
  });

  test('an eligible decode worker is handed the decoder, the tokenizer and its thread count', () => {
    const { decodeWorkerInit } = build({ poolEligible: false, decodeWorkerEligible: true, decodeNumThreads: 2 });
    assert.equal(decodeWorkerInit.type, 'init');
    assert.equal(decodeWorkerInit.decoderUrl, 'blob:dec');
    assert.equal(decodeWorkerInit.decoderDataUrl, 'blob:dec.data');
    assert.equal(decodeWorkerInit.tokenizerUrl, 'blob:tok');
    assert.equal(decodeWorkerInit.numThreads, 2);
  });

  test('the decode worker gets the plan\'s thread count, not the user\'s budget', () => {
    const { decodeWorkerInit } = build({ poolEligible: false, decodeWorkerEligible: true, decodeNumThreads: 11 });
    assert.equal(decodeWorkerInit.numThreads, 11);
  });

  test('an ineligible half is not stashed at all', () => {
    const none = build({ poolEligible: false, decodeWorkerEligible: false, decodeNumThreads: 2 });
    assert.equal(none.encodePoolInit, null);
    assert.equal(none.decodeWorkerInit, null);
  });

  test('the encode pool is never handed the decoder, nor the decode worker the encoder', () => {
    // They are different ORT sessions; a payload carrying the other half's URLs
    // would build the wrong graph in a worker that then silently falls back.
    const both = build({ poolEligible: true, decodeWorkerEligible: true, decodeNumThreads: 2 });
    assert.equal(both.encodePoolInit.decoderUrl, undefined);
    assert.equal(both.encodePoolInit.tokenizerUrl, undefined);
    assert.equal(both.decodeWorkerInit.encoderUrl, undefined);
    assert.equal(both.decodeWorkerInit.preprocessorUrl, undefined);
  });

  test('ortVariant travels in EVERY stashed payload', () => {
    // The one that has actually gone wrong: each worker is its own JS context
    // with its own ORT runtime, and ORT pins one runtime per context, so a
    // payload missing the variant leaves that context on the default. The first
    // jspi plumbing missed the probe workers and ran 3 jsep / 2 jspi in one
    // page, which no transcript can show.
    for (const variant of ['jsep', 'jspi']) {
      for (const poolEligible of [true, false]) {
        for (const decodeWorkerEligible of [true, false]) {
          const out = build(
            { poolEligible, decodeWorkerEligible, decodeNumThreads: 2 },
            { ortVariant: variant },
          );
          for (const payload of [out.encodePoolInit, out.decodeWorkerInit]) {
            if (payload === null) continue;
            assert.equal(payload.ortVariant, variant, JSON.stringify({ variant, poolEligible, decodeWorkerEligible }));
          }
        }
      }
    }
  });
});
