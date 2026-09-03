// Tier-1 unit test for app/src/modelLayout.js: the single source of truth for
// where a Parakeet model repo keeps each file. Every loader in this repo (the
// browser hub, the CLI, the e2e static server, the CI fetcher) routes its path
// guesses through it, so the rules are pinned here rather than re-derived per
// consumer.
//
// Three layouts must keep resolving:
//   v2      each basename in its own precision folder (fp32/, int8/, ...)
//   (a)     everything flat at the repo root (upstream istupakov, old mirrors,
//           the e2e fixture dirs)
//   (b)     flat root + sharded/ (the optimized repo as published on HF)
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDirFor, candidatePaths, findRepoFile, basenameOf } from '../../app/src/modelLayout.js';

describe('layoutDirFor', () => {
  test('routes the fp32 graphs and every sidecar shape to fp32/', () => {
    for (const name of [
      'encoder-model.onnx',
      'encoder-model.onnx.data',
      'encoder-model.onnx.data.000',
      'encoder-model.onnx.data.007',
      'decoder_joint-model.onnx',
      'decoder_joint-model.onnx.data',
    ]) {
      assert.equal(layoutDirFor(name), 'fp32/', name);
    }
  });

  test('routes each quantised build to its own folder', () => {
    assert.equal(layoutDirFor('encoder-model.int8.onnx'), 'int8/');
    assert.equal(layoutDirFor('decoder_joint-model.int8.onnx'), 'int8/');
    // The lite build must NOT land in int8/: its suffix is the longer match.
    assert.equal(layoutDirFor('encoder-model.int8.lite.onnx'), 'int8-lite/');
    assert.equal(layoutDirFor('encoder-model.w4a8.onnx'), 'w4a8/');
    assert.equal(layoutDirFor('encoder-model.fp16.onnx'), 'fp16/');
    assert.equal(layoutDirFor('decoder_joint-model.fp16.onnx'), 'fp16/');
  });

  test('keeps the root files at the root, ONNX or not', () => {
    for (const name of ['vocab.txt', 'config.json', 'README.md', 'nemo128.onnx', 'nemo80.onnx',
      'parakeet-tdt-0.6b-v3-ultimed.nemo']) {
      assert.equal(layoutDirFor(name), '', name);
    }
    assert.equal(layoutDirFor(''), '');
    assert.equal(layoutDirFor(undefined), '');
  });
});

describe('candidatePaths', () => {
  test('orders layout dir, root, then sharded/', () => {
    assert.deepEqual(candidatePaths('encoder-model.int8.onnx'), [
      'int8/encoder-model.int8.onnx',
      'encoder-model.int8.onnx',
      'sharded/encoder-model.int8.onnx',
    ]);
  });

  test('a root file yields two entries, not a duplicated one', () => {
    assert.deepEqual(candidatePaths('vocab.txt'), ['vocab.txt', 'sharded/vocab.txt']);
  });

  test('the fp32 shards are probed in fp32/ first, then flat, then sharded/', () => {
    assert.deepEqual(candidatePaths('encoder-model.onnx.data.000'), [
      'fp32/encoder-model.onnx.data.000',
      'encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.000',
    ]);
  });
});

describe('basenameOf', () => {
  test('strips any directory part, tolerates a bare basename', () => {
    assert.equal(basenameOf('int8/encoder-model.int8.onnx'), 'encoder-model.int8.onnx');
    assert.equal(basenameOf('sharded/encoder-model.onnx.data.001'), 'encoder-model.onnx.data.001');
    assert.equal(basenameOf('vocab.txt'), 'vocab.txt');
    assert.equal(basenameOf(''), '');
  });
});

