// Tier-1 unit test for app/ui/src/lib/encoderQuants.js: which encoder precision
// a given source can actually serve, and what to do when the one in use cannot
// be served.
//
// The bug it pins, reported from a deployed instance: the sidebar offered fp16
// on a GPU that does expose shader-f16, took the click, downloaded nothing, and
// then reported "this source does not host the encoder precision you selected
// in a form the GPU can run" and moved the visitor to the CPU. Both halves were
// wrong. The precision was unofferable from the start (the mirror serves int8,
// w4a8 and sharded fp32 and no fp16 file, and says so in its own manifest), and
// the recovery changed the BACKEND for a reason that is a property of the
// deployment, not of the hardware.
//
// So the tests below are written against REAL listings: the verbatim repo
// captures in test/fixtures/repo-listings/, and the file set the reporting
// instance actually serves. A hand-written list of basenames would pass while
// the layouts drift underneath it, which is the failure mode
// test/unit/repo-layout-detection.test.mjs exists to prevent elsewhere.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  QUANT_DOWNLOAD_MB,
  WASM_ENCODER_QUANTS,
  WEBGPU_ENCODER_QUANTS,
  encoderQuantRows,
  encoderQuantsFor,
  nextGpuEncoderQuant,
  servableEncoderQuants,
} from '../../app/ui/src/lib/encoderQuants.js';

function listing(name) {
  const raw = JSON.parse(readFileSync(
    fileURLToPath(new URL(`../fixtures/repo-listings/${name}.json`, import.meta.url)), 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.siblings)) return raw.siblings.map((s) => s.rfilename);
  return raw.files;
}

// What https://parakeetweb.olicorne.org/models/.../model-manifest.json served on
// 2026-09-10, the deployment whose fp16 report this module answers. Kept
// verbatim rather than trimmed: the point is that a REAL mirror's own
// self-description is enough to answer the question in advance.
const DEPLOYED_MIRROR = [
  'config.json',
  'fp32/decoder_joint-model.onnx',
  'fp32/decoder_joint-model.onnx.data',
  'fp32/encoder-model.onnx',
  'fp32/encoder-model.onnx.data.000',
  'fp32/encoder-model.onnx.data.001',
  'int8/decoder_joint-model.int8.onnx',
  'int8/encoder-model.int8.onnx',
  'nemo128.onnx',
  'nemo128.onnx.zst',
  'vocab.txt',
  'w4a8/encoder-model.w4a8.onnx',
];

describe('encoderQuantsFor: what a backend offers at all', () => {
  test('int8 is a WASM-only precision and fp16 a WebGPU-only one', () => {
    // Neither is a policy choice: ORT has no GPU int8 encoder kernel, and the
    // CPU EP upcasts fp16 to fp32 at session build, doubling a 1.2 GB model.
    assert.ok(WASM_ENCODER_QUANTS.includes('int8'));
    assert.ok(!WEBGPU_ENCODER_QUANTS.includes('int8'));
    assert.ok(WEBGPU_ENCODER_QUANTS.includes('fp16'));
    assert.ok(!WASM_ENCODER_QUANTS.includes('fp16'));
  });

  test('a webgpu backend string picks the GPU list however it is spelled', () => {
    assert.deepEqual(encoderQuantsFor('webgpu-hybrid'), WEBGPU_ENCODER_QUANTS);
    assert.deepEqual(encoderQuantsFor('webgpu'), WEBGPU_ENCODER_QUANTS);
    assert.deepEqual(encoderQuantsFor('wasm'), WASM_ENCODER_QUANTS);
    // An unknown or missing backend must not silently offer GPU-only
    // precisions: WASM is the one every machine has.
    assert.deepEqual(encoderQuantsFor(undefined), WASM_ENCODER_QUANTS);
  });
});

