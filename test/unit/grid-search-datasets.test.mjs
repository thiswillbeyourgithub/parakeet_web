// Tier-1 unit test for the multi-dataset aggregation in
// scripts/grid_search_benchmark.mjs. The benchmark can take --manifest more than
// once to score one grid over several datasets; this covers the pure pieces that
// make that work: naming a dataset after its manifest basename (with collision
// suffixing), loading + tagging entries per dataset (with a per-manifest limit),
// pooling per-dataset tallies into an "overall" row only when >1 dataset, and
// expanding a grid cell into one accuracy row per dataset (+ overall).
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseManifestSpec, datasetNameFor, loadManifests, newAcc, addScore, buildDatasets, repDataset,
  cellRate, ACC_HEAD, accuracyBody, OVERALL,
} from '../../scripts/grid_search_benchmark.mjs';

describe('parseManifestSpec: optional "label=path"', () => {
  test('plain path has no label', () => {
    assert.deepEqual(parseManifestSpec('/a/b/medical.json'), { label: null, path: '/a/b/medical.json' });
  });
  test('"label=path" splits on the first =', () => {
    assert.deepEqual(parseManifestSpec('fleurs_fr=/a/fr/validation.altered.json'),
      { label: 'fleurs_fr', path: '/a/fr/validation.altered.json' });
  });
  test('a path containing = (with a slash before it) is NOT treated as a label', () => {
    // The "label" would contain a slash, so it stays a plain path.
    assert.deepEqual(parseManifestSpec('/weird=dir/m.json'), { label: null, path: '/weird=dir/m.json' });
  });
  test('empty path after = falls back to the whole spec as a path', () => {
    assert.deepEqual(parseManifestSpec('label='), { label: null, path: 'label=' });
  });
});

describe('datasetNameFor: basename without extension, deduped, explicit label wins', () => {
  test('strips directory and extension', () => {
    const used = new Set();
    assert.equal(datasetNameFor('/a/b/medical.json', used), 'medical');
    assert.equal(datasetNameFor('general.jsonl', used), 'general');
  });
  test('explicit label overrides the basename', () => {
    const used = new Set();
    assert.equal(datasetNameFor('/a/fr/validation.altered.json', used, 'fleurs_fr'), 'fleurs_fr');
  });
  test('collisions get a #N suffix so two dirs stay distinct', () => {
    const used = new Set();
    assert.equal(datasetNameFor('/a/medical.json', used), 'medical');
    assert.equal(datasetNameFor('/b/medical.json', used), 'medical#2');
    assert.equal(datasetNameFor('/c/medical.json', used), 'medical#3');
  });
});

describe('loadManifests: tags entries with their dataset, limit is per manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gridsearch-'));
  const line = (audio, text) => JSON.stringify({ audio_filepath: audio, text }) + '\n';
  const med = join(dir, 'medical.json');
  const gen = join(dir, 'general.json');
  writeFileSync(med, line('m1.wav', 'aspirin') + line('m2.wav', 'ibuprofen') + line('m3.wav', 'codeine'));
  writeFileSync(gen, line('g1.wav', 'hello world'));

  test('every entry carries its dataset name, in command-line order', () => {
    const { entries, datasetNames } = loadManifests([med, gen], '/root', 0);
    assert.deepEqual(datasetNames, ['medical', 'general']);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.map((e) => e.dataset), ['medical', 'medical', 'medical', 'general']);
    // Relative audio paths resolve against audioRoot.
    assert.equal(entries[0].audioPath, '/root/m1.wav');
  });

  test('a "label=path" spec names the dataset explicitly', () => {
    const { entries, datasetNames } = loadManifests([`drugs=${med}`, `general=${gen}`], '/root', 0);
    assert.deepEqual(datasetNames, ['drugs', 'general']);
    assert.deepEqual([...new Set(entries.map((e) => e.dataset))], ['drugs', 'general']);
  });

  test('--limit caps EACH manifest, not the combined total', () => {
    const { entries, datasetNames } = loadManifests([med, gen], '/root', 2);
    assert.deepEqual(datasetNames, ['medical', 'general']);
    // 2 from medical (capped) + 1 from general (only has 1) = 3.
    assert.equal(entries.filter((e) => e.dataset === 'medical').length, 2);
    assert.equal(entries.filter((e) => e.dataset === 'general').length, 1);
  });

  test.after(() => rmSync(dir, { recursive: true, force: true }));
});

// A scored utterance as score() would return it.
const sc = (refWords, wordEdits, refChars = refWords * 5, charEdits = wordEdits * 5) =>
  ({ refWords, hypWords: refWords, wordEdits, refChars, charEdits });

