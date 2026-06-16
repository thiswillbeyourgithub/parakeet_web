// Tier-1 unit test for the generational cache-sweep selection logic in
// app/src/hub.js (baseCacheKey + selectOrphanKeys).
//
// Why this exists: model weights are cached in IndexedDB keyed by
// `hf-<repo>-<rev>-<subfolder>-<filename>`. Switching repo / revision / quant
// produces a NEW set of keys and orphans the old ones forever (a re-download
// overwrites in place, evictModelFiles only targets a corrupt file, clearCache
// is the user's all-or-nothing reset). The sweep deletes every record that is
// not part of the just-loaded model's live set. The IDB plumbing itself can
// only run in a browser (Node has no IndexedDB), so this test pins down the
// pure decision: from all keys + the live set, which keys are orphans.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseCacheKey, selectOrphanKeys } from '../../app/src/hub.js';

// Mirror makeCacheKey (not exported): hf-<repo>-<rev>-<subfolder>-<filename>.
const key = (repo, rev, sub, file) => `hf-${repo}-${rev}-${sub}-${file}`;

describe('baseCacheKey', () => {
  test('returns a plain blob key unchanged', () => {
    const k = key('istupakov/parakeet', 'main', '', 'encoder-model.onnx');
    assert.equal(baseCacheKey(k), k);
  });

  test('strips the meta- prefix back to the blob key', () => {
    const blob = key('repo', 'main', '', 'vocab.txt');
    assert.equal(baseCacheKey(`meta-${blob}`), blob);
  });

  test('strips the partial- prefix back to the blob key', () => {
    const blob = key('repo', 'main', '', 'decoder_joint-model.onnx');
    assert.equal(baseCacheKey(`partial-${blob}`), blob);
  });

  test('strips a partial segment (-seg-N) back to the blob key', () => {
    const blob = key('repo', 'main', '', 'encoder-model.onnx.data.000');
    assert.equal(baseCacheKey(`partial-${blob}-seg-0`), blob);
    assert.equal(baseCacheKey(`partial-${blob}-seg-17`), blob);
  });

  test('does not truncate a literal "-seg-" that is not a numeric segment suffix', () => {
    // A repo/filename containing "-seg-" followed by non-digits must survive.
    const blob = key('weird-seg-repo', 'main', '', 'model.onnx');
    assert.equal(baseCacheKey(`partial-${blob}`), blob);
  });

  test('only strips the trailing numeric segment, keeping an inner -seg- intact', () => {
    const blob = key('weird-seg-repo', 'main', '', 'model.onnx');
    assert.equal(baseCacheKey(`partial-${blob}-seg-3`), blob);
  });
});

describe('selectOrphanKeys', () => {
  const repo = 'istupakov/parakeet';
  const live = new Set([
    key(repo, 'main', '', 'encoder-model.onnx'),
    key(repo, 'main', '', 'decoder_joint-model.onnx'),
    key(repo, 'main', '', 'vocab.txt'),
  ]);

  test('keeps all three record kinds of a live file', () => {
    const blob = key(repo, 'main', '', 'encoder-model.onnx');
    const all = [blob, `meta-${blob}`, `partial-${blob}`, `partial-${blob}-seg-0`];
    assert.deepEqual(selectOrphanKeys(all, live), []);
  });

  test('flags a different quant of the same repo as orphan', () => {
    // int8 weights left behind after switching to fp32.
    const int8 = key(repo, 'main', '', 'encoder-model.int8.onnx');
    const all = [...live, int8, `meta-${int8}`];
    assert.deepEqual(selectOrphanKeys(all, live).sort(), [int8, `meta-${int8}`].sort());
  });

  test('flags a different repo entirely as orphan', () => {
    const other = key('nvidia/other-model', 'main', '', 'encoder-model.onnx');
    assert.deepEqual(selectOrphanKeys([...live, other], live), [other]);
  });

  test('flags a different revision of the same file as orphan', () => {
    const oldRev = key(repo, 'abc1234', '', 'encoder-model.onnx');
    assert.deepEqual(selectOrphanKeys([...live, oldRev], live), [oldRev]);
  });

  test('leaves non-model keys untouched', () => {
    // Defensive: a key that is not one of our hf- records must never be deleted.
    const all = [...live, 'some-unrelated-key', 'settings', 42, null];
    assert.deepEqual(selectOrphanKeys(all, live), []);
  });

  test('an empty store yields no orphans', () => {
    assert.deepEqual(selectOrphanKeys([], live), []);
  });

  test('protected keys (e.g. diarization models) survive the sweep', () => {
    // A different repo's weights would normally be swept, but a protect set
    // shields them: the diarization seg + emb models live outside the Parakeet
    // live set and must not be deleted on every model load.
    const seg = key('csukuangfj/sherpa-onnx-pyannote-segmentation-3-0', 'main', '', 'model.onnx');
    const emb = key('csukuangfj/speaker-embedding-models', 'main', '', 'campplus.onnx');
    const strayOrphan = key('nvidia/old-model', 'main', '', 'encoder-model.onnx');
    const all = [...live, seg, `meta-${seg}`, emb, strayOrphan];
    const protect = new Set([seg, emb]);
    // Without protection both seg + emb + stray are orphans; with it, only stray.
    assert.deepEqual(selectOrphanKeys(all, live, protect), [strayOrphan]);
    // Back-compat: omitting the arg keeps the old behaviour (all three orphaned).
    assert.deepEqual(
      selectOrphanKeys(all, live).sort(),
      [seg, `meta-${seg}`, emb, strayOrphan].sort(),
    );
  });
});