describe('servableEncoderQuants: what a source can really deliver', () => {
  test('the deployed mirror that triggered this: no fp16, and it can say so', () => {
    const got = servableEncoderQuants({ repoFiles: DEPLOYED_MIRROR, shaderF16: true });
    // shaderF16 is true here on purpose: the machine could run fp16, which is
    // exactly why the old adapter-only check offered it. The file is what is
    // missing, and it is missing from the mirror's own manifest.
    assert.ok(!got.webgpu.includes('fp16'));
    assert.deepEqual(got.webgpu, ['fp32', 'w4a8']);
    // int8lite is absent for the same reason (its encoder build is not
    // mirrored), while sharded fp32 IS servable, which is the case a naive
    // "does encoder-model.onnx.data exist" check gets backwards.
    assert.deepEqual(got.wasm, ['int8', 'w4a8', 'fp32']);
  });

  test('the full optimized repo serves every precision', () => {
    const got = servableEncoderQuants({ repoFiles: listing('optimized'), shaderF16: true });
    assert.deepEqual(got.wasm, WASM_ENCODER_QUANTS);
    assert.deepEqual(got.webgpu, WEBGPU_ENCODER_QUANTS);
  });

  test('a GPU with no shader-f16 loses fp16 even from a repo that hosts it', () => {
    // The other half of the fp16 gate, and the reason both have to be checked:
    // the file is present, the machine cannot run it, and offering it would
    // build a session that transcribes silence.
    const got = servableEncoderQuants({ repoFiles: listing('optimized'), shaderF16: false });
    assert.ok(!got.webgpu.includes('fp16'));
    assert.ok(got.webgpu.includes('fp32'));
  });

  test('upstream istupakov: int8 only, and fp32 refused for want of shards', () => {
    // This repo ships a flat single-file fp32 encoder and no shards, which
    // loads on NEITHER backend (32-bit WASM heap on one side, Chromium's
    // ~2 GB IndexedDB readback wall on the other). Offering it would produce a
    // 2.4 GB download that cannot be mounted.
    const got = servableEncoderQuants({ repoFiles: listing('istupakov-flat'), shaderF16: true });
    assert.ok(!got.wasm.includes('fp32'));
    assert.ok(!got.webgpu.includes('fp32'));
    assert.ok(got.wasm.includes('int8'));
  });

  test('no listing means NO OPINION, never "nothing is servable"', () => {
    // The single most dangerous answer this module could give. A mirror with no
    // manifest, a listing fetch that failed, a probe still in flight: each of
    // them greying out every precision would make a perfectly loadable model
    // unreachable, so they all have to be indistinguishable from "do not know".
    assert.equal(servableEncoderQuants({ repoFiles: null }), null);
    assert.equal(servableEncoderQuants({ repoFiles: [] }), null);
    assert.equal(servableEncoderQuants({}), null);
    assert.equal(servableEncoderQuants(), null);
  });
});

