// Tier-1 unit test for scripts/grid_search_benchmark.mjs --wasm-paths.
//
// The flag points the WASM backend at a self-built ORT engine directory (the way
// transcribe.mjs --wasm-paths already does), so a patched runtime can be scored by
// the exact WER/CER code that scored the stock one. Two guards come with it:
//   - it only means something on --ort wasm, so any other backend is refused;
//   - cell tags do not record the engine, so --resume would merge a patched run
//     into a stock run's records without a trace, and is refused too.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../scripts/grid_search_benchmark.mjs';

const parse = (...extra) => parseArgs(['--manifest', '/tmp/does-not-matter.jsonl', ...extra]);

describe('grid_search_benchmark --wasm-paths', () => {
  test('defaults to null (vendored engine)', () => {
    assert.equal(parse('--ort', 'wasm').wasmPaths, null);
  });

  test('is carried through on --ort wasm', () => {
    assert.equal(parse('--ort', 'wasm', '--wasm-paths', '/x/engine').wasmPaths, '/x/engine');
  });

  test('is refused on a native backend', () => {
    assert.throws(() => parse('--ort', 'node', '--wasm-paths', '/x/engine'), /--ort wasm/);
  });

  test('is refused together with --resume', () => {
    assert.throws(() => parse('--ort', 'wasm', '--wasm-paths', '/x/engine', '--resume'), /--resume/);
  });
});
