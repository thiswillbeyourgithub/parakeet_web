// Tier-1 unit test for scripts/fetch-e2e-models.mjs (the CI model fetch).
// What it pins: `optional` entries (the preferred-variant files that may not
// be pushed to HF yet) must tolerate a 404 by warning and skipping, while a
// missing REQUIRED file must still fail the fetch loudly. Both matter: the
// former keeps CI green during the window between committing a new variant to
// the model repo and pushing it to HF; the latter is what makes a broken
// model URL impossible to miss. Network-free (fetch is stubbed).
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODELS, download } from '../../scripts/fetch-e2e-models.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const tmp = () => mkdtempSync(join(tmpdir(), 'fetch-e2e-'));

describe('fetch-e2e-models: optional vs required download entries', () => {
  test('the preferred-variant files are listed and marked optional', () => {
    const byFile = Object.fromEntries(MODELS.map((m) => [m.file, m]));
    assert.equal(byFile['encoder-model.int8.smoothquant.optimized.onnx']?.optional, true);
    assert.equal(byFile['decoder_joint-model.int8.lse.onnx']?.optional, true);
    // The base set must stay required: no `optional` creep on the files every
    // spec depends on.
    assert.ok(!byFile['encoder-model.int8.onnx'].optional);
    assert.ok(!byFile['decoder_joint-model.int8.onnx'].optional);
    assert.ok(!byFile['vocab.txt'].optional);
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
