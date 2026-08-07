// Tier-1 unit tests for the chunking sweep axis of
// scripts/grid_search_benchmark.mjs (PERF_PLAN item 2, long-audio seam tuning).
//
// Three things it must get right:
// 1. parsing: --chunk-duration accepts the 'off' token (the unchunked
//    reference cell) alongside numeric windows, and the three sub-knob lists
//    parse/validate like every other swept list,
// 2. buildChunkConfigs: the off cell collapses to ONE config (sub-knobs do not
//    apply to it, so an off + 4-overlap sweep must not run 4 identical
//    reference cells), while numeric durations cross-product the sub-knobs,
// 3. resume keys: an unchunked cell's tag is byte-identical to pre-sweep runs
//    (existing benchmark_results.jsonl stays resumable) and every chunked
//    config gets a distinct tag carrying exactly the knobs that were set.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, buildChunkConfigs, tagOf } from '../../scripts/grid_search_benchmark.mjs';

// parseArgs insists on a manifest and an explicit --ort; the path is never
// opened by these pure bits and the backend is irrelevant to them.
const parse = (...extra) => parseArgs(['--manifest', '/tmp/does-not-matter.jsonl', '--ort', 'wasm', ...extra]);

// A full grid row, so tagOf sees every knob at its default but the chunk ones.
const row = (desc) => ({
  beamWidth: 1, quant: 'int8', decoderQuant: 'int8', label: 'none', strength: null,
  maesNumSteps: 2, maesExpansionBeta: 2, maesExpansionGamma: 2.3, maesPrefixAlpha: 1,
  chunkDuration: null, chunkOverlap: null, chunkSnap: null, chunkEnergyMs: null,
  ...desc,
});

describe('chunk sweep parsing', () => {
  test('defaults: all four lists are a single null (chunking off)', () => {
    const a = parse();
    assert.deepEqual(a.chunkDurations, [null]);
    assert.deepEqual(a.chunkOverlaps, [null]);
    assert.deepEqual(a.chunkSnaps, [null]);
    assert.deepEqual(a.chunkEnergyMs, [null]);
  });

  test('--chunk-duration mixes the off token with numeric windows', () => {
    assert.deepEqual(parse('--chunk-duration', 'off,20,40').chunkDurations, [null, 20, 40]);
    assert.deepEqual(parse('--chunk-duration', 'OFF').chunkDurations, [null]);
    assert.deepEqual(parse('--chunk-duration', '60').chunkDurations, [60]);
  });

  test('sub-knob lists parse as numbers', () => {
    assert.deepEqual(parse('--chunk-overlap', '0,2,4').chunkOverlaps, [0, 2, 4]);
    assert.deepEqual(parse('--chunk-snap', '0,1').chunkSnaps, [0, 1]);
    assert.deepEqual(parse('--chunk-energy-ms', '25,150').chunkEnergyMs, [25, 150]);
  });

  test('invalid values throw', () => {
    assert.throws(() => parse('--chunk-duration', '0'), /--chunk-duration/);
    assert.throws(() => parse('--chunk-duration', '-5'), /--chunk-duration/);
    assert.throws(() => parse('--chunk-duration', 'nope'), /--chunk-duration/);
    assert.throws(() => parse('--chunk-overlap', '-1'), /--chunk-overlap/);
    assert.throws(() => parse('--chunk-snap', '-0.5'), /--chunk-snap/);
    assert.throws(() => parse('--chunk-energy-ms', '0'), /--chunk-energy-ms/);
  });
});

describe('buildChunkConfigs', () => {
  test('the default (all-null) sweep is one off config', () => {
    assert.deepEqual(buildChunkConfigs(parse()), [
      { chunkDuration: null, chunkOverlap: null, chunkSnap: null, chunkEnergyMs: null },
    ]);
  });

  test('the off cell collapses: sub-knob lists never multiply it', () => {
    const cfgs = buildChunkConfigs(parse('--chunk-duration', 'off', '--chunk-overlap', '0,1,2,4'));
    assert.deepEqual(cfgs, [
      { chunkDuration: null, chunkOverlap: null, chunkSnap: null, chunkEnergyMs: null },
    ]);
  });

  test('numeric durations cross-product the sub-knobs', () => {
    const cfgs = buildChunkConfigs(parse(
      '--chunk-duration', '20,40', '--chunk-snap', '0,1', '--chunk-energy-ms', '25,150'));
    assert.equal(cfgs.length, 2 * 2 * 2);
    assert.deepEqual(cfgs[0], { chunkDuration: 20, chunkOverlap: null, chunkSnap: 0, chunkEnergyMs: 25 });
    assert.deepEqual(cfgs.at(-1), { chunkDuration: 40, chunkOverlap: null, chunkSnap: 1, chunkEnergyMs: 150 });
    // Every config is distinct (no accidental duplicates in the product).
    assert.equal(new Set(cfgs.map((c) => JSON.stringify(c))).size, cfgs.length);
  });

  test('mixed off + numeric keeps one reference cell ahead of the product', () => {
    const cfgs = buildChunkConfigs(parse('--chunk-duration', 'off,30', '--chunk-overlap', '1,3'));
    assert.deepEqual(cfgs, [
      { chunkDuration: null, chunkOverlap: null, chunkSnap: null, chunkEnergyMs: null },
      { chunkDuration: 30, chunkOverlap: 1, chunkSnap: null, chunkEnergyMs: null },
      { chunkDuration: 30, chunkOverlap: 3, chunkSnap: null, chunkEnergyMs: null },
    ]);
  });
});

describe('tagOf chunk resume keys', () => {
  test('an unchunked cell keeps the exact pre-sweep tag', () => {
    assert.equal(tagOf(row({})), 'beam=1 none');
  });

  test('a chunked cell always carries its duration', () => {
    assert.equal(tagOf(row({ chunkDuration: 40 })), 'beam=1 none cd=40');
  });

  test('sub-knobs append only when explicitly set (null = engine default = silent)', () => {
    assert.equal(
      tagOf(row({ chunkDuration: 20, chunkOverlap: 4, chunkSnap: 0, chunkEnergyMs: 25 })),
      'beam=1 none cd=20 ov=4 sn=0 ew=25');
    assert.equal(
      tagOf(row({ chunkDuration: 20, chunkSnap: 0 })),
      'beam=1 none cd=20 sn=0');
  });

  test('every config in a sweep maps to a distinct tag', () => {
    const cfgs = buildChunkConfigs(parse(
      '--chunk-duration', 'off,20,40', '--chunk-overlap', '0,2', '--chunk-energy-ms', '25,150'));
    const tags = cfgs.map((c) => tagOf(row(c)));
    assert.equal(new Set(tags).size, tags.length);
  });
});
