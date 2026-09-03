// Tier-1 unit test for listLocalRepoFiles (app/src/hub.js): the HEAD-probe that
// discovers which quant-relevant files a locally-served /models mirror actually
// ships, and WHERE. The HF API lists a repo for us; a local mirror cannot be
// listed, so this walks app/src/modelLayout.js's candidate paths (precision
// folder, flat root, sharded/) per basename and keeps the path that answered.
//
// It returns FULL repo-relative paths, exactly like the HF tree listing, so the
// download plan never has to re-discover a directory.
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listLocalRepoFiles } from '../../app/src/hub.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Install a fake mirror that 200s for exactly the repo-relative paths in
// `present`, 404s otherwise. Paths, not basenames: which DIRECTORY answers is
// the whole point of these tests.
function mockMirror(present, probed) {
  const set = new Set(present);
  globalThis.fetch = async (url) => {
    const rel = String(url).slice('/models/'.length);
    if (probed) probed.push(rel);
    return { ok: set.has(rel) };
  };
}

describe('listLocalRepoFiles: the current nested layout', () => {
  test('reports every precision folder path it finds', async () => {
    mockMirror([
      'fp32/encoder-model.onnx',
      'fp32/encoder-model.onnx.data.000',
      'fp32/encoder-model.onnx.data.001',
      'fp32/decoder_joint-model.onnx',
      'int8/encoder-model.int8.onnx',
      'int8/decoder_joint-model.int8.onnx',
      'int8-lite/encoder-model.int8.lite.onnx',
      'w4a8/encoder-model.w4a8.onnx',
    ]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, [
      'fp32/encoder-model.onnx',
      'fp32/decoder_joint-model.onnx',
      'int8/encoder-model.int8.onnx',
      'int8/decoder_joint-model.int8.onnx',
      'int8-lite/encoder-model.int8.lite.onnx',
      'w4a8/encoder-model.w4a8.onnx',
      'fp32/encoder-model.onnx.data.000',
      'fp32/encoder-model.onnx.data.001',
    ]);
  });

  test('the int8 graphs are probed at all: without them a nested mirror 404s', async () => {
    // The default load fetches encoder-model.int8.onnx + decoder_joint-model.int8.onnx.
    // On a nested mirror those are NOT at the root, so if this listing did not
    // carry them the download plan would fall back to the bare basename and miss.
    mockMirror(['int8/encoder-model.int8.onnx', 'int8/decoder_joint-model.int8.onnx']);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, ['int8/encoder-model.int8.onnx', 'int8/decoder_joint-model.int8.onnx']);
  });
});

describe('listLocalRepoFiles: the flat layout', () => {
  test('reports the fp32 external-data sidecars when present, ignores absent candidates', async () => {
    mockMirror(['encoder-model.onnx.data', 'decoder_joint-model.onnx.data']);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(
      files.sort(),
      ['decoder_joint-model.onnx.data', 'encoder-model.onnx.data'],
    );
  });

  test('walks the contiguous fp32 shards and stops at the first gap', async () => {
    // Shards 000,001,002 present; 003 missing -> 004 must NOT be probed/returned.
    mockMirror([
      'encoder-model.onnx.data.000',
      'encoder-model.onnx.data.001',
      'encoder-model.onnx.data.002',
      'encoder-model.onnx.data.004',
    ]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, [
      'encoder-model.onnx.data.000',
      'encoder-model.onnx.data.001',
      'encoder-model.onnx.data.002',
    ]);
  });

  test('empty when the mirror serves none of the candidates (no local model)', async () => {
    mockMirror([]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, []);
  });

  test('a probe that throws is treated as "absent", not fatal', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === '/models/encoder-model.onnx.data') return { ok: true };
      throw new Error('network down');
    };
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, ['encoder-model.onnx.data']);
  });
});

