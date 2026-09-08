// Tier-1 unit test for test/e2e/model-probe.mjs, the tier-3 helper that decides
// where an optional model file might be served from.
//
// Worth a fast-tier test because its failure mode is silent and expensive: a
// probe that misses a file which IS present reads as "weights missing", and
// strict-weights turns that into a local FAILURE blaming the checkout. The
// suite would then be red for a reason that has nothing to do with the app.
// The URL LIST is pure, so it can be pinned here without a browser.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelProbeUrls, probeModelUrl, repoRootUrl } from '../../test/e2e/model-probe.mjs';
import { candidatePaths } from '../../app/src/modelLayout.js';

const ASR = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const EMB = 'csukuangfj/speaker-embedding-models';

describe('modelProbeUrls', () => {
  test('probes the repo-nested layout before the flat one', async () => {
    const urls = modelProbeUrls(ASR, 'encoder-model.int8.onnx');
    const firstFlat = urls.findIndex((u) => !u.includes(ASR));
    const lastNested = urls.map((u) => u.includes(ASR)).lastIndexOf(true);
    assert.ok(lastNested < firstFlat,
      `every nested candidate must precede every flat one:\n${urls.join('\n')}`);
  });

  test('covers both layouts for every directory candidatePaths knows', () => {
    // The probe must not hold its own opinion about which folder a file lives
    // in: that rule belongs to modelLayout.js (int8/, fp32/, int8-lite/, plus
    // the root and sharded/ spellings), and serve.mjs already resolves bare
    // basenames through it. Pinning the product here is what stops the probe
    // from drifting into a private, narrower idea of the layout.
    for (const basename of ['encoder-model.int8.onnx', 'encoder-model.onnx.data.000', 'model.onnx']) {
      const expected = [
        ...candidatePaths(basename).map((p) => `/models/${ASR}/${p}`),
        ...candidatePaths(basename).map((p) => `/models/${p}`),
      ];
      assert.deepEqual(modelProbeUrls(ASR, basename), expected, basename);
    }
  });

  test('drops the flat arm entirely once the repo has its own root', () => {
    // The bug this pins cost a real 7-minute test run. hub.js resolves a repo
    // to its own folder and reads ONLY from there, so on a mirror that has both
    // (every maintainer checkout with root symlinks) a file found flat is one
    // the app will never load. Ordering nested first is not enough: the flat
    // hit still comes back and green-lights a run that then dies inside the app
    // on a quant-unavailable banner, far from the cause.
    const urls = modelProbeUrls(ASR, 'encoder-model.int8.lite.onnx', { repoRootServed: true });
    assert.ok(urls.length > 0, 'the nested candidates must still be probed');
    assert.ok(urls.every((u) => u.startsWith(`/models/${ASR}/`)),
      `no flat candidate may survive a served repo root:\n${urls.join('\n')}`);
  });

  test('the repo-root canary is the one hub.js uses', () => {
    // If these ever diverge the probe stops predicting the app, which is the
    // entire point of asking the question at all.
    assert.equal(repoRootUrl(ASR), `/models/${ASR}/vocab.txt`);
    assert.equal(repoRootUrl(ASR, '/mirror'), `/mirror/${ASR}/vocab.txt`);
  });

  test('finds an fp32 shard whether it sits in fp32/ or the older sharded/', () => {
    // The concrete case the flat-only probe used to get right by accident (via
    // serve.mjs's bare-basename fallback) and that a naive nested rewrite would
    // have broken for every checkout that keeps shards in sharded/.
    const urls = modelProbeUrls(ASR, 'encoder-model.onnx.data.000');
    assert.ok(urls.includes(`/models/${ASR}/fp32/encoder-model.onnx.data.000`));
    assert.ok(urls.includes(`/models/${ASR}/sharded/encoder-model.onnx.data.000`));
    assert.ok(urls.includes('/models/fp32/encoder-model.onnx.data.000'));
    assert.ok(urls.includes('/models/sharded/encoder-model.onnx.data.000'));
  });

  test('a diarization model is probed under its own repo and at the root', () => {
    // These two moved from "loose at the mirror root" to "under their repo", so
    // both spellings have to keep answering: CI builds the nested one, existing
    // checkouts have the flat one.
    const basename = '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';
    const urls = modelProbeUrls(EMB, basename);
    assert.equal(urls[0], `/models/${EMB}/${basename}`);
    assert.ok(urls.includes(`/models/${basename}`));
  });

  test('honours a non-default base', () => {
    const urls = modelProbeUrls(EMB, 'model.onnx', { base: '/mirror' });
    assert.ok(urls.every((u) => u.startsWith('/mirror/')), urls.join('\n'));
  });
});