describe('buildDatasets: overall row only when more than one dataset', () => {
  test('single dataset keeps its name and gets no overall row', () => {
    const perDs = new Map([['medical', newAcc()]]);
    addScore(perDs.get('medical'), sc(10, 1)); // 10% WER
    addScore(perDs.get('medical'), sc(10, 3)); // 30% WER
    const datasets = buildDatasets(perDs, ['medical']);
    assert.equal(datasets.length, 1);
    assert.equal(datasets[0].name, 'medical');
    assert.equal(datasets[0].wordEdits, 4);
    assert.equal(datasets[0].refWords, 20);
    assert.deepEqual(datasets[0].werSamples, [10, 30]);
    // repDataset of a single-dataset cell is that dataset.
    assert.equal(repDataset({ datasets }), datasets[0]);
  });

  test('multiple datasets append an "overall" row pooling every utterance', () => {
    const perDs = new Map([['medical', newAcc()], ['general', newAcc()]]);
    addScore(perDs.get('medical'), sc(10, 1));
    addScore(perDs.get('medical'), sc(10, 3));
    addScore(perDs.get('general'), sc(5, 1)); // 20% WER
    const datasets = buildDatasets(perDs, ['medical', 'general']);
    assert.deepEqual(datasets.map((d) => d.name), ['medical', 'general', OVERALL]);
    const overall = datasets[2];
    // Overall edits/refs are the sums; werSamples are the concatenation.
    assert.equal(overall.wordEdits, 1 + 3 + 1);
    assert.equal(overall.refWords, 10 + 10 + 5);
    assert.deepEqual(overall.werSamples, [10, 30, 20]);
    // repDataset picks the overall pool for a multi-dataset cell.
    assert.equal(repDataset({ datasets }), overall);
  });

  test('datasetNames order is honoured; absent datasets are skipped', () => {
    const perDs = new Map([['general', newAcc()]]);
    addScore(perDs.get('general'), sc(5, 1));
    // medical was declared first but produced no utterances this cell -> dropped.
    const datasets = buildDatasets(perDs, ['medical', 'general']);
    assert.deepEqual(datasets.map((d) => d.name), ['general']);
  });
});

describe('cellRate: word/char-weighted corpus WER or CER for a cell', () => {
  // Build a single-dataset grid cell with explicit edit/ref totals.
  const cell = (name, refWords, wordEdits, refChars, charEdits) => {
    const perDs = new Map([[name, newAcc()]]);
    addScore(perDs.get(name), { refWords, hypWords: refWords, wordEdits, refChars, charEdits });
    return { datasets: buildDatasets(perDs, [name]) };
  };

  test('reads corpus WER/CER off the (overall) representative row', () => {
    const a = cell('a', 10, 2, 100, 5); // WER 20%, CER 5%
    assert.equal(cellRate(a, 'wer'), 20);
    assert.equal(cellRate(a, 'cer'), 5);
  });

  test('pools datasets by word/char count, not utterance count', () => {
    const perDs = new Map([['med', newAcc()], ['gen', newAcc()]]);
    addScore(perDs.get('med'), { refWords: 10, hypWords: 10, wordEdits: 1, refChars: 50, charEdits: 5 });
    addScore(perDs.get('gen'), { refWords: 5, hypWords: 5, wordEdits: 2, refChars: 25, charEdits: 1 });
    const row = { datasets: buildDatasets(perDs, ['med', 'gen']) };
    // Overall WER = (1+2)/(10+5) = 20%; the bigger dataset (med, 10 words) pulls
    // it more than gen (5 words) would in a plain per-dataset average.
    assert.equal(cellRate(row, 'wer'), 20);
    assert.equal(cellRate(row, 'cer'), +(100 * 6 / 75).toFixed(10));
  });

  test('--sort-by wer vs cer can reorder cells', () => {
    const a = cell('a', 10, 2, 100, 5);  // WER 20%, CER 5%
    const b = cell('b', 10, 1, 100, 10); // WER 10%, CER 10%
    const byWer = [a, b].slice().sort((x, y) => cellRate(x, 'wer') - cellRate(y, 'wer'));
    const byCer = [a, b].slice().sort((x, y) => cellRate(x, 'cer') - cellRate(y, 'cer'));
    assert.deepEqual(byWer.map((c) => c.datasets[0].name), ['b', 'a']);
    assert.deepEqual(byCer.map((c) => c.datasets[0].name), ['a', 'b']);
  });
});

describe('accuracyBody: one row per dataset per grid cell', () => {
  test('has a dataset column and emits per-dataset + overall rows', () => {
    const dsCol = ACC_HEAD.indexOf('dataset');
    assert.ok(dsCol >= 0, 'ACC_HEAD must include a dataset column');

    const perDs = new Map([['medical', newAcc()], ['general', newAcc()]]);
    addScore(perDs.get('medical'), sc(10, 1));
    addScore(perDs.get('general'), sc(5, 1));
    const row = {
      beamWidth: 4, boostLabel: 'boost', strength: 2,
      datasets: buildDatasets(perDs, ['medical', 'general']),
    };
    const body = accuracyBody([row]);
    assert.equal(body.length, 3); // medical, general, overall
    assert.deepEqual(body.map((r) => r[dsCol]), ['medical', 'general', OVERALL]);
    // Beam / boost / strength repeat across a cell's rows.
    for (const r of body) {
      assert.equal(r[0], '4');
      assert.equal(r[1], 'boost');
      assert.equal(r[2], '2');
    }
  });
});
