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

  test('an explicit decoderQuant resolves the decoder independently of the encoder', () => {
    // The headline mix: keep the heavy encoder int8 but run the small
    // decoder_joint at full fp32 precision (the new default for the CLIs).
    const dir = makeModelDir([
      'encoder-model.int8.smoothquant.onnx', // working-folder int8 encoder
      'decoder_joint-model.int8.onnx',
      'decoder_joint-model.onnx',             // fp32 decoder also present
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8', 'fp32');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.smoothquant.onnx');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('decoderQuant defaults to the encoder quant when omitted (matched, legacy behaviour)', () => {
    const dir = makeModelDir([
      'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
      'decoder_joint-model.onnx', // fp32 decoder present but must NOT be picked
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8'); // no decoderQuant -> matches encoder
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing decoder for the requested decoderQuant names that decoder file', () => {
    // int8 encoder present, fp32 decoder requested but absent -> error names the
    // fp32 decoder, not the int8 one.
    const dir = makeModelDir([
      'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt',
    ]);
    assert.throws(() => resolveFiles(dir, 'int8', 'fp32'), (e) => {
      assert.match(e.message, /Missing decoder/);
      assert.match(e.message, /decoder_joint-model\.onnx/);
      return true;
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unknown decoderQuant throws', () => {
    const dir = makeModelDir(['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'vocab.txt']);
    assert.throws(() => resolveFiles(dir, 'int8', 'int4'), /Unknown decoder quant "int4"/);
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

// The optimized encoder (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/
// optimize-encoder-graph.py fold: identical numerics, ~23% fewer graph nodes,
// faster session build) outranks every other name when the model dir ships it.
// Shipping the file is the opt-in, so its absence (every dir predating it) must
// resolve exactly as before; the existing tests above pin that side.
describe('resolveFiles: optimized encoder preference', () => {
  test('int8 prefers encoder-model.int8.smoothquant.optimized.onnx over both stock names', () => {
    const dir = makeModelDir([
      'encoder-model.int8.smoothquant.optimized.onnx',
      'encoder-model.int8.onnx',
      'encoder-model.int8.smoothquant.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.smoothquant.optimized.onnx');
    // The decoder has no optimized variant and must stay on its single name.
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp16 prefers encoder-model.fp16.optimized.onnx when present', () => {
    const dir = makeModelDir([
      'encoder-model.fp16.optimized.onnx',
      'encoder-model.fp16.onnx',
      'decoder_joint-model.fp16.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'fp16');
    assert.equal(basename(r.encoderPath), 'encoder-model.fp16.optimized.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp32 keeps the stock encoder even when the optimized one is present', () => {
    // Unlike int8/fp16, whose `.optimized.` builds are a preference, the
    // optimized fp32 build is only a fallback, so stock is first in the
    // candidate list and the optimized graph serves a dir that ships nothing
    // else. NOTE: the ~23% GPU slowdown that originally set this order has been
    // RETRACTED (it predated the page-animation fix; re-measured 2026-08-23 at
    // 4.7% the OTHER way, unresolved at p=0.092). This test pins the CURRENT
    // shipped behaviour, not a still-valid perf finding: see the hub.js
    // optimizedEncoderName comment. If the preference is ever flipped, flip
    // this expectation with it rather than weakening the test.
    const dir = makeModelDir([
      'encoder-model.optimized.onnx',
      'encoder-model.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    assert.equal(basename(resolveFiles(dir, 'fp32').encoderPath), 'encoder-model.onnx');
    rmSync(dir, { recursive: true, force: true });

    const optOnly = makeModelDir([
      'encoder-model.optimized.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    assert.equal(basename(resolveFiles(optOnly, 'fp32').encoderPath), 'encoder-model.optimized.onnx',
      'a dir shipping only the optimized build must still resolve');
    rmSync(optOnly, { recursive: true, force: true });
  });
});

// The LSE decoder (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/
// optimize-decoder-graph.py lse: the identical joint graph plus in-graph
// lse_token/lse_duration log-partition outputs the beam decoder consumes via
// _partition) outranks the stock decoder name when the model dir ships it.
// As with the optimized encoder, shipping the file is the opt-in; absence must
// resolve exactly as before (pinned by the suites above).
describe('resolveFiles: LSE decoder preference', () => {
  test('int8 prefers decoder_joint-model.int8.lse.onnx over the stock name', () => {
    const dir = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.int8.lse.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.lse.onnx');
    // The encoder resolution is independent of the decoder's lse variant.
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp32 prefers decoder_joint-model.lse.onnx over the stock name', () => {
    const dir = makeModelDir([
      'encoder-model.onnx',
      'decoder_joint-model.lse.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'fp32');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.lse.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp16 has no LSE variant and ignores a stray lse-named file', () => {
    // No fp16 lse artifact is shipped (an fp16 graph would accumulate the
    // partition in fp16), so even a plausibly-named file must never be picked.
    const dir = makeModelDir([
      'encoder-model.fp16.onnx',
      'decoder_joint-model.fp16.lse.onnx',
      'decoder_joint-model.fp16.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'fp16');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.fp16.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('mixed quants pick each side\'s preferred artifact (int8 optimized encoder + fp32 lse decoder)', () => {
    // The app's actual pairing: int8 encoder with the fp32 decoder_joint.
    const dir = makeModelDir([
      'encoder-model.int8.smoothquant.optimized.onnx',
      'encoder-model.int8.onnx',
      'decoder_joint-model.lse.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8', 'fp32');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.smoothquant.optimized.onnx');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.lse.onnx');
    rmSync(dir, { recursive: true, force: true });
  });
});

// The TopK decoder (optimize-decoder-graph.py topk) is the LSE graph plus
// in-graph topk_logits/topk_ids/duration_logits, so the greedy loop can fetch a
// few dozen floats per joint call instead of the whole row (parakeet.js
// TOPK_FETCHES). Strict superset, hence ahead of `.lse.` in the candidate list;
// mirrors hub.js TOPK_DECODER_NAMES.
describe('resolveFiles: TopK decoder preference', () => {
  test('int8 prefers decoder_joint-model.int8.lse.topk.onnx over lse and stock', () => {
    const dir = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.int8.lse.topk.onnx',
      'decoder_joint-model.int8.lse.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.int8.lse.topk.onnx');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('fp32 prefers decoder_joint-model.lse.topk.onnx over lse and stock', () => {
    const dir = makeModelDir([
      'encoder-model.onnx',
      'decoder_joint-model.lse.topk.onnx',
      'decoder_joint-model.lse.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'fp32');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.lse.topk.onnx');
    rmSync(dir, { recursive: true, force: true });
  });

  test('no topk file -> the lse decoder still wins, then the stock name', () => {
    const lseOnly = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.int8.lse.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    assert.equal(basename(resolveFiles(lseOnly, 'int8').decoderPath), 'decoder_joint-model.int8.lse.onnx');
    rmSync(lseOnly, { recursive: true, force: true });

    const stockOnly = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    assert.equal(basename(resolveFiles(stockOnly, 'int8').decoderPath), 'decoder_joint-model.int8.onnx');
    rmSync(stockOnly, { recursive: true, force: true });
  });

  test('fp16 has no TopK variant and ignores a stray topk-named file', () => {
    const dir = makeModelDir([
      'encoder-model.fp16.onnx',
      'decoder_joint-model.fp16.lse.topk.onnx',
      'decoder_joint-model.fp16.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'fp16');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.fp16.onnx');
    rmSync(dir, { recursive: true, force: true });
  });
});
