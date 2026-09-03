// Tier-1 unit test for resolveFiles() in scripts/transcribe.mjs: the per-quant
// model-file resolver the CLI (transcribe.mjs) and the grid-search benchmark use
// to find the encoder/decoder/vocab in a --model-dir.
//
// The regression this pins: the SmoothQuant int8 encoder has TWO valid names.
// The published HF repo (and the e2e fetch) use the canonical
// `encoder-model.int8.onnx`, while the model-repo working folder
// (parakeet-tdt-0.6b-v3-optimized-onnx/) keeps the descriptive
// `encoder-model.int8.smoothquant.onnx`. resolveFiles must accept BOTH (canonical
// first, SmoothQuant as a fallback) so `--model-dir` can point at either layout;
// before the fix, pointing at the working folder threw "Missing
// encoder-model.int8.onnx". The int8 decoder keeps its single name in both.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';

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

// A --model-dir can be laid out three ways and resolveFiles has to cope with all
// of them: one directory per precision (the current repo layout), entirely flat
// (upstream, older mirrors, an `hf download` of a pre-move revision), and flat
// with the fp32 shards under sharded/. The rules live in app/src/modelLayout.js;
// these pin that resolveFiles actually goes through them.
describe('resolveFiles: repo layouts', () => {
  test('the nested layout: each quant resolves inside its own directory', () => {
    const dir = makeModelDir([
      'vocab.txt',
      'fp32/encoder-model.onnx', 'fp32/decoder_joint-model.onnx',
      'int8/encoder-model.int8.onnx', 'int8/decoder_joint-model.int8.onnx',
      'fp16/encoder-model.fp16.onnx', 'fp16/decoder_joint-model.fp16.onnx',
    ]);
    const int8 = resolveFiles(dir, 'int8');
    assert.equal(int8.encoderPath, join(dir, 'int8', 'encoder-model.int8.onnx'));
    assert.equal(int8.decoderPath, join(dir, 'int8', 'decoder_joint-model.int8.onnx'));
    assert.equal(int8.vocabPath, join(dir, 'vocab.txt'));
    const f32 = resolveFiles(dir, 'fp32');
    assert.equal(f32.encoderPath, join(dir, 'fp32', 'encoder-model.onnx'));
    const f16 = resolveFiles(dir, 'fp16');
    assert.equal(f16.encoderPath, join(dir, 'fp16', 'encoder-model.fp16.onnx'));
    // Mixed quants each follow their own directory.
    const mixed = resolveFiles(dir, 'int8', 'fp32');
    assert.equal(mixed.encoderPath, join(dir, 'int8', 'encoder-model.int8.onnx'));
    assert.equal(mixed.decoderPath, join(dir, 'fp32', 'decoder_joint-model.onnx'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('the nested layout: the external-data sidecar is found beside the graph', () => {
    // collectExternalData reads dirname(encoderPath), so the resolved path has to
    // carry the directory or the fp32 sidecar would be looked for at the root.
    const dir = makeModelDir([
      'vocab.txt',
      'fp32/encoder-model.onnx', 'fp32/encoder-model.onnx.data',
      'fp32/decoder_joint-model.onnx',
    ]);
    const r = resolveFiles(dir, 'fp32');
    assert.equal(dirname(r.encoderPath), join(dir, 'fp32'));
    assert.ok(existsSync(join(dirname(r.encoderPath), 'encoder-model.onnx.data')));
    rmSync(dir, { recursive: true, force: true });
  });

  test('the flat layout still resolves at the root', () => {
    const dir = makeModelDir([
      'vocab.txt', 'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
      'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.onnx',
    ]);
    const int8 = resolveFiles(dir, 'int8');
    assert.equal(int8.encoderPath, join(dir, 'encoder-model.int8.onnx'));
    const f32 = resolveFiles(dir, 'fp32');
    assert.equal(f32.encoderPath, join(dir, 'encoder-model.onnx'));
    assert.equal(dirname(f32.encoderPath), dir);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the flat + sharded/ layout resolves the fp32 encoder in sharded/', () => {
    // The layout the optimized repo published before the move, minus the root
    // single-sidecar graph: only sharded/ carries the fp32 encoder, and the shard
    // set has to be found next to it.
    const dir = makeModelDir([
      'vocab.txt', 'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
      'decoder_joint-model.onnx',
      'sharded/encoder-model.onnx',
      'sharded/encoder-model.onnx.data.000', 'sharded/encoder-model.onnx.data.001',
    ]);
    const r = resolveFiles(dir, 'fp32', 'int8');
    assert.equal(r.encoderPath, join(dir, 'sharded', 'encoder-model.onnx'));
    assert.equal(dirname(r.encoderPath), join(dir, 'sharded'));
    // The int8 decoder is NOT in sharded/, and must still resolve at the root.
    assert.equal(r.decoderPath, join(dir, 'decoder_joint-model.int8.onnx'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('a root copy wins over sharded/ when both exist', () => {
    const dir = makeModelDir([
      'vocab.txt', 'decoder_joint-model.onnx',
      'encoder-model.onnx', 'sharded/encoder-model.onnx',
    ]);
    const r = resolveFiles(dir, 'fp32');
    assert.equal(r.encoderPath, join(dir, 'encoder-model.onnx'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('a precision folder wins over a stale root copy', () => {
    const dir = makeModelDir([
      'vocab.txt', 'decoder_joint-model.int8.onnx',
      'encoder-model.int8.onnx', 'int8/encoder-model.int8.onnx',
    ]);
    const r = resolveFiles(dir, 'int8');
    assert.equal(r.encoderPath, join(dir, 'int8', 'encoder-model.int8.onnx'));
    rmSync(dir, { recursive: true, force: true });
  });
});

// One build per quant, under the canonical names. The graph work the model repo
// does (optimize-encoder-graph.py fold on the encoders, optimize-decoder-graph.py
// lse + topk on the decoders) lands IN those files, so there is no `.optimized.`
// / `.lse.` / `.lse.topk.` name to prefer any more and a dir either holds an
// optimized build under the canonical name or a stock upstream one. Whether the
// decoder actually carries the extra outputs is discovered at runtime from the
// loaded session's outputNames (parakeet.js _topkOutputsReady), never from the
// filename, which is what makes dropping the name preferences safe.
describe('resolveFiles: canonical names only', () => {
  for (const [quant, encoder, decoder] of [
    ['int8', 'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx'],
    ['fp32', 'encoder-model.onnx', 'decoder_joint-model.onnx'],
    ['fp16', 'encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx'],
  ]) {
    test(`${quant} ignores the withdrawn variant filenames sitting next to the canonical ones`, () => {
      const stem = encoder.replace(/\.onnx$/, '');
      const dstem = decoder.replace(/\.onnx$/, '');
      const dir = makeModelDir([
        `${stem}.optimized.onnx`,
        `${dstem}.lse.onnx`,
        `${dstem}.lse.topk.onnx`,
        encoder,
        decoder,
        'vocab.txt',
      ]);
      const r = resolveFiles(dir, quant);
      assert.equal(basename(r.encoderPath), encoder);
      assert.equal(basename(r.decoderPath), decoder);
      rmSync(dir, { recursive: true, force: true });
    });
  }

  test('a dir holding ONLY a withdrawn variant name fails loudly instead of resolving it', () => {
    // Better a clear "Missing encoder" than silently loading a file the app can
    // no longer be given (hub.js does not serve these names either).
    const dir = makeModelDir([
      'encoder-model.int8.smoothquant.optimized.onnx',
      'decoder_joint-model.int8.onnx',
      'vocab.txt',
    ]);
    assert.throws(() => resolveFiles(dir, 'int8'), /Missing encoder/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('mixed quants resolve each side canonically (int8 encoder + fp32 decoder_joint)', () => {
    // The app's actual pairing on WebGPU-adjacent setups.
    const dir = makeModelDir([
      'encoder-model.int8.onnx',
      'decoder_joint-model.onnx',
      'vocab.txt',
    ]);
    const r = resolveFiles(dir, 'int8', 'fp32');
    assert.equal(basename(r.encoderPath), 'encoder-model.int8.onnx');
    assert.equal(basename(r.decoderPath), 'decoder_joint-model.onnx');
    rmSync(dir, { recursive: true, force: true });
  });
});

