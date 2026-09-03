// Tier-1 unit test for scripts/fetch-e2e-models.mjs (the CI model fetch).
// What it pins: the fetch list is entirely REQUIRED, so a broken model URL is
// impossible to miss, and the `optional` escape hatch still behaves (tolerate a
// 404 by warning and skipping) for the recurring window where a file is
// committed to the model repo but not yet pushed to HF. Network-free (fetch is
// stubbed).
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODELS, download } from '../../scripts/fetch-e2e-models.mjs';
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

  test('a nested entry creates its directory and lands at the full path', async () => {
    const dir = tmp();
    globalThis.fetch = async () => new Response('model-bytes');
    assert.equal(await download({ repo: 'r/x', file: 'int8/enc.onnx' }, dir), true);
    assert.equal(readFileSync(join(dir, 'int8', 'enc.onnx'), 'utf-8'), 'model-bytes');
    rmSync(dir, { recursive: true, force: true });
  });

  test('the HF request asks for the same nested path', async () => {
    const dir = tmp();
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('model-bytes'); };
    await download({ repo: 'r/x', file: 'int8/enc.onnx' }, dir);
    assert.ok(urls[0].includes('/resolve/main/int8/enc.onnx'), urls[0]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an optional 404 resolves false and writes nothing', async () => {
    const dir = tmp();
    globalThis.fetch = async () => new Response('nope', { status: 404, statusText: 'Not Found' });
    const got = await download({ repo: 'r/x', file: 'maybe.onnx', optional: true }, dir);
    assert.equal(got, false);
    assert.equal(existsSync(join(dir, 'maybe.onnx')), false);
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
    assert.equal(readFileSync(join(dir, 'ok.onnx'), 'utf-8'), 'model-bytes');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an already-present file short-circuits without fetching', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'have.onnx'), 'cached');
    globalThis.fetch = async () => { throw new Error('must not fetch'); };
    assert.equal(await download({ repo: 'r/x', file: 'have.onnx' }, dir), true);
    assert.equal(readFileSync(join(dir, 'have.onnx'), 'utf-8'), 'cached');
    rmSync(dir, { recursive: true, force: true });
  });
});
