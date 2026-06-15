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
  cellRate, ACC_HEAD, accuracyBody, topBody, OVERALL,
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

  test('overall weights datasets by size (micro-average), not a plain mean of rates', () => {
    const perDs = new Map([['med', newAcc()], ['gen', newAcc()]]);
    // med: 1/10 = 10% WER over 10 words; gen: 2/5 = 40% WER over 5 words.
    addScore(perDs.get('med'), { refWords: 10, hypWords: 10, wordEdits: 1, refChars: 50, charEdits: 5 });
    addScore(perDs.get('gen'), { refWords: 5, hypWords: 5, wordEdits: 2, refChars: 25, charEdits: 1 });
    const row = { datasets: buildDatasets(perDs, ['med', 'gen']) };
    // Size-weighted overall WER = (1+2)/(10+5) = 20%, NOT the naive average of
    // the two per-dataset rates ((10+40)/2 = 25%): the bigger dataset (med, 10
    // words) pulls the overall toward its lower rate.
    assert.equal(cellRate(row, 'wer'), 20);
    assert.notEqual(cellRate(row, 'wer'), 25);
    // Same for CER: (5+1)/(50+25) = 8%, not (10+4)/2 = 7%.
    assert.equal(cellRate(row, 'cer'), 8);
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
    const beamCol = ACC_HEAD.indexOf('beam');
    const boostCol = ACC_HEAD.indexOf('boost');
    const strengthCol = ACC_HEAD.indexOf('strength');
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
      assert.equal(r[beamCol], '4');
      assert.equal(r[boostCol], 'boost');
      assert.equal(r[strengthCol], '2');
    }
  });

  test('renders the quant sweep column (value, and "-" when unset)', () => {
    const quantCol = ACC_HEAD.indexOf('quant');
    assert.ok(quantCol >= 0, 'ACC_HEAD must include a quant column');

    const mk = (quant) => {
      const perDs = new Map([['medical', newAcc()]]);
      addScore(perDs.get('medical'), sc(10, 1));
      return { beamWidth: 1, quant, boostLabel: 'none', strength: null, minp: null, depthScaling: null,
        datasets: buildDatasets(perDs, ['medical']) };
    };
    assert.equal(accuracyBody([mk('fp16')])[0][quantCol], 'fp16', 'a swept quant renders its value');
    assert.equal(accuracyBody([mk('int8')])[0][quantCol], 'int8', 'int8 renders as int8');
    assert.equal(accuracyBody([mk(undefined)])[0][quantCol], '-', 'an absent quant renders "-"');
  });

  test('renders the decoder-quant sweep column (value, and "-" when unset)', () => {
    const decCol = ACC_HEAD.indexOf('dec');
    assert.ok(decCol >= 0, 'ACC_HEAD must include a decoder-quant column');

    const mk = (decoderQuant) => {
      const perDs = new Map([['medical', newAcc()]]);
      addScore(perDs.get('medical'), sc(10, 1));
      return { beamWidth: 1, quant: 'int8', decoderQuant, boostLabel: 'none', strength: null, minp: null, depthScaling: null,
        datasets: buildDatasets(perDs, ['medical']) };
    };
    assert.equal(accuracyBody([mk('fp32')])[0][decCol], 'fp32', 'a swept decoder quant renders its value');
    assert.equal(accuracyBody([mk('int8')])[0][decCol], 'int8', 'an int8 decoder renders as int8');
    assert.equal(accuracyBody([mk(undefined)])[0][decCol], '-', 'an absent decoder quant renders "-"');
    // The decoder quant is an independent column: an int8 encoder with an fp32
    // decoder must show both, not collapse to a single quant.
    const quantCol = ACC_HEAD.indexOf('quant');
    const mixed = accuracyBody([mk('fp32')])[0];
    assert.equal(mixed[quantCol], 'int8', 'encoder quant stays in the quant column');
    assert.equal(mixed[decCol], 'fp32', 'decoder quant is reported separately');
  });

  test('renders the min-p sweep column (value, and "-" when unset)', () => {
    const minpCol = ACC_HEAD.indexOf('minp');
    assert.ok(minpCol >= 0, 'ACC_HEAD must include a min-p column');

    const mk = (minp) => {
      const perDs = new Map([['medical', newAcc()]]);
      addScore(perDs.get('medical'), sc(10, 1));
      return { beamWidth: 1, boostLabel: 'boost', strength: 1, minp, datasets: buildDatasets(perDs, ['medical']) };
    };
    assert.equal(accuracyBody([mk(0.05)])[0][minpCol], '0.05', 'a swept min-p renders its value');
    assert.equal(accuracyBody([mk(null)])[0][minpCol], '-', 'a baked/absent min-p renders "-"');
  });

  test('renders the depth-scaling sweep column (value, "0" for flat, and "-" when unset)', () => {
    const dscaleCol = ACC_HEAD.indexOf('dscale');
    assert.ok(dscaleCol >= 0, 'ACC_HEAD must include a depth-scaling column');

    const mk = (depthScaling) => {
      const perDs = new Map([['medical', newAcc()]]);
      addScore(perDs.get('medical'), sc(10, 1));
      return { beamWidth: 1, boostLabel: 'boost', strength: 1, minp: null, depthScaling, datasets: buildDatasets(perDs, ['medical']) };
    };
    assert.equal(accuracyBody([mk(1)])[0][dscaleCol], '1', 'a swept depth-scaling renders its value');
    assert.equal(accuracyBody([mk(0)])[0][dscaleCol], '0', 'a flat (0) depth-scaling renders "0", not "-"');
    assert.equal(accuracyBody([mk(null)])[0][dscaleCol], '-', 'a default/absent depth-scaling renders "-"');
  });

  test('renders the RTF column from the cell timings (mean), "-" when absent', () => {
    const rtfCol = ACC_HEAD.indexOf('RTF');
    assert.ok(rtfCol >= 0, 'ACC_HEAD must include an RTF column');

    const perDs = new Map([['medical', newAcc()]]);
    addScore(perDs.get('medical'), sc(10, 1));
    const base = { beamWidth: 1, boostLabel: 'none', strength: null, minp: null, depthScaling: null,
      datasets: buildDatasets(perDs, ['medical']) };

    // With timings: the column is the mean RTF over the cell's utterances.
    assert.equal(accuracyBody([{ ...base, timings: { rtf: [0.2, 0.4] } }])[0][rtfCol], '0.30');
    // Without a timings field (e.g. synthetic rows): renders "-", does not throw.
    assert.equal(accuracyBody([base])[0][rtfCol], '-');
  });

  test('renders the per-dataset dec_t/aud ratio (summed decode / summed audio), micro-averaged in overall', () => {
    const decAudCol = ACC_HEAD.indexOf('dec_t/aud');
    assert.ok(decAudCol >= 0, 'ACC_HEAD must include a dec_t/aud column');

    const perDs = new Map([['medical', newAcc()], ['general', newAcc()]]);
    // medical: 100 ms decode over 4 s audio -> 0.025; general: 300 ms over 2 s -> 0.150.
    addScore(perDs.get('medical'), sc(10, 1), 100, 4);
    addScore(perDs.get('general'), sc(5, 1), 300, 2);
    const row = { beamWidth: 4, boostLabel: 'none', strength: null, minp: null, depthScaling: null,
      datasets: buildDatasets(perDs, ['medical', 'general']) };

    const body = accuracyBody([row]);
    assert.deepEqual(body.map((r) => r[decAudCol]), ['0.025', '0.150', '0.067']);
    // The overall ratio is summed-decode / summed-audio (0.4 s / 6 s = 0.067),
    // NOT the plain mean of the two per-dataset ratios ((0.025+0.150)/2 = 0.0875).
    assert.notEqual(body[2][decAudCol], '0.088');
  });

  test('dec_t/aud renders "-" when the audio length is unknown', () => {
    const decAudCol = ACC_HEAD.indexOf('dec_t/aud');
    const perDs = new Map([['medical', newAcc()]]);
    // No decode/audio timing passed (synthetic / pre-audioSec rows): audioSec = 0.
    addScore(perDs.get('medical'), sc(10, 1));
    const row = { beamWidth: 1, boostLabel: 'none', strength: null, minp: null, depthScaling: null,
      datasets: buildDatasets(perDs, ['medical']) };
    assert.equal(accuracyBody([row])[0][decAudCol], '-');
  });
});

