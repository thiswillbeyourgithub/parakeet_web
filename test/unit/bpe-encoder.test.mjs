// Tier-1 unit test: cross-check the JS BPE encoder (app/src/bpeEncoder.js)
// against ground-truth token ids from the REAL HuggingFace `tokenizers` library.
//
// The ground truth is the committed fixture (test/fixtures/bpe-fixture.json),
// produced by scripts/gen-bpe-fixture.py. So the encode comparison runs
// everywhere with no python. When python + tokenizers/huggingface_hub ARE
// installed, an extra "freshness" gate regenerates the fixture and asserts the
// committed copy has not drifted from upstream; when they are absent it is
// auto-skipped (heavy optional dep, never a hard failure).
//
// Round-tripping decode(encode(x)) is NOT sufficient (it passes for a
// wrong-but-self-consistent encoder), so the exact-id cross-check is the gate.
//
// Migrated from scripts/test-bpe-encoder.mjs to node:test. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BpeEncoder, buildVocabToId } from '../../app/src/bpeEncoder.js';
import { loadCachedFixture, loadMergesAsset, regenerateFixture } from '../support/bpe-fixture.mjs';

const asset = loadMergesAsset();
const fixture = loadCachedFixture();
const enc = new BpeEncoder(asset, buildVocabToId(fixture.id2token));

const id2token = fixture.id2token;
const toks = (ids) => ids.map((i) => id2token[i] ?? `?${i}`).join('|');

describe('JS BPE encoder matches HuggingFace ground truth', () => {
  for (const { text, ids: expected } of fixture.cases) {
    test(`encode ${JSON.stringify(text)}`, () => {
      const got = enc.encode(text);
      assert.deepEqual(
        Array.from(got),
        expected,
        `expected ${toks(expected)} got ${toks(got)}`,
      );
    });
  }
});

describe('fixture freshness (requires python + tokenizers)', () => {
  test('committed fixture matches a fresh HuggingFace regeneration', (t) => {
    const fresh = regenerateFixture();
    if (!fresh) {
      t.skip('python / tokenizers / huggingface_hub unavailable');
      return;
    }
    assert.deepEqual(fresh.id2token, fixture.id2token, 'id2token table drifted');
    assert.equal(fresh.cases.length, fixture.cases.length, 'case count drifted');
    for (let i = 0; i < fresh.cases.length; i++) {
      assert.equal(fresh.cases[i].text, fixture.cases[i].text, `case ${i} text drifted`);
      assert.deepEqual(fresh.cases[i].ids, fixture.cases[i].ids, `case ${i} ids drifted`);
    }
  });
});
