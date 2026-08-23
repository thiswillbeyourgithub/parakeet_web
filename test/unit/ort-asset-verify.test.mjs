// Tier-1 unit test for the ORT runtime-asset verification in app/src/backend.js
// (`selectOrtRuntimeAssets` + `_verifiedOrtWasmPaths`).
//
// The property under test is WHICH requests the loader makes, not just what it
// returns. It used to fetch and sha384 EVERY entry in /ort/manifest.json, i.e.
// all four vendored runtime variants (plain / jsep / jspi / asyncify, ~76 MB of
// .wasm), while pinning `wasmPaths` to the jsep pair so the other three were
// never loaded. Each JS context runs its own ORT runtime, so on the composed
// WASM pipeline (main thread + 2 encode workers + 1 decode worker) that was
// ~320 MB fetched at once, concurrently with the model weights: one of those
// transfers reliably died with net::ERR_FAILED, the worker's init reported
// "Failed to fetch", and it silently dropped to the in-thread fallback for the
// rest of the session (transcription-composed-pipeline.spec.js catches it).
//
// So the assertions below pin the request set, not only the result.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  ORT_RUNTIME_ASSETS,
  selectOrtRuntimeAssets,
  _verifiedOrtWasmPaths,
} from '../../app/src/backend.js';

const BASE = '/ort/';

const sha384 = (bytes) => 'sha384-' + createHash('sha384').update(bytes).digest('base64');

// The full vendored set: the jsep pair we pin plus the three variants ORT is
// never pointed at. Bytes are stand-ins; only their hashes matter here.
const FILES = {
  'ort-wasm-simd-threaded.mjs': 'plain-mjs',
  'ort-wasm-simd-threaded.wasm': 'plain-wasm',
  'ort-wasm-simd-threaded.jsep.mjs': 'jsep-mjs',
  'ort-wasm-simd-threaded.jsep.wasm': 'jsep-wasm',
  'ort-wasm-simd-threaded.jspi.mjs': 'jspi-mjs',
  'ort-wasm-simd-threaded.jspi.wasm': 'jspi-wasm',
  'ort-wasm-simd-threaded.asyncify.mjs': 'asyncify-mjs',
  'ort-wasm-simd-threaded.asyncify.wasm': 'asyncify-wasm',
};

const manifestFor = (files) => Object.fromEntries(
  Object.entries(files).map(([name, body]) => [name, sha384(Buffer.from(body))]),
);

// Install a fetch/URL pair that records every request and serves `files`
// (plus manifest.json). `corrupt` names a file whose bytes no longer match the
// manifest; `missing` names one the server 404s.
function stubEnv({ files = FILES, manifest = manifestFor(FILES), corrupt = null, missing = null } = {}) {
  const requested = [];
  const minted = [];
  const revoked = [];
  const realFetch = globalThis.fetch;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  globalThis.fetch = async (url) => {
    requested.push(url);
    if (url === BASE + 'manifest.json') {
      return { ok: true, json: async () => manifest };
    }
    const name = url.slice(BASE.length);
    if (name === missing || !(name in files)) return { ok: false, status: 404 };
    const body = name === corrupt ? files[name] + '-tampered' : files[name];
    return { ok: true, blob: async () => new Blob([Buffer.from(body)]) };
  };
  URL.createObjectURL = (blob) => {
    const url = `blob:stub/${minted.length}`;
    minted.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url) => revoked.push(url);

  return {
    requested,
    minted,
    revoked,
    restore() {
      globalThis.fetch = realFetch;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    },
  };
}

let env = null;
afterEach(() => { env?.restore(); env = null; });