describe('topBody: one row per cell using the representative (overall) dataset', () => {
  test('collapses a multi-dataset cell to its overall row with WER/CER/RTF/decode-aud', () => {
    const perDs = new Map([['medical', newAcc()], ['general', newAcc()]]);
    addScore(perDs.get('medical'), sc(10, 1), 100, 4); // 1/10 words, 5/50 chars, 100 ms / 4 s
    addScore(perDs.get('general'), sc(5, 1), 300, 2);   // 1/5 words, 5/25 chars, 300 ms / 2 s
    const row = { beamWidth: 4, quant: 'fp16', decoderQuant: 'int8', boostLabel: 'boost', strength: 2, minp: null, depthScaling: null,
      timings: { rtf: [0.5] }, datasets: buildDatasets(perDs, ['medical', 'general']) };

    const body = topBody([row]);
    assert.equal(body.length, 1, 'one row per cell, not per dataset');
    const dsCol = ACC_HEAD.indexOf('dataset');
    const quantCol = ACC_HEAD.indexOf('quant');
    const decCol = ACC_HEAD.indexOf('dec');
    const werCol = ACC_HEAD.indexOf('WER %');
    const cerCol = ACC_HEAD.indexOf('CER %');
    const rtfCol = ACC_HEAD.indexOf('RTF');
    const decAudCol = ACC_HEAD.indexOf('dec_t/aud');
    assert.equal(body[0][dsCol], OVERALL, 'uses the overall pool as the representative row');
    assert.equal(body[0][quantCol], 'fp16', 'carries the cell encoder quant into the top table');
    assert.equal(body[0][decCol], 'int8', 'carries the cell decoder quant into the top table');
    // Micro-averaged: (1+1)/(10+5) words, (5+5)/(50+25) chars.
    assert.equal(body[0][werCol], (100 * 2 / 15).toFixed(2));
    assert.equal(body[0][cerCol], (100 * 10 / 75).toFixed(2));
    assert.equal(body[0][rtfCol], '0.50');
    // dec_t/aud is the overall pool's summed decode / summed audio: 0.4 s / 6 s.
    assert.equal(body[0][decAudCol], '0.067');
  });
});
