// Tier-1 unit test for listLocalRepoFiles (app/src/hub.js): the HEAD-probe that
// discovers which quant-relevant files a locally-served /models mirror actually
// ships. The HF API lists a repo for us, but a flat local mirror can't be
// listed, so this probes the fp16 variants, the single fp32 sidecar, and the
// contiguous fp32 shards (encoder-model.onnx.data.NNN) up to the first gap.
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listLocalRepoFiles } from '../../app/src/hub.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Install a fake fetch that 200s for exactly the names in `present` (matched by
// the trailing path segment), 404s otherwise. Records the probed URLs.
function mockServer(present) {
  const set = new Set(present);
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    return { ok: set.has(name) };
  };
}

describe('listLocalRepoFiles', () => {
  test('reports the fp16 encoder + decoder when present, ignores absent candidates', async () => {
    mockServer(['encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx']);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(
      files.sort(),
      ['decoder_joint-model.fp16.onnx', 'encoder-model.fp16.onnx'],
    );
  });

  test('walks the contiguous fp32 shards and stops at the first gap', async () => {
    // Shards 000,001,002 present; 003 missing -> 004 must NOT be probed/returned.
    mockServer([
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

  test('finds shards under a sharded/ subfolder and reports them as basenames', async () => {
    // shard-fp32.py's default output puts the shards (and the rewritten encoder
    // graph) under sharded/. They are NOT flat under the base, so the flat probe
    // finds nothing and the sharded/ probe must pick them up, reported as bare
    // basenames so resolveModelQuant stays oblivious to the physical layout.
    const present = new Set([
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.001',
    ]);
    globalThis.fetch = async (url) => {
      const rel = String(url).slice('/models/'.length);
      return { ok: present.has(rel) };
    };
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, [
      'encoder-model.onnx.data.000',
      'encoder-model.onnx.data.001',
    ]);
  });

  test('prefers flat shards and does not also probe sharded/ when flat shards exist', async () => {
    // When the shards ARE flat, the sharded/ fallback must not run (a flat layout
    // is complete on its own); a sharded/ duplicate must not be double-counted.
    const probed = [];
    globalThis.fetch = async (url) => {
      const rel = String(url).slice('/models/'.length);
      probed.push(rel);
      const flat = ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001'];
      const sharded = ['sharded/encoder-model.onnx.data.000'];
      return { ok: flat.includes(rel) || sharded.includes(rel) };
    };
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.ok(!probed.some((p) => p.startsWith('sharded/')), 'sharded/ must not be probed when flat shards exist');
  });

  test('empty when the mirror serves none of the candidates (no local model)', async () => {
    mockServer([]);
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, []);
  });

  test('a probe that throws is treated as "absent", not fatal', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('encoder-model.fp16.onnx')) return { ok: true };
      throw new Error('network down');
    };
    const files = await listLocalRepoFiles('/models');
    assert.deepEqual(files, ['encoder-model.fp16.onnx']);
  });
});
