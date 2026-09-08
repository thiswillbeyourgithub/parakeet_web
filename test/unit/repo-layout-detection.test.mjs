// Tier-1 gate: the loaders must find the weights in EVERY repo layout we
// actually ship or support, without anyone hardcoding a directory.
//
// The three fixtures under test/fixtures/repo-listings/ are verbatim captures of
// the real HuggingFace file listings (2026-09-08), one per reference layout:
//
//   ultimed.json         Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx
//                        The REFERENCE v2 layout: fp16/ fp32/ int8/ w4a8/, with
//                        vocab.txt and nemo128.onnx at the root.
//   optimized.json       Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx
//                        v2 at the root PLUS a complete nested sub-repo at
//                        istupakov_smoothquant/ (its own vocab, nemo128 and
//                        precision folders), which is where the lite int8
//                        encoder lives now that it moved out of the root.
//   istupakov-flat.json  istupakov/parakeet-tdt-0.6b-v3-onnx
//                        Upstream, everything FLAT at the root, fp32 as a single
//                        encoder-model.onnx.data sidecar rather than shards.
//
// Why pin this rather than trust modelLayout's own unit test: that one checks
// the RULES against hand-written paths, so it stays green while the repos move
// underneath it. This one checks the rules against what the repos really serve,
// which is the failure the app suffers. The lite encoder is the worked example:
// the model repo moved it from int8-lite/ to istupakov_smoothquant/int8-lite/
// and nothing in the tree noticed, because findRepoFile's last-resort branch
// quietly kept resolving it while a hardcoded path in the CI fetch list 404ed.
//
// So the table below is deliberately EXHAUSTIVE and written as literal paths.
// A repo reorganisation is supposed to break it, and the diff is then the list
// of what each layout can and cannot serve.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRepoFile } from '../../app/src/modelLayout.js';
import { resolveModelQuant, parseEncoderShards } from '../../app/src/hub.js';

