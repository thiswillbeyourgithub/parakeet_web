// Tier-1 unit test for commitment-scaling as a SWEPT axis of
// scripts/grid_search_benchmark.mjs.
//
// It used to be a single value applied to the whole run ("A/B it as two runs"),
// which made it impossible to read a commitment-scaling effect off one table.
// It is now a comma-separated list like depth-scaling, so this covers the three
// things that has to get right:
//   1. the grid multiplies by it (and each cell carries its own value),
//   2. every cell gets a DISTINCT resume key, so a sweep cannot silently reuse
//      one value's records for another,
//   3. leaving it alone changes nothing: the default single-null sweep produces
//      exactly the pre-change cells and the pre-change resume keys, so existing
//      benchmark_results.jsonl files stay resumable.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs, buildBoostDescriptors, tagOf, ACC_HEAD, accuracyBody, topBody,
} from '../../scripts/grid_search_benchmark.mjs';

// parseArgs insists on a manifest and an explicit --ort; the path is never
// opened by these pure bits and the backend is irrelevant to them.
const parse = (...extra) => parseArgs(['--manifest', '/tmp/does-not-matter.jsonl', '--ort', 'wasm', ...extra]);

// A full grid row, so tagOf sees every knob at its default but the boost ones.
const row = (desc) => ({
  beamWidth: 1, quant: 'int8', decoderQuant: 'int8',
  maesNumSteps: 2, maesExpansionBeta: 2, maesExpansionGamma: 2.3, maesPrefixAlpha: 1,
  ...desc,
});

describe('--commitment-scaling parsing', () => {
  test('defaults to a single null (the trie\'s own default)', () => {
    assert.deepEqual(parse().commitmentScalings, [null]);
  });

  test('accepts a comma-separated list', () => {
    assert.deepEqual(parse('--commitment-scaling', '0,0.5,1').commitmentScalings, [0, 0.5, 1]);
  });

  test('rejects values outside [0, 1]', () => {
    assert.throws(() => parse('--commitment-scaling', '0,1.5'), /--commitment-scaling/);
    assert.throws(() => parse('--commitment-scaling', '-0.1'), /--commitment-scaling/);
  });

  test('rejects an empty list', () => {
    assert.throws(() => parse('--commitment-scaling', ''), /--commitment-scaling/);
  });
});

describe('commitment-scaling multiplies the boost grid', () => {
  test('one baseline + strength x commitment-scaling cells', () => {
    const args = parse('--phrase-boost', 'inline=1', '--boost-strength', '1,2',
      '--commitment-scaling', '0,0.5,1');
    const cells = buildBoostDescriptors(args, true, 'abc');
    assert.equal(cells.length, 1 + 2 * 3);
    assert.equal(cells[0].label, 'none');
    // The baseline carries no commitment-scaling: it builds no trie at all.
    assert.equal(cells[0].commitmentScaling, null);
    assert.deepEqual(
      cells.slice(1).map((c) => [c.strength, c.commitmentScaling]),
      [[1, 0], [1, 0.5], [1, 1], [2, 0], [2, 0.5], [2, 1]],
    );
  });

  test('it crosses with depth-scaling and min-p rather than replacing them', () => {
    const args = parse('--phrase-boost', 'inline=1', '--boost-strength', '1',
      '--depth-scaling', '0,1', '--commitment-scaling', '0,1', '--boost-minp', '0.01,0.05');
    const cells = buildBoostDescriptors(args, true, 'abc');
    assert.equal(cells.length, 1 + 1 * 2 * 2 * 2);
  });
});

describe('resume keys stay distinct per commitment-scaling', () => {
  test('each value gets its own key', () => {
    const args = parse('--phrase-boost', 'inline=1', '--commitment-scaling', '0,0.5,1');
    const tags = buildBoostDescriptors(args, true, 'abc').slice(1).map((d) => tagOf(row(d)));
    assert.equal(new Set(tags).size, 3, `expected 3 distinct keys, got ${JSON.stringify(tags)}`);
    assert.deepEqual(tags, [
      'beam=1 boost#abc@1%0',
      'beam=1 boost#abc@1%0.5',
      'beam=1 boost#abc@1%1',
    ]);
  });

  test('an unswept (null) commitment-scaling appends nothing, so old jsonl still resumes', () => {
    const args = parse('--phrase-boost', 'inline=1');
    const cells = buildBoostDescriptors(args, true, 'abc');
    assert.deepEqual(cells.map((d) => tagOf(row(d))), ['beam=1 none', 'beam=1 boost#abc@1']);
  });
});

describe('the cscale table column', () => {
  const cell = (commitmentScaling) => ({
    beamWidth: 1, quant: 'int8', decoderQuant: 'int8', boostLabel: 'boost',
    strength: 1, minp: null, depthScaling: null, commitmentScaling,
    datasets: [{ name: 'drugs_val', wordEdits: 5, refWords: 100, charEdits: 3, refChars: 500, decodeMs: 10, audioSec: 5 }],
  });

  test('is present and sits right after dscale', () => {
    assert.equal(ACC_HEAD[ACC_HEAD.indexOf('dscale') + 1], 'cscale');
  });

  test('renders the swept value in both tables, and "-" when unswept', () => {
    const col = ACC_HEAD.indexOf('cscale');
    assert.equal(accuracyBody([cell(0.5)])[0][col], '0.5');
    assert.equal(accuracyBody([cell(null)])[0][col], '-');
    assert.equal(topBody([cell(0)])[0][col], '0');
  });
});