describe('nextGpuEncoderQuant: staying on the GPU when a precision is unservable', () => {
  test('the reported case: fp16 on that mirror becomes w4a8, not the CPU', () => {
    const servable = servableEncoderQuants({ repoFiles: DEPLOYED_MIRROR, shaderF16: true }).webgpu;
    assert.equal(nextGpuEncoderQuant({ current: 'fp16', servable, shaderF16: true }), 'w4a8');
  });

  test('cheapest first: an unrequested swap never costs more bytes than it must', () => {
    // Both fp32 and w4a8 are servable here. Picking fp32 would turn a 1.2 GB
    // choice into a 2.35 GB download the visitor never asked for; w4a8 is a
    // quarter of it at the same accuracy, and the sidebar still lets them move
    // to fp32 deliberately.
    assert.ok(QUANT_DOWNLOAD_MB.w4a8 < QUANT_DOWNLOAD_MB.fp16);
    assert.ok(QUANT_DOWNLOAD_MB.fp16 < QUANT_DOWNLOAD_MB.fp32);
    assert.equal(nextGpuEncoderQuant({
      current: 'fp16', servable: ['fp32', 'w4a8'], shaderF16: true,
    }), 'w4a8');
  });

  test('a precision already refused this load is never offered again', () => {
    // Otherwise the retry loop reoffers w4a8 forever instead of reaching fp32.
    assert.equal(nextGpuEncoderQuant({
      current: 'fp16', tried: ['w4a8'], servable: ['fp32', 'w4a8'], shaderF16: true,
    }), 'fp32');
    assert.equal(nextGpuEncoderQuant({
      current: 'fp16', tried: ['w4a8', 'fp32'], servable: ['fp32', 'w4a8'], shaderF16: true,
    }), null);
  });

  test('fp16 is never the substitute on a GPU that cannot compile it', () => {
    // It would build a session and return an empty transcript, so it is the
    // next failure rather than a fallback.
    assert.equal(nextGpuEncoderQuant({ current: 'fp32', servable: null, shaderF16: false }), 'w4a8');
    assert.equal(nextGpuEncoderQuant({
      current: 'fp32', tried: ['w4a8'], servable: null, shaderF16: false,
    }), null);
  });

  test('an unknown listing tries the others rather than giving up on the GPU', () => {
    // `servable: null` is the no-opinion answer above. Refusing to substitute
    // there would send every visitor whose source cannot be listed to the CPU,
    // which is the behaviour being fixed.
    assert.equal(nextGpuEncoderQuant({ current: 'fp16', servable: null, shaderF16: true }), 'w4a8');
  });

  test('nothing left on this GPU answers null, which is what may change backend', () => {
    // The one case that still justifies moving to WASM. It has to be
    // distinguishable from "have not looked yet".
    assert.equal(nextGpuEncoderQuant({ current: 'fp32', servable: [], shaderF16: true }), null);
    assert.equal(nextGpuEncoderQuant({
      current: 'fp32', servable: ['fp32'], shaderF16: true,
    }), null);
  });

  test('every offered GPU precision has a download estimate to sort by', () => {
    // The ordering silently degenerates to declaration order for any precision
    // missing from the table, which is how a 2.35 GB substitute would sneak in.
    for (const q of WEBGPU_ENCODER_QUANTS) {
      assert.equal(typeof QUANT_DOWNLOAD_MB[q], 'number', q);
    }
    for (const q of WASM_ENCODER_QUANTS) {
      assert.equal(typeof QUANT_DOWNLOAD_MB[q], 'number', q);
    }
  });
});

// The same mirror on 2026-09-11, after the fp16 encoder was regenerated and
// published. Kept beside the older capture on purpose: the pair is what proves
// the list TRACKS a deployment rather than describing this project's file set,
// and fp16 appearing is the exact change an operator makes and then expects to
// see in the sidebar.
const DEPLOYED_MIRROR_WITH_FP16 = [
  'config.json',
  'fp16/encoder-model.fp16.onnx',
  'fp32/decoder_joint-model.onnx',
  'fp32/decoder_joint-model.onnx.data',
  'fp32/encoder-model.onnx',
  'fp32/encoder-model.onnx.data.000',
  'fp32/encoder-model.onnx.data.001',
  'int8/decoder_joint-model.int8.onnx',
  'int8/encoder-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
  'w4a8/encoder-model.w4a8.onnx',
];

