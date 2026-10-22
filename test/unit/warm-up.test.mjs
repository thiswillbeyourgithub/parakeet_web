// Tier-1 unit test for ParakeetModel.warmUp(): the load-time warm-up that moves
// WebGPU's first-run shader compile out of the first transcription. It must
// run the SAME memoized ragged-batch probe transcribeChunked awaits (so the
// later call is free), and must be a no-op wherever no probe would run (WASM,
// encoder-less worker models), so the CPU path never pays an extra encode.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel } from '../../app/src/parakeet.js';

function fakeModel({ maxEncoderBatch, encoderSession = {} }) {
  const m = Object.create(ParakeetModel.prototype);
  m.maxEncoderBatch = maxEncoderBatch;
  m.encoderSession = encoderSession;
  m.verbose = false;
  m.encodeCalls = [];
  m.encodeBatch = async (pcms) => { m.encodeCalls.push(['batch', pcms.map((p) => p.length)]); return pcms.map(() => ({ transposed: new Float32Array(4), D: 2, Tenc: 2 })); };
  m.encode = async (pcm) => { m.encodeCalls.push(['solo', pcm.length]); return { transposed: new Float32Array(4), D: 2, Tenc: 2 }; };
  return m;
}

test('a batching encoder runs the ragged probe once, and transcribeChunked reuses it', async () => {
  const m = fakeModel({ maxEncoderBatch: 2 });
  assert.equal(await m.warmUp(), true);
  assert.deepEqual(m.encodeCalls, [['batch', [16000, 11200]], ['solo', 11200]]);
  // The probe is memoized: the call transcribeChunked makes later encodes nothing.
  assert.equal(await m.raggedBatchOk(), true);
  assert.equal(m.encodeCalls.length, 2);
});

test('WASM (no batching) and encoder-less models do not warm up', async () => {
  for (const m of [fakeModel({ maxEncoderBatch: 1 }), fakeModel({ maxEncoderBatch: 4, encoderSession: null })]) {
    assert.equal(await m.warmUp(), false);
    assert.deepEqual(m.encodeCalls, []);
  }
});
