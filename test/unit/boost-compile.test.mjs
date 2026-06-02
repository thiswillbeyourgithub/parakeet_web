// Tier-1 unit test for the .pwc read/write helpers (app/src/boostCompile.js).
// The .pwc is the operator-shipped precompiled boost artifact: written gzip-
// compressed (the browser never fetches it, only the boot prebuild and the CLI
// read it back) but a plain-JSON .pwc compiled before compression must still
// parse. Validates the round-trip, that the bytes on disk are really gzip, and
// the plain-JSON fallback. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writePwc, readPwc, compileBoostText, BOOST_ARTIFACT_VERSION } from '../../app/src/boostCompile.js';
import { BpeEncoder, buildVocabToId, vocabSignature } from '../../app/src/bpeEncoder.js';
import { loadCachedFixture, loadMergesAsset } from '../support/bpe-fixture.mjs';

const sampleArtifact = () => ({
  version: BOOST_ARTIFACT_VERSION,
  vocabSig: 'deadbeef',
  caseDefault: false,
  encoded: [
    { ids: [12, 34, 56], weight: 5, topk: 40 },
    { ids: [7, 8], weight: -3, topk: 25 },
  ],
  skipped: ['<unk>phrase'],
});

describe('writePwc / readPwc', () => {
  let dir;
  test('setup', () => { dir = mkdtempSync(join(tmpdir(), 'pwc-')); });

  test('round-trips an artifact unchanged', () => {
    const p = join(dir, 'list.pwc');
    const artifact = sampleArtifact();
    writePwc(p, artifact);
    assert.deepEqual(readPwc(p), artifact);
  });

  test('writes gzip bytes on disk (not plain JSON)', () => {
    const p = join(dir, 'gz.pwc');
    writePwc(p, sampleArtifact());
    const buf = readFileSync(p);
    // gzip magic bytes.
    assert.equal(buf[0], 0x1f);
    assert.equal(buf[1], 0x8b);
    // And it inflates back to the JSON we wrote.
    assert.deepEqual(JSON.parse(gunzipSync(buf).toString('utf-8')), sampleArtifact());
  });

  test('reads a legacy plain-JSON .pwc (fallback, no gzip)', () => {
    const p = join(dir, 'legacy.pwc');
    const artifact = sampleArtifact();
    writeFileSync(p, JSON.stringify(artifact), 'utf-8');
    assert.deepEqual(readPwc(p), artifact);
  });

  test('a gzip .pwc is smaller than the plain JSON for a repetitive list', () => {
    // Token-id arrays of a large list compress well; confirm the helper buys
    // something rather than silently writing larger files.
    const big = { ...sampleArtifact(), encoded: [] };
    for (let i = 0; i < 2000; i++) big.encoded.push({ ids: [12, 34, 56, 78], weight: 5, topk: 40 });
    const p = join(dir, 'big.pwc');
    writePwc(p, big);
    const gzBytes = readFileSync(p).length;
    const plainBytes = Buffer.byteLength(JSON.stringify(big), 'utf-8');
    assert.ok(gzBytes < plainBytes, `expected gzip (${gzBytes}) < plain (${plainBytes})`);
  });

  test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });
});

// The .pwc the operator ships must already exclude phrases the model has no
// tokens for (e.g. CJK -> <unk>): such a phrase could never be boosted (the
// decoder never emits <unk>), so it must not bloat `encoded`. It is recorded in
// `skipped` instead, which the UI surfaces as a warning. encodePhrases pins the
// skip at its own level; this pins that compileBoostText carries it into the
// artifact, since that is the layer that writes the shipped .pwc.
describe('compileBoostText filters untokenizable phrases', () => {
  const fixture = loadCachedFixture();
  const encoder = new BpeEncoder(loadMergesAsset(), buildVocabToId(fixture.id2token));
  const vocabSig = vocabSignature(fixture.id2token);
  // One plainly tokenizable phrase plus one CJK phrase that encodes to <unk>.
  const { artifact } = compileBoostText('venlafaxine\n東京', encoder, vocabSig);

  test('untokenizable phrase recorded in skipped', () =>
    assert.deepEqual(artifact.skipped, ['東京']));
  test('untokenizable phrase excluded from encoded', () =>
    assert.equal(artifact.encoded.length, 1));
  test('no encoded entry contains the <unk> id', () =>
    assert.ok(artifact.encoded.every(e => !e.ids.includes(encoder.unkId))));
  test('artifact pins the vocab signature', () =>
    assert.equal(artifact.vocabSig, vocabSig));
});
