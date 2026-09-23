// Tier-1 unit test for the quant vocabulary in app/src/modelLayout.js and the
// two CLIs that validate against it.
//
// Regression: scripts/grid_search_benchmark.mjs (the MAES beam harness) rejected
// `--quant w4a8` with a hardcoded "--quant must be int8, fp16 or fp32", so the
// model repo's shipped w4a8 encoder had a full greedy WER record and no beam-5
// number at all. Greedy went through scripts/wer-quants.py, which knows w4a8,
// and nothing on the Node side did.
//
// The asymmetry is the part worth pinning: w4a8 is ENCODER-ONLY. The model repo
// ships w4a8/encoder-model.w4a8.onnx and no decoder_joint beside it, so w4a8 is
// valid for --quant and invalid for --decoder-quants, and a run pairs it with
// another precision's decoder. A test that only checked "w4a8 is accepted"
// would pass on a fix that wrongly accepted it everywhere.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QUANT_FILES, ENCODER_QUANTS, DECODER_QUANTS, layoutDirFor } from '../../app/src/modelLayout.js';
import { parseArgs } from '../../scripts/grid_search_benchmark.mjs';

const BASE = ['--manifest', 'x.json', '--ort', 'cuda'];

describe('quant vocabulary (modelLayout)', () => {
  test('w4a8 is a known encoder quant', () => {
    assert.ok(ENCODER_QUANTS.includes('w4a8'));
    assert.deepEqual(QUANT_FILES.w4a8.encoder, ['encoder-model.w4a8.onnx']);
  });

  test('w4a8 is encoder-only: no decoder, so not a decoder quant', () => {
    assert.equal(QUANT_FILES.w4a8.decoder, undefined);
    assert.ok(!DECODER_QUANTS.includes('w4a8'));
  });

  test('the lists are derived from the table, not restated', () => {
    assert.deepEqual(ENCODER_QUANTS, Object.keys(QUANT_FILES));
    assert.deepEqual(DECODER_QUANTS, ENCODER_QUANTS.filter((q) => QUANT_FILES[q].decoder));
  });

  test('every encoder basename lands in the directory its quant names', () => {
    // Ties the vocabulary to the layout rule: a quant whose file resolved to the
    // wrong folder would be unloadable however well the CLI parsed it.
    assert.equal(layoutDirFor('encoder-model.w4a8.onnx'), 'w4a8/');
    assert.equal(layoutDirFor('encoder-model.int8.onnx'), 'int8/');
    assert.equal(layoutDirFor('encoder-model.onnx'), 'fp32/');
  });
});

describe('beam harness --quant / --decoder-quants', () => {
  test('accepts w4a8 as an encoder quant', () => {
    assert.deepEqual(parseArgs([...BASE, '--quant', 'w4a8']).quants, ['w4a8']);
  });

  test('accepts w4a8 alongside the others in one sweep', () => {
    assert.deepEqual(parseArgs([...BASE, '--quant', 'int8,w4a8,fp32']).quants, ['int8', 'w4a8', 'fp32']);
  });

  test('defaults the decoder to int8, which is what w4a8 must pair with', () => {
    assert.deepEqual(parseArgs([...BASE, '--quant', 'w4a8']).decoderQuants, ['int8']);
  });

  test('rejects w4a8 as a DECODER quant, and says why', () => {
    assert.throws(
      () => parseArgs([...BASE, '--quant', 'int8', '--decoder-quants', 'w4a8']),
      /encoder-only and ships no decoder_joint/,
    );
  });

  test('still rejects a quant that does not exist', () => {
    assert.throws(() => parseArgs([...BASE, '--quant', 'int4']), /--quant must be/);
  });

  test('w4a8 stays off the WASM EP, for its own stated reason', () => {
    assert.throws(
      () => parseArgs(['--manifest', 'x.json', '--ort', 'wasm', '--quant', 'w4a8']),
      /never been measured on this EP/,
    );
  });
});
