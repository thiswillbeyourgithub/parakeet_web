// Tier-1 unit test for scripts/fetch-e2e-models.mjs (the CI model fetch).
// What it pins: the fetch list is entirely REQUIRED, so a broken model URL is
// impossible to miss, and the `optional` escape hatch still behaves (tolerate a
// 404 by warning and skipping) for the recurring window where a file is
// committed to the model repo but not yet pushed to HF. Network-free (fetch is
// stubbed).
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODELS, download, destPath, asrRootIn, ASR_REPO, DIARIZATION_SEG_REPO, DIARIZATION_EMB_REPO } from '../../scripts/fetch-e2e-models.mjs';
import { layoutDirFor, basenameOf } from '../../app/src/modelLayout.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const tmp = () => mkdtempSync(join(tmpdir(), 'fetch-e2e-'));

describe('fetch-e2e-models: optional vs required download entries', () => {
  test('every listed file is required, at its in-repo path', () => {
    const byFile = Object.fromEntries(MODELS.map((m) => [m.file, m]));
    // The ASR set is the canonical pair plus the vocab: the model repo's graph
    // work ships INSIDE those two files, so there is no variant filename to
    // fetch alongside them any more. The paths carry the repo's precision
    // folders, so the mirror CI builds has the same shape as the repo and
    // exercises the same resolution hub.js does in production.
    assert.ok(!byFile['int8/encoder-model.int8.onnx'].optional);
    assert.ok(!byFile['int8/decoder_joint-model.int8.onnx'].optional);
    assert.ok(!byFile['vocab.txt'].optional);
    // The lite int8 encoder is the one precision ALTERNATIVE headless Chromium
    // can run, so it is listed to give transcription-int8-lite-wasm.spec.js real
    // CI coverage. Dropping it would not fail anything loudly: strict-weights is
    // lenient in CI, so that spec would just skip forever. Pin it here.
    assert.ok(byFile['int8-lite/encoder-model.int8.lite.onnx'], 'the lite int8 encoder must stay in the CI fetch list');
    assert.ok(!byFile['int8-lite/encoder-model.int8.lite.onnx'].optional);
    // No `optional` creep anywhere: a 404 on ANY entry must fail the fetch, not
    // warn and leave a spec to discover the gap.
    assert.deepEqual(MODELS.filter((m) => m.optional).map((m) => m.file), []);
  });

  test('each ASR entry sits in the directory modelLayout gives its basename', () => {
    // The fetch list is a second place that spells out repo paths, so pin it to
    // the one place that OWNS them: a rename in modelLayout that is not mirrored
    // here would otherwise download to a directory nothing serves from.
    for (const { file } of MODELS.filter((m) => m.file.includes('/'))) {
      const base = basenameOf(file);
      assert.equal(file, layoutDirFor(base) + base, file);
    }
  });

  test('a nested entry creates its directory and lands under its REPO', async () => {
    // The mirror is shaped like a mount of several repos, not like one repo's
    // contents: <modelDir>/<repo>/<repo-relative path>. That is the layout the
    // app resolves by asking for a repo by name, and the only one that works
    // once a deployment offers a choice of models.
    const dir = tmp();
    globalThis.fetch = async () => new Response('model-bytes');
    assert.equal(await download({ repo: 'r/x', file: 'int8/enc.onnx' }, dir), true);
    assert.equal(readFileSync(join(dir, 'r', 'x', 'int8', 'enc.onnx'), 'utf-8'), 'model-bytes');
    // The old flat spelling must NOT also appear: two copies of a multi-GB
    // weight set is the kind of thing nobody notices until a disk fills.
    assert.equal(existsSync(join(dir, 'int8', 'enc.onnx')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a root-level entry is under its repo too, not loose at the top', async () => {
    // The diarization models are the reason this matters: they come from two
    // OTHER repos and used to land loose at the mirror root, because the local
    // fetch addressed them by bare basename. Now they get prefixes like
    // everything else, which is what lets a maintainer's mirror hold nothing
    // but repo folders.
    const dir = tmp();
    globalThis.fetch = async () => new Response('model-bytes');
    await download({ repo: DIARIZATION_EMB_REPO, file: 'emb.onnx' }, dir);
    assert.equal(readFileSync(join(dir, DIARIZATION_EMB_REPO, 'emb.onnx'), 'utf-8'), 'model-bytes');
    assert.equal(existsSync(join(dir, 'emb.onnx')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('every entry has a repo, since the repo is now part of the path', () => {
    // Previously an entry without `repo` would still have landed somewhere
    // sensible; now it would write to <modelDir>/undefined/..., so pin it.
    for (const { repo, file } of MODELS) {
      assert.ok(repo && repo.includes('/'), `${file} needs a repo id, got ${repo}`);
    }
    // And the ids the specs import for their probes are the ones actually used.
    const repos = new Set(MODELS.map((m) => m.repo));
    for (const r of [ASR_REPO, DIARIZATION_SEG_REPO, DIARIZATION_EMB_REPO]) {
      assert.ok(repos.has(r), `${r} is exported for the specs but nothing fetches it`);
    }
  });

  test('destPath is what the partial-file cleanup and the writer agree on', () => {
    // main() removes `${destPath(...)}.partial` on failure. When those two
    // disagreed, a half-downloaded file survived and the next run skipped it as
    // "already present", which is a corrupt weight that looks like a cache hit.
    assert.equal(destPath('/m', 'r/x', 'int8/enc.onnx'), '/m/r/x/int8/enc.onnx');
  });

  test('the HF request asks for the same nested path', async () => {
    const dir = tmp();
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('model-bytes'); };
    await download({ repo: 'r/x', file: 'int8/enc.onnx' }, dir);
    // The repo prefix is a LOCAL layout choice; on HF the file is still at its
    // plain repo-relative path, so it must not leak into the request.
    assert.ok(urls[0].includes('/r/x/resolve/main/int8/enc.onnx'), urls[0]);
    assert.ok(!urls[0].includes('/resolve/main/r/x/'), urls[0]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an optional 404 resolves false and writes nothing', async () => {
    const dir = tmp();
    globalThis.fetch = async () => new Response('nope', { status: 404, statusText: 'Not Found' });
    const got = await download({ repo: 'r/x', file: 'maybe.onnx', optional: true }, dir);
    assert.equal(got, false);
    assert.equal(existsSync(join(dir, 'r', 'x', 'maybe.onnx')), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a required 404 throws and names the file', async () => {
    const dir = tmp();
    globalThis.fetch = async () => new Response('nope', { status: 404, statusText: 'Not Found' });
    await assert.rejects(() => download({ repo: 'r/x', file: 'must.onnx' }, dir), /must\.onnx.*404/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a successful download lands the bytes (optional and required alike)', async () => {
    const dir = tmp();
    globalThis.fetch = async () => new Response('model-bytes');
    assert.equal(await download({ repo: 'r/x', file: 'ok.onnx', optional: true }, dir), true);
    assert.equal(readFileSync(join(dir, 'r', 'x', 'ok.onnx'), 'utf-8'), 'model-bytes');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an already-present file short-circuits without fetching', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'r', 'x'), { recursive: true });
    writeFileSync(join(dir, 'r', 'x', 'have.onnx'), 'cached');
    globalThis.fetch = async () => { throw new Error('must not fetch'); };
    assert.equal(await download({ repo: 'r/x', file: 'have.onnx' }, dir), true);
    assert.equal(readFileSync(join(dir, 'r', 'x', 'have.onnx'), 'utf-8'), 'cached');
    rmSync(dir, { recursive: true, force: true });
  });
});

// asrRootIn is how the two FILESYSTEM readers of this mirror (the batching
// equivalence gate, serve.mjs's startup canary) find the weights now that the
// fetch nests by repo. It earns its own tests because its failure is silent in
// the worst direction: returning the wrong root makes the batching gate find no
// model and SELF-SKIP, so CI stays green while checking nothing.
describe('fetch-e2e-models: asrRootIn', () => {
  const ASR = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';

  test('descends into the repo folder of a nested mirror', () => {
    const dir = tmp();
    mkdirSync(join(dir, ASR), { recursive: true });
    writeFileSync(join(dir, ASR, 'vocab.txt'), 'v');
    assert.equal(asrRootIn(dir, ASR), join(dir, ASR));
    rmSync(dir, { recursive: true, force: true });
  });

  test('leaves a flat mirror alone', () => {
    // fallback_models and every pre-existing checkout: the weights are already
    // at the root, so descending would break what works today.
    const dir = tmp();
    writeFileSync(join(dir, 'vocab.txt'), 'v');
    assert.equal(asrRootIn(dir, ASR), dir);
    rmSync(dir, { recursive: true, force: true });
  });

  test('prefers the flat root when a mirror somehow has both', () => {
    // Ambiguous, but the flat root is the documented contract and what the
    // caller passed, so it wins rather than a subfolder being guessed into.
    const dir = tmp();
    writeFileSync(join(dir, 'vocab.txt'), 'v');
    mkdirSync(join(dir, ASR), { recursive: true });
    writeFileSync(join(dir, ASR, 'vocab.txt'), 'v');
    assert.equal(asrRootIn(dir, ASR), dir);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns the dir unchanged when neither layout has weights', () => {
    // The caller then fails or skips on its own terms, with the path it named.
    const dir = tmp();
    assert.equal(asrRootIn(dir, ASR), dir);
    rmSync(dir, { recursive: true, force: true });
  });

  test('defaults to the ASR repo this script fetches', () => {
    const dir = tmp();
    mkdirSync(join(dir, ASR_REPO), { recursive: true });
    writeFileSync(join(dir, ASR_REPO, 'vocab.txt'), 'v');
    assert.equal(asrRootIn(dir), join(dir, ASR_REPO));
    rmSync(dir, { recursive: true, force: true });
  });
});