describe('listLocalRepoFiles: the flat + sharded/ layout', () => {
  test('finds shards under sharded/ and reports the full path', async () => {
    // The layout the optimized repo published before the move: the rewritten
    // encoder graph and its shards under sharded/, everything else at the root.
    mockMirror([
      'encoder-model.onnx',
      'encoder-model.onnx.data',
      'sharded/encoder-model.onnx',
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.001',
    ]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, [
      // BOTH encoder graphs are listed: the root single-sidecar one (found by the
      // candidate walk) and the rewritten one beside the shards (found by the
      // explicit shard-directory probe). Listing only the first would leave the
      // download plan's preferDir nothing to select, and a browser would load the
      // unloadable 2.4 GB single-sidecar graph.
      'encoder-model.onnx',
      'encoder-model.onnx.data',
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.001',
      'sharded/encoder-model.onnx',
    ]);
  });

  test('the shard walk locks onto the directory shard 000 answered from', async () => {
    // A shard set split across directories is not loadable (the graph names ONE
    // external_data location), so once 000 is found the walk stays put: a stray
    // flat 001 must not be picked up alongside a sharded/ 000.
    const probed = [];
    mockMirror(['sharded/encoder-model.onnx.data.000', 'encoder-model.onnx.data.001'], probed);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, ['sharded/encoder-model.onnx.data.000']);
    assert.ok(!probed.includes('encoder-model.onnx.data.001'),
      'the walk must continue in sharded/, not re-run the candidate list per shard');
  });
});

describe('listLocalRepoFiles: the probe budget', () => {
  test('probes the pinned basenames through their candidate paths, nothing else', async () => {
    // This function costs HEAD round trips on every load against a local mirror,
    // so the basename set is pinned. Each basename walks its candidate paths
    // (precision folder, root, sharded/) and STOPS at the first hit, so a mirror
    // in the current layout pays one round trip per basename; only a basename it
    // does not ship at all pays the full list, which is the case below.
    //
    // The weight graphs earn their probes because this list IS the repo listing
    // on a local-weights deployment: without them the download plan cannot know
    // which directory to fetch from. The optional encoder builds earn theirs
    // because resolveModelQuant must decide whether the source can serve an
    // int8lite or w4a8 request BEFORE any weight is fetched. Variant filenames
    // (the withdrawn optimized/LSE/TopK builds) are NOT probed: those graphs ship
    // under the canonical names and the decoder fast paths are detected from the
    // loaded session's outputNames.
    const probed = [];
    mockMirror([], probed);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, []);
    assert.deepEqual(probed.slice().sort(), [
      'decoder_joint-model.int8.onnx',
      'decoder_joint-model.onnx',
      'decoder_joint-model.onnx.data',
      'encoder-model.int8.lite.onnx',
      'encoder-model.int8.onnx',
      'encoder-model.onnx',
      'encoder-model.onnx.data',
      'encoder-model.onnx.data.000',
      'encoder-model.w4a8.onnx',
      'fp32/decoder_joint-model.onnx',
      'fp32/decoder_joint-model.onnx.data',
      'fp32/encoder-model.onnx',
      'fp32/encoder-model.onnx.data',
      'fp32/encoder-model.onnx.data.000',
      'int8-lite/encoder-model.int8.lite.onnx',
      'int8/decoder_joint-model.int8.onnx',
      'int8/encoder-model.int8.onnx',
      'sharded/decoder_joint-model.int8.onnx',
      'sharded/decoder_joint-model.onnx',
      'sharded/decoder_joint-model.onnx.data',
      'sharded/encoder-model.int8.lite.onnx',
      'sharded/encoder-model.int8.onnx',
      'sharded/encoder-model.onnx',
      'sharded/encoder-model.onnx.data',
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.w4a8.onnx',
      'w4a8/encoder-model.w4a8.onnx',
    ]);
  });

  test('a mirror in the current layout stops at the first candidate per basename', async () => {
    const probed = [];
    mockMirror(['int8/encoder-model.int8.onnx'], probed);
    await listLocalRepoFiles('/models');
    assert.ok(!probed.includes('encoder-model.int8.onnx'),
      'a hit in the precision folder must not be followed by a root probe');
    assert.ok(!probed.includes('sharded/encoder-model.int8.onnx'));
  });

  // The point of the optional probes: a mirror that HAS one of them must report
  // it, so resolveModelQuant can honour an int8lite or w4a8 request against local
  // weights instead of pinning to the heavier default int8. Both layouts.
  for (const rel of [
    'encoder-model.int8.lite.onnx', 'int8-lite/encoder-model.int8.lite.onnx',
    'encoder-model.w4a8.onnx', 'w4a8/encoder-model.w4a8.onnx',
  ]) {
    test(`a mirror serving ${rel} reports it`, async () => {
      mockMirror([rel]);
      const files = await listLocalRepoFiles('/models');
      assert.deepEqual(files, [rel]);
    });
  }

  test('a mirror still serving the withdrawn variant filenames reports none of them', async () => {
    mockMirror([
      'encoder-model.int8.smoothquant.optimized.onnx',
      'encoder-model.optimized.onnx',
      'decoder_joint-model.int8.lse.onnx',
      'decoder_joint-model.int8.lse.topk.onnx',
    ]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, []);
  });
});