describe('findRepoFile: layout v2 (nested)', () => {
  const listing = [
    'README.md',
    'config.json',
    'vocab.txt',
    'nemo128.onnx',
    'fp32/encoder-model.onnx',
    'fp32/encoder-model.onnx.data.000',
    'fp32/encoder-model.onnx.data.001',
    'fp32/decoder_joint-model.onnx',
    'int8/encoder-model.int8.onnx',
    'int8/decoder_joint-model.int8.onnx',
    'int8-lite/encoder-model.int8.lite.onnx',
    'w4a8/encoder-model.w4a8.onnx',
  ];

  test('resolves every basename to its nested path', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.int8.onnx'), 'int8/encoder-model.int8.onnx');
    assert.equal(findRepoFile(listing, 'decoder_joint-model.int8.onnx'), 'int8/decoder_joint-model.int8.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.int8.lite.onnx'), 'int8-lite/encoder-model.int8.lite.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.w4a8.onnx'), 'w4a8/encoder-model.w4a8.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.onnx'), 'fp32/encoder-model.onnx');
    assert.equal(findRepoFile(listing, 'vocab.txt'), 'vocab.txt');
  });

  test('a preferDir of fp32/ picks the sharded encoder graph', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'fp32/' }),
      'fp32/encoder-model.onnx');
    // A preferDir without its trailing slash means the same thing.
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'fp32' }),
      'fp32/encoder-model.onnx');
  });

  test('a basename the repo does not ship is null, not a guess', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.fp16.onnx'), null);
    assert.equal(findRepoFile(listing, 'encoder-model.onnx.data'), null);
    assert.equal(findRepoFile([], 'vocab.txt'), null);
    assert.equal(findRepoFile(null, 'vocab.txt'), null);
  });
});

describe('findRepoFile: layout (a), everything flat', () => {
  const listing = [
    'vocab.txt',
    'config.json',
    'encoder-model.onnx',
    'encoder-model.onnx.data',
    'decoder_joint-model.onnx',
    'encoder-model.int8.onnx',
    'decoder_joint-model.int8.onnx',
  ];

  test('the flat root still resolves for every basename', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.int8.onnx'), 'encoder-model.int8.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.onnx'), 'encoder-model.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.onnx.data'), 'encoder-model.onnx.data');
    assert.equal(findRepoFile(listing, 'vocab.txt'), 'vocab.txt');
  });

  test('a preferDir that the flat mirror has no directory for falls back to the root', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'sharded/' }),
      'encoder-model.onnx');
  });
});

describe('findRepoFile: layout (b), flat root plus sharded/', () => {
  const listing = [
    'vocab.txt',
    'encoder-model.onnx',
    'encoder-model.onnx.data',
    'encoder-model.int8.onnx',
    'decoder_joint-model.int8.onnx',
    'sharded/encoder-model.onnx',
    'sharded/encoder-model.onnx.data.000',
    'sharded/encoder-model.onnx.data.001',
  ];

  test('preferDir sharded/ takes the rewritten graph, not the root single-sidecar one', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'sharded/' }),
      'sharded/encoder-model.onnx');
  });

  test('without preferDir the root copy wins (fp32/ absent, root before sharded/)', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx'), 'encoder-model.onnx');
  });

  test('the shards resolve under sharded/, everything else at the root', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx.data.000'), 'sharded/encoder-model.onnx.data.000');
    assert.equal(findRepoFile(listing, 'encoder-model.int8.onnx'), 'encoder-model.int8.onnx');
    assert.equal(findRepoFile(listing, 'vocab.txt'), 'vocab.txt');
  });
});

describe('findRepoFile: the same basename in several places', () => {
  // A maintainer tree mid-migration: the v2 folders exist AND the old flat and
  // sharded/ copies are still there. Resolution order has to be deterministic.
  const listing = [
    'vocab.txt',
    'encoder-model.onnx',
    'sharded/encoder-model.onnx',
    'sharded/encoder-model.onnx.data.000',
    'fp32/encoder-model.onnx',
    'fp32/encoder-model.onnx.data.000',
    'encoder-model.int8.onnx',
    'int8/encoder-model.int8.onnx',
  ];

  test('the layout dir wins over the root and over sharded/', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx'), 'fp32/encoder-model.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.int8.onnx'), 'int8/encoder-model.int8.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.onnx.data.000'), 'fp32/encoder-model.onnx.data.000');
  });

  test('preferDir overrides that order, so the graph follows its shards', () => {
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'sharded/' }),
      'sharded/encoder-model.onnx');
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'fp32/' }),
      'fp32/encoder-model.onnx');
    // preferDir pointing at a directory this listing does not have falls back to
    // the normal order rather than inventing a path.
    assert.equal(findRepoFile(listing, 'encoder-model.onnx', { preferDir: 'nope/' }),
      'fp32/encoder-model.onnx');
  });

  test('an unpredicted directory is still honoured as a last resort', () => {
    // Neither the layout dir, nor the root, nor sharded/: a mirror that nested
    // the repo one level deeper must resolve to something rather than 404.
    assert.equal(findRepoFile(['mirror/copy/encoder-model.w4a8.onnx'], 'encoder-model.w4a8.onnx'),
      'mirror/copy/encoder-model.w4a8.onnx');
  });
});