describe('selectOrtRuntimeAssets', () => {
  test('picks exactly the pinned jsep pair out of the full manifest', () => {
    const manifest = manifestFor(FILES);
    const got = selectOrtRuntimeAssets(manifest);
    assert.deepEqual(got, {
      mjs: { name: ORT_RUNTIME_ASSETS.mjs, expected: manifest[ORT_RUNTIME_ASSETS.mjs] },
      wasm: { name: ORT_RUNTIME_ASSETS.wasm, expected: manifest[ORT_RUNTIME_ASSETS.wasm] },
    });
  });

  test('null when either half of the pair is absent (nothing to pin)', () => {
    const full = manifestFor(FILES);
    const noWasm = { ...full };
    delete noWasm[ORT_RUNTIME_ASSETS.wasm];
    const noMjs = { ...full };
    delete noMjs[ORT_RUNTIME_ASSETS.mjs];
    assert.equal(selectOrtRuntimeAssets(noWasm), null);
    assert.equal(selectOrtRuntimeAssets(noMjs), null);
    assert.equal(selectOrtRuntimeAssets({}), null);
    assert.equal(selectOrtRuntimeAssets(null), null);
  });
});

describe('_verifiedOrtWasmPaths: fetches only the runtime pair it pins', () => {
  test('requests the manifest and the jsep pair, nothing else', async () => {
    env = stubEnv();
    const paths = await _verifiedOrtWasmPaths(BASE);

    // The regression guard: three requests, never the six unused variants.
    assert.deepEqual(env.requested.sort(), [
      BASE + 'manifest.json',
      BASE + ORT_RUNTIME_ASSETS.mjs,
      BASE + ORT_RUNTIME_ASSETS.wasm,
    ].sort());
    assert.equal(typeof paths, 'object');
    assert.deepEqual(Object.keys(paths).sort(), ['mjs', 'wasm']);
    // One object URL per pinned file, and both are handed to ORT: no blob is
    // minted for bytes nobody loads (those used to leak, never revoked).
    assert.equal(env.minted.length, 2);
    assert.deepEqual(new Set(env.minted.map((m) => m.url)), new Set([paths.mjs, paths.wasm]));
    assert.deepEqual(env.revoked, []);
  });

  test('a tampered pinned runtime still throws', async () => {
    env = stubEnv({ corrupt: ORT_RUNTIME_ASSETS.wasm });
    await assert.rejects(
      () => _verifiedOrtWasmPaths(BASE),
      /ORT integrity check failed for ort-wasm-simd-threaded\.jsep\.wasm/,
    );
  });

  test('a tampered UNUSED variant is not fetched, so it cannot fail the load', async () => {
    // Bytes ORT never loads are no longer verified: the mismatch is invisible
    // because the file is never requested. That is the point of pinning.
    env = stubEnv({ corrupt: 'ort-wasm-simd-threaded.asyncify.wasm' });
    const paths = await _verifiedOrtWasmPaths(BASE);
    assert.equal(typeof paths, 'object');
    assert.ok(!env.requested.includes(BASE + 'ort-wasm-simd-threaded.asyncify.wasm'));
  });

  test('manifest without the jsep pair falls back to the base path, fetching no assets', async () => {
    const stripped = manifestFor(FILES);
    delete stripped[ORT_RUNTIME_ASSETS.mjs];
    delete stripped[ORT_RUNTIME_ASSETS.wasm];
    env = stubEnv({ manifest: stripped });
    const paths = await _verifiedOrtWasmPaths(BASE);
    assert.equal(paths, BASE);
    assert.deepEqual(env.requested, [BASE + 'manifest.json']);
    assert.equal(env.minted.length, 0);
  });

  test('a 404 on one half of the pair falls back and revokes the other half', async () => {
    env = stubEnv({ missing: ORT_RUNTIME_ASSETS.wasm });
    const paths = await _verifiedOrtWasmPaths(BASE);
    assert.equal(paths, BASE);
    assert.equal(env.minted.length, 1);
    assert.deepEqual(env.revoked, [env.minted[0].url]);
  });

  test('an empty or unreachable manifest falls back without fetching assets', async () => {
    env = stubEnv({ manifest: {} });
    assert.equal(await _verifiedOrtWasmPaths(BASE), BASE);
    assert.deepEqual(env.requested, [BASE + 'manifest.json']);
    env.restore();

    env = stubEnv();
    globalThis.fetch = async (url) => {
      env.requested.push(url);
      return { ok: false, status: 404 };
    };
    assert.equal(await _verifiedOrtWasmPaths(BASE), BASE);
    assert.deepEqual(env.requested, [BASE + 'manifest.json']);
  });
});