describe('encoderQuantRows: what the sidebar actually renders', () => {
  const values = (rows) => rows.map((r) => r.value);
  const rowFor = (rows, v) => rows.find((r) => r.value === v) ?? null;

  test('a precision the backend has no kernel for is not rendered at all', () => {
    // The report this answers: fp16 sat greyed out under WASM saying nothing
    // useful, and got read as "the fp16 file is missing from the server". It is
    // not missing; fp16 has no usable WASM kernel and never appears there.
    const wasm = encoderQuantRows({ backend: 'wasm', repoFiles: null });
    assert.equal(rowFor(wasm, 'fp16'), null);
    const gpu = encoderQuantRows({ backend: 'webgpu-hybrid', repoFiles: null });
    assert.equal(rowFor(gpu, 'int8'), null, 'no GPU int8 encoder kernel exists');
    assert.equal(rowFor(gpu, 'int8lite'), null);
  });

  test('a precision the source does not host is not rendered either', () => {
    // int8-lite is the live case: neither repo ships it any more, so offering
    // it describes a deployment that does not exist.
    const rows = encoderQuantRows({ backend: 'wasm', repoFiles: DEPLOYED_MIRROR_WITH_FP16 });
    assert.equal(rowFor(rows, 'int8lite'), null);
    assert.deepEqual(values(rows), ['int8', 'w4a8', 'fp32']);
    assert.ok(rows.every((r) => r.available), 'everything left is selectable');
  });

  test('publishing a file makes its row appear, with no app change', () => {
    const before = encoderQuantRows({
      backend: 'webgpu-hybrid', repoFiles: DEPLOYED_MIRROR, shaderF16: true,
    });
    const after = encoderQuantRows({
      backend: 'webgpu-hybrid', repoFiles: DEPLOYED_MIRROR_WITH_FP16, shaderF16: true,
    });
    assert.equal(rowFor(before, 'fp16'), null, 'the older capture has no fp16 file');
    assert.deepEqual(rowFor(after, 'fp16'), { value: 'fp16', available: true, reason: null });
  });

  test('a machine that cannot run fp16 KEEPS the row, greyed, with the reason', () => {
    // The one case worth a row: the source serves the file and the backend has
    // the kernel, so the only thing standing in the way is this adapter. Hiding
    // it would make two machines against one deployment show different lists
    // with nothing on screen to explain why.
    const rows = encoderQuantRows({
      backend: 'webgpu-hybrid', repoFiles: DEPLOYED_MIRROR_WITH_FP16, shaderF16: false,
    });
    assert.deepEqual(rowFor(rows, 'fp16'), { value: 'fp16', available: false, reason: 'no-shader-f16' });
  });

  test('the missing shader-f16 feature never makes the fp16 FILE look absent', () => {
    // The trap in wiring this up: servableEncoderQuants folds shaderF16 into
    // its answer, so asking it the file question with the real flag would drop
    // fp16 as "not hosted" on every adapter without the feature, hiding the row
    // whose whole job is to name that adapter as the reason.
    const rows = encoderQuantRows({
      backend: 'webgpu-hybrid', repoFiles: DEPLOYED_MIRROR_WITH_FP16, shaderF16: false,
    });
    assert.notEqual(rowFor(rows, 'fp16'), null);
    assert.notEqual(rowFor(rows, 'fp16').reason, 'source');
  });

  test('an unknown listing offers everything the backend can run', () => {
    // null is "no opinion", not "hosts nothing": a mirror without a manifest,
    // a listing request that failed, a probe still in flight. Greying or hiding
    // on an unanswered question is how a loadable precision becomes unreachable.
    for (const repoFiles of [null, []]) {
      const rows = encoderQuantRows({ backend: 'wasm', repoFiles });
      assert.deepEqual(values(rows), ['int8lite', 'int8', 'w4a8', 'fp32']);
    }
  });

  test('a source that hosts nothing runnable renders greyed rows, never an empty control', () => {
    // No radios, no explanation, no way to tell a broken listing from a
    // deliberate one. The load would fail with the same diagnosis, so say it.
    const rows = encoderQuantRows({ backend: 'webgpu-hybrid', repoFiles: ['vocab.txt', 'config.json'] });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !r.available && r.reason === 'source'));
  });

  test('the display order is honoured and never invents a row', () => {
    const order = ['w4a8', 'int8lite', 'int8', 'fp16', 'fp32'];
    const rows = encoderQuantRows({ backend: 'webgpu-hybrid', repoFiles: null, shaderF16: true, order });
    assert.deepEqual(values(rows), ['w4a8', 'fp16', 'fp32']);
    for (const r of rows) assert.ok(WEBGPU_ENCODER_QUANTS.includes(r.value), r.value);
  });
});