const listing = (name) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../fixtures/repo-listings/${name}.json`, import.meta.url)), 'utf8'));

const ULTIMED = listing('ultimed');
const OPTIMIZED = listing('optimized');
const FLAT = listing('istupakov-flat');

// Every basename a loader ever asks for, against every reference layout.
// `null` means "this repo does not ship it", which is a real answer: it is what
// routes a user to the quant-unavailable banner instead of a wrong file.
const RESOLUTIONS = [
  ['vocab.txt', {
    ultimed: 'vocab.txt',
    optimized: 'vocab.txt',
    flat: 'vocab.txt',
  }],
  ['nemo128.onnx', {
    ultimed: 'nemo128.onnx',
    optimized: 'nemo128.onnx',
    flat: 'nemo128.onnx',
  }],
  ['encoder-model.int8.onnx', {
    ultimed: 'int8/encoder-model.int8.onnx',
    optimized: 'int8/encoder-model.int8.onnx',
    flat: 'encoder-model.int8.onnx',
  }],
  ['decoder_joint-model.int8.onnx', {
    ultimed: 'int8/decoder_joint-model.int8.onnx',
    optimized: 'int8/decoder_joint-model.int8.onnx',
    flat: 'decoder_joint-model.int8.onnx',
  }],
  ['encoder-model.int8.lite.onnx', {
    ultimed: null,
    // The nested sub-repo case. No candidatePaths entry matches, so this is
    // findRepoFile's last-resort "the listing knows better than the layout
    // rules" branch doing exactly the job it exists for.
    optimized: 'istupakov_smoothquant/int8-lite/encoder-model.int8.lite.onnx',
    flat: null,
  }],
  ['encoder-model.fp16.onnx', {
    ultimed: 'fp16/encoder-model.fp16.onnx',
    optimized: 'fp16/encoder-model.fp16.onnx',
    flat: null,
  }],
  ['encoder-model.w4a8.onnx', {
    ultimed: 'w4a8/encoder-model.w4a8.onnx',
    optimized: 'w4a8/encoder-model.w4a8.onnx',
    flat: null,
  }],
  ['encoder-model.onnx', {
    ultimed: 'fp32/encoder-model.onnx',
    optimized: 'fp32/encoder-model.onnx',
    flat: 'encoder-model.onnx',
  }],
  ['decoder_joint-model.onnx', {
    ultimed: 'fp32/decoder_joint-model.onnx',
    optimized: 'fp32/decoder_joint-model.onnx',
    flat: 'decoder_joint-model.onnx',
  }],
  // The single-sidecar spelling: only upstream still ships it, and it is what
  // makes fp32 unloadable there (one >2 GB buffer, no shards to stream).
  ['encoder-model.onnx.data', {
    ultimed: null,
    optimized: null,
    flat: 'encoder-model.onnx.data',
  }],
  ['encoder-model.onnx.data.000', {
    ultimed: 'fp32/encoder-model.onnx.data.000',
    optimized: 'fp32/encoder-model.onnx.data.000',
    flat: null,
  }],
];

const REPOS = { ultimed: ULTIMED, optimized: OPTIMIZED, flat: FLAT };

describe('reference repo layouts: file resolution', () => {
  for (const [basename, expected] of RESOLUTIONS) {
    test(`${basename} resolves in every reference layout`, () => {
      for (const [name, files] of Object.entries(REPOS)) {
        assert.equal(findRepoFile(files, basename), expected[name],
          `${basename} in the ${name} layout`);
      }
    });
  }

  test('the fp32 encoder graph is taken from the directory holding its shards', () => {
    // preferDir is what stops a repo that has BOTH a sharded set and a stale
    // flat monolith from pairing one graph with the other's external data.
    for (const name of ['ultimed', 'optimized']) {
      const { subdir, shards } = parseEncoderShards(REPOS[name]);
      assert.equal(subdir, 'fp32/', name);
      // Exactly two, each once: the optimized repo's nested sub-repo ships the
      // same two shard basenames under istupakov_smoothquant/fp32/, and folding
      // those in would fetch every shard twice and assemble a corrupt encoder.
      assert.deepEqual(shards,
        ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001'], name);
      assert.equal(findRepoFile(REPOS[name], 'encoder-model.onnx', { preferDir: subdir }),
        'fp32/encoder-model.onnx', name);
    }
    assert.equal(parseEncoderShards(FLAT).shards.length, 0, 'upstream ships no shards');
  });
});

describe('reference repo layouts: which quants each one can actually serve', () => {
  const wasm = (files, encoderQuant, extra = {}) => resolveModelQuant({
    backend: 'wasm', encoderQuant, decoderQuant: 'int8', repoFiles: files, ...extra });
  const gpu = (files, encoderQuant, extra = {}) => resolveModelQuant({
    backend: 'webgpu', encoderQuant, decoderQuant: 'int8', repoFiles: files, ...extra });

  test('int8 works everywhere, which is why it is the WASM pin', () => {
    for (const [name, files] of Object.entries(REPOS)) {
      assert.equal(wasm(files, 'int8').encoderQ, 'int8', name);
    }
  });

  test('upstream istupakov stays fully usable on its default int8', () => {
    // The compatibility promise: a user pointing the app at the upstream repo
    // must get a working model, not a banner. Everything it ships resolves,
    // and everything it does not ship falls back to the int8 pin.
    const r = wasm(FLAT, 'int8');
    assert.equal(r.encoderQ, 'int8');
    assert.equal(r.decoderQ, 'int8');
    assert.equal(r.pinnedToInt8, false);
  });

  test('a quant upstream does not ship pins back to int8 rather than guessing', () => {
    for (const q of ['int8lite', 'w4a8']) {
      const r = wasm(FLAT, q);
      assert.equal(r.encoderQ, 'int8', q);
      assert.equal(r.pinnedToInt8, true, q);
    }
    // fp32 on WASM needs shards upstream does not have, even when opted in.
    const fp32 = wasm(FLAT, 'fp32', { allowWasmFp32: true });
    assert.equal(fp32.encoderQ, 'int8');
    assert.equal(fp32.pinnedToInt8, true);
  });

  test('the lite int8 encoder is served from the nested sub-repo, not refused', () => {
    // The regression this whole file exists for: optimized moved the lite
    // encoder under istupakov_smoothquant/, and the app must keep offering it.
    assert.equal(wasm(OPTIMIZED, 'int8lite').encoderQ, 'int8lite');
    // UltiMed ships no lite build at all, so it correctly pins instead.
    const ultimed = wasm(ULTIMED, 'int8lite');
    assert.equal(ultimed.encoderQ, 'int8');
    assert.equal(ultimed.pinnedToInt8, true);
  });

  test('sharded fp32 loads on WASM from both Olicorne repos when opted in', () => {
    for (const name of ['ultimed', 'optimized']) {
      const r = wasm(REPOS[name], 'fp32', { allowWasmFp32: true });
      assert.equal(r.encoderQ, 'fp32', name);
      assert.equal(r.pinnedToInt8, false, name);
    }
  });

  test('WebGPU fp16 is offered by both Olicorne repos and by neither upstream', () => {
    for (const name of ['ultimed', 'optimized']) {
      assert.equal(gpu(REPOS[name], 'fp16', { shaderF16: true }).encoderQ, 'fp16', name);
    }
    assert.notEqual(gpu(FLAT, 'fp16', { shaderF16: true }).encoderQ, 'fp16');
  });
});

describe('parseEncoderShards: one directory, never a mix', () => {
  const SHARDS = ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001'];

  test('the legacy sharded/ directory still wins over a nested sub-repo', () => {
    // The optimized repo as published BEFORE the move: shards in sharded/, and
    // a sub-repo that also has a fp32/ set. candidatePaths names both fp32/ and
    // sharded/, and fp32/ only exists inside the sub-repo here, so the rule has
    // to be "a directory candidatePaths names AT THE TOP LEVEL", which is what
    // filtering to the directories actually seen gives.
    const files = [
      ...SHARDS.map((s) => `sharded/${s}`),
      ...SHARDS.map((s) => `nested_subrepo/fp32/${s}`),
    ];
    const { shards, subdir } = parseEncoderShards(files);
    assert.equal(subdir, 'sharded/');
    assert.deepEqual(shards, SHARDS);
  });

  test('a directory no layout rule names is still usable when it is the only one', () => {
    // The degradation the last-resort branch buys: an unusual mirror is served
    // rather than reported as shipping no shards at all.
    const files = SHARDS.map((s) => `some_export_run/${s}`);
    const { shards, subdir } = parseEncoderShards(files);
    assert.equal(subdir, 'some_export_run/');
    assert.deepEqual(shards, SHARDS);
  });

  test('no shards anywhere reports an empty set at the root', () => {
    assert.deepEqual(parseEncoderShards(['fp32/encoder-model.onnx', 'vocab.txt']),
      { shards: [], subdir: '' });
  });
});
