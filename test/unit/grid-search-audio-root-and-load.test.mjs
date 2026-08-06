// Tier-1 unit test for two scripts/grid_search_benchmark.mjs helpers:
//
//   resolveAudioPath  - the bench takes ONE --audio-root, but a run can mix
//                       manifests that live under different roots (the sampled
//                       sets under benchmark_datasets/ next to the older ones
//                       rooted in the NeMo tree). --audio-root still wins; the
//                       manifest's own directory is the fallback.
//   summarizeCellLoad - mean/peak OS load DURING a cell, so a cell that ran slow
//                       because something else was hammering the box is
//                       identifiable afterwards. The pre-existing load5 is a
//                       single end-of-cell sample and misses a mid-cell spike.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, resolveAudioPath, summarizeCellLoad } from '../../scripts/grid_search_benchmark.mjs';

const parse = (...extra) => parseArgs(['--manifest', '/tmp/does-not-matter.jsonl', ...extra]);

// --ort has no default on purpose: wasm and node give identical transcripts but
// very different timings, and only wasm is what the web app ships. Defaulting it
// would silently decide whether a run's proc_t/dur_t means anything to a user.
describe('--ort is required, never defaulted', () => {
  test('omitting it is an error that names the tradeoff', () => {
    assert.throws(() => parse(), /--ort is required and has no default/);
    assert.throws(() => parse(), /wasm = what the web app ships/);
  });

  test('each backend is accepted and applied verbatim', () => {
    assert.equal(parse('--ort', 'wasm').ort, 'wasm');
    assert.equal(parse('--ort', 'node').ort, 'node');
    assert.equal(parse('--cuda').ort, 'cuda');
  });

  test('an unknown backend is rejected', () => {
    assert.throws(() => parse('--ort', 'vulkan'), /--ort must be wasm, node or cuda/);
  });

  test('wasm is rejected for fp16/fp32, which it cannot load at all', () => {
    assert.throws(() => parse('--ort', 'wasm', '--quant', 'fp16'), /--ort wasm cannot load fp16/);
    assert.throws(() => parse('--ort', 'wasm', '--quant', 'int8,fp32'), /--ort wasm cannot load fp32/);
    assert.equal(parse('--ort', 'node', '--quant', 'fp16').ort, 'node');
  });
});

describe('resolveAudioPath', () => {
  // Injected existence oracle: only these absolute paths "exist".
  const only = (...paths) => (p) => paths.includes(p);

  test('--audio-root wins when it holds the file', () => {
    assert.equal(
      resolveAudioPath('audio/a.flac', '/root', '/manifests', only('/root/audio/a.flac')),
      '/root/audio/a.flac',
    );
  });

  test('falls back to the manifest directory when --audio-root does not', () => {
    assert.equal(
      resolveAudioPath('audio/a.flac', '/root', '/manifests', only('/manifests/audio/a.flac')),
      '/manifests/audio/a.flac',
    );
  });

  test('--audio-root still wins when BOTH have the file (documented precedence)', () => {
    assert.equal(
      resolveAudioPath('audio/a.flac', '/root', '/manifests',
        only('/root/audio/a.flac', '/manifests/audio/a.flac')),
      '/root/audio/a.flac',
    );
  });

  test('when neither has it, returns the --audio-root candidate so the error names that flag', () => {
    assert.equal(
      resolveAudioPath('audio/a.flac', '/root', '/manifests', () => false),
      '/root/audio/a.flac',
    );
  });

  test('normalizes .. segments rather than pasting them through', () => {
    assert.equal(
      resolveAudioPath('../shared/a.flac', '/root/sub', '/manifests', () => false),
      '/root/shared/a.flac',
    );
  });
});

describe('summarizeCellLoad', () => {
  test('reports the mean and the peak, rounded to 2 decimals', () => {
    assert.deepEqual(summarizeCellLoad([1, 2, 9]), { loadAvg: 4, loadMax: 9 });
    assert.deepEqual(summarizeCellLoad([1.111, 2.222]), { loadAvg: 1.67, loadMax: 2.22 });
  });

  test('a single sample is both the mean and the peak', () => {
    assert.deepEqual(summarizeCellLoad([3.5]), { loadAvg: 3.5, loadMax: 3.5 });
  });

  test('no samples yields nulls, so the columns render "-" instead of NaN', () => {
    assert.deepEqual(summarizeCellLoad([]), { loadAvg: null, loadMax: null });
    assert.deepEqual(summarizeCellLoad(undefined), { loadAvg: null, loadMax: null });
  });

  test('a mid-cell spike shows up in loadMax even when the mean stays low', () => {
    // The whole point: load5 sampled at cell end would have seen only the 1.0.
    const { loadAvg, loadMax } = summarizeCellLoad([1, 1, 1, 30, 1, 1, 1, 1, 1, 1]);
    assert.equal(loadMax, 30);
    assert.ok(loadAvg < 5, `mean stayed low (${loadAvg}) but the spike is still visible`);
  });
});