// probeModelUrl's job is to give the same answer the app will. Everything below
// is a way for it to disagree, and each disagreement is expensive in its own
// direction: reporting a file the app cannot load turns into a failure minutes
// later and far from its cause, while missing one the app CAN load turns into a
// permanent skip that reads as "this deployment has no weights".
describe('probeModelUrl', () => {
  // A mirror serving exactly `served` (repo-relative URLs), with an optional
  // manifest per base. `seen` records every request.
  const mirror = ({ served = [], manifests = {}, seen = null } = {}) => ({
    head: async (url) => { if (seen) seen.push(`HEAD ${url}`); return { ok: () => served.includes(url) }; },
    get: async (url) => {
      if (seen) seen.push(`GET ${url}`);
      for (const [base, files] of Object.entries(manifests)) {
        if (url === `${base}/model-manifest.json`) return { ok: () => true, json: async () => files };
      }
      return { ok: () => false, json: async () => { throw new Error('not json'); } };
    },
  });

  test('a manifest decides, even for a directory no candidate path names', async () => {
    // The case the manifest exists for: the optimized repo files its lite int8
    // encoder inside a nested sub-repo, so probing alone can never find it and
    // the spec would skip on a mirror that serves it perfectly well.
    const nested = 'istupakov_smoothquant/int8-lite/encoder-model.int8.lite.onnx';
    const got = await probeModelUrl(
      mirror({ manifests: { [`/models/${ASR}`]: ['vocab.txt', nested] } }),
      ASR, 'encoder-model.int8.lite.onnx');
    assert.equal(got, `/models/${ASR}/${nested}`);
  });

  test('a manifest that does not list the file means not served, without probing', async () => {
    // The mirror has described itself completely, so a HEAD sweep could only
    // find something the app will not read. Silence is the honest answer.
    const seen = [];
    const got = await probeModelUrl(
      mirror({ served: [`/models/${ASR}/int8-lite/encoder-model.int8.lite.onnx`],
               manifests: { [`/models/${ASR}`]: ['vocab.txt'] }, seen }),
      ASR, 'encoder-model.int8.lite.onnx');
    assert.equal(got, null);
    assert.ok(!seen.some((r) => r.startsWith('HEAD')), seen.join('\n'));
  });

  test('a flat mirror is asked for its own manifest, and only after the repo root misses', async () => {
    const basename = 'encoder-model.int8.lite.onnx';
    const got = await probeModelUrl(
      mirror({ manifests: { '/models': ['weird_export/' + basename] } }), ASR, basename);
    assert.equal(got, `/models/weird_export/${basename}`);
  });

  test('a repo root that IS served stops the flat manifest being consulted', async () => {
    // Same rule the flat HEAD arm follows: hub.js resolves the repo to its own
    // folder and reads only from there, so the flat tree cannot answer for it.
    const basename = 'encoder-model.int8.lite.onnx';
    const got = await probeModelUrl(
      mirror({ served: [repoRootUrl(ASR)], manifests: { '/models': [`int8-lite/${basename}`] } }),
      ASR, basename);
    assert.equal(got, null);
  });

  test('no manifest anywhere falls back to probing, exactly as before', async () => {
    const url = `/models/${ASR}/int8-lite/encoder-model.int8.lite.onnx`;
    assert.equal(await probeModelUrl(mirror({ served: [url] }), ASR, 'encoder-model.int8.lite.onnx'), url);
  });

  test('a manifest that is not a listing is ignored rather than believed', async () => {
    // A static host with an SPA fallback answers a missing file with HTML at
    // 200. Treating that as an empty listing would skip every optional spec.
    const url = `/models/${ASR}/int8-lite/encoder-model.int8.lite.onnx`;
    assert.equal(await probeModelUrl(
      mirror({ served: [url], manifests: { [`/models/${ASR}`]: { files: [] } } }),
      ASR, 'encoder-model.int8.lite.onnx'), url);
  });
});
