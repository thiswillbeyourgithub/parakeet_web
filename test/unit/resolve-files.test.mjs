// Tier-1 unit test for resolveFiles() in scripts/transcribe.mjs: the per-quant
// model-file resolver the CLI (transcribe.mjs) and the grid-search benchmark use
// to find the encoder/decoder/vocab in a --model-dir.
//
// The regression this pins: the SmoothQuant int8 encoder has TWO valid names.
// The published HF repo (and the e2e fetch) use the canonical
// `encoder-model.int8.onnx`, while the model-repo working folder
// (parakeet-tdt-0.6b-v3-smoothquant-onnx/) keeps the descriptive
// `encoder-model.int8.smoothquant.onnx`. resolveFiles must accept BOTH (canonical
// first, SmoothQuant as a fallback) so `--model-dir` can point at either layout;
// before the fix, pointing at the working folder threw "Missing
// encoder-model.int8.onnx". The int8 decoder keeps its single name in both.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { resolveFiles } from '../../scripts/transcribe.mjs';

// Build a temp model dir containing exactly the given files (empty placeholders;
// resolveFiles only checks existence, never reads them).
function makeModelDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'resolvefiles-'));
  for (const f of files) {
    const p = join(dir, f);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, '');
  }
  return dir;
}

describe('resolveFiles: per-quant encoder/decoder/vocab resolution', () => {
  test('int8 prefers the canonical encoder-model.int8.onnx when both names exist', () => {
    const dir = makeModelDir([
      'encoder-model.int8.onnx',
      'encoder-model.int8.smoothquant.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.onnx');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.onnx');
    assert.equal(basename(r.vocabPath), 'vocab.txt');
    rmSync(dir, { recursive: true, force: true });
  });

  test('int8 falls back to encoder-model.int8.smoothquant.onnx (model-repo working folder)', () => {
    // The working-folder layout: only the SmoothQuant-named encoder is present.
    const dir = makeModelDir([
      'encoder-model.int8.smoothquant.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.smoothquant.onnx');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('int8 resolves the canonical layout (published / HF cache)', () => {
    const dir = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp16 and fp32 resolve their plain names', () => {
    const dir = makeModelDir([
      'encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx',
      'encoder-model.onnx', 'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    const f16 = resolveFiles(dir, 'fp16');
    assert.equal(basename(f16.encoderPath), 'encoder-model.fp16.onnx');
    assert.equal(basename(f16.decoderPath), 'decoder_joint-model.fp16.onnx');
    const f32 = resolveFiles(dir, 'fp32');
    assert.equal(basename(f32.encoderPath), 'encoder-model.onnx');
    assert.equal(basename(f32.decoderPath), 'decoder_joint-model.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing int8 encoder names BOTH candidates it tried', () => {
    // Decoder + vocab present, but neither encoder name -> the error must list both.
    const dir = makeModelDir(['decoder_joint-model.int8.onnx', 'vocab.txt']);
    assert.throws(() => resolveFiles(dir, 'int8'), (e) => {
      assert.match(e.message, /Missing encoder/);
      assert.match(e.message, /encoder-model\.int8\.onnx/);
      assert.match(e.message, /encoder-model\.int8\.smoothquant\.onnx/);
      return true;
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing vocab.txt throws', () => {
    const dir = makeModelDir(['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx']);
    assert.throws(() => resolveFiles(dir, 'int8'), /Missing vocab\.txt/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unknown quant throws', () => {
    const dir = makeModelDir(['vocab.txt']);
    assert.throws(() => resolveFiles(dir, 'int4'), /Unknown quant "int4"/);
    rmSync(dir, { recursive: true, force: true });
  });
});
