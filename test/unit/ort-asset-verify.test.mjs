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
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ORT_RUNTIME_ASSETS,
  ORT_RUNTIME_ASSETS_JSPI,
  ORT_VARIANTS,
  resolveOrtVariant,
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

describe('ORT runtime variants', () => {
  test('the jspi variant pins its OWN runtime pair, not the jsep one', () => {
    // A different bundle entry references different runtime files. Pinning the
    // jsep pair while loading the jspi bundle would verify bytes ORT never
    // executes and leave the bytes it does execute unchecked, which is worse
    // than not pinning at all because the log would claim it was verified.
    const manifest = manifestFor(FILES);
    const got = selectOrtRuntimeAssets(manifest, ORT_RUNTIME_ASSETS_JSPI);
    assert.deepEqual(got, {
      mjs: { name: 'ort-wasm-simd-threaded.jspi.mjs', expected: manifest['ort-wasm-simd-threaded.jspi.mjs'] },
      wasm: { name: 'ort-wasm-simd-threaded.jspi.wasm', expected: manifest['ort-wasm-simd-threaded.jspi.wasm'] },
    });
    // And the two variants really are different files.
    assert.notEqual(ORT_RUNTIME_ASSETS.mjs, ORT_RUNTIME_ASSETS_JSPI.mjs);
    assert.notEqual(ORT_RUNTIME_ASSETS.wasm, ORT_RUNTIME_ASSETS_JSPI.wasm);
  });

  test('every declared variant carries an asset pair and an importer', () => {
    for (const [name, v] of Object.entries(ORT_VARIANTS)) {
      assert.equal(typeof v.importer, 'function', `${name} importer`);
      assert.ok(v.assets?.mjs && v.assets?.wasm, `${name} assets`);
      // Every pinned name must exist in a real build, which is what the
      // vendored manifest set stands in for here.
      assert.ok(v.assets.mjs in FILES, `${name} mjs is a vendored file`);
      assert.ok(v.assets.wasm in FILES, `${name} wasm is a vendored file`);
    }
  });

  test('resolveOrtVariant: jspi is the default, wherever the browser can run it', () => {
    // The default (no request) takes jspi on a browser that implements JSPI.
    assert.deepEqual(resolveOrtVariant(undefined, true), { variant: 'jspi', downgraded: false });
    assert.deepEqual(resolveOrtVariant('jspi', true), { variant: 'jspi', downgraded: false });
  });

  test('resolveOrtVariant: no JSPI in the browser falls back, silently by default', () => {
    // Firefox and Safari implement no JSPI at all, so this is the majority
    // path for them, not an error: the default must not warn every visitor.
    assert.deepEqual(resolveOrtVariant(undefined, false), { variant: 'jsep', downgraded: false });
    // An EXPLICIT request that cannot be honoured is different: the caller has
    // to be able to say once that it was refused.
    assert.deepEqual(resolveOrtVariant('jspi', false), { variant: 'jsep', downgraded: true });
  });

  test('resolveOrtVariant: ?ortep=jsep is the escape hatch and always wins', () => {
    // Including on a browser that could perfectly well run jspi: that is the
    // entire point of an escape hatch.
    assert.deepEqual(resolveOrtVariant('jsep', true), { variant: 'jsep', downgraded: false });
    assert.deepEqual(resolveOrtVariant('jsep', false), { variant: 'jsep', downgraded: false });
  });

  test('resolveOrtVariant: an unrecognised value takes the default, not jsep', () => {
    // A typo or a stale link must not silently pin the old runtime forever;
    // only the exact string 'jsep' opts out.
    for (const req of [null, 'webnn', '', 'JSEP', 'jsepp']) {
      assert.deepEqual(resolveOrtVariant(req, true), { variant: 'jspi', downgraded: false }, String(req));
      assert.deepEqual(resolveOrtVariant(req, false), { variant: 'jsep', downgraded: false }, String(req));
    }
  });
});

describe('_verifiedOrtWasmPaths: fetches only the runtime pair it pins', () => {
  test('a jspi load fetches the jspi pair and nothing else', async () => {
    env = stubEnv();
    const paths = await _verifiedOrtWasmPaths(BASE, ORT_RUNTIME_ASSETS_JSPI);
    assert.deepEqual(env.requested.sort(), [
      BASE + 'manifest.json',
      BASE + ORT_RUNTIME_ASSETS_JSPI.mjs,
      BASE + ORT_RUNTIME_ASSETS_JSPI.wasm,
    ].sort());
    assert.deepEqual(Object.keys(paths).sort(), ['mjs', 'wasm']);
    assert.equal(env.minted.length, 2);
  });

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

// The single-ORT-instance invariant.
//
// ORT pins one WASM runtime per JS context, and only the instance backend.js
// loads gets the integrity-verified blob wasmPaths. A module that imports
// 'onnxruntime-web' on its own therefore gets a SECOND, unconfigured instance
// the moment the two specifiers resolve to different variant entry points: it
// tries to fetch its runtime from wherever the bundle sits, receives the SPA
// fallback HTML, and fails with "no available backend found".
//
// This is not hypothetical. speakerEmbedding.js did exactly that, and it went
// unnoticed because on the shipped jsep default both imports resolve to the
// same instance. Forcing the main thread onto the jspi runtime (2026-09-07)
// broke speaker embedding while diarization kept producing turns, so voice
// matching failed SILENTLY, with a green transcript.
//
// A behavioural test cannot catch this: under the shipped default the bug is
// invisible, and reproducing it needs a whole rebuild on another variant. So
// the invariant is asserted where it actually lives, in the import graph.
describe('ORT is imported in exactly one place', () => {
  const SRC_ROOTS = ['app/src', 'app/ui/src'];
  const OWNER = 'app/src/backend.js';
  // Matches a static or dynamic import of onnxruntime-web or any subpath of it.
  const ORT_IMPORT = /(?:^|[^\w])(?:import|from)\s*\(?\s*['"]onnxruntime-web(?:\/[\w./-]+)?['"]/;

  function sourceFiles(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) sourceFiles(p, out);
      else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test('only backend.js imports onnxruntime-web; everything else goes through loadOrtModule', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const offenders = [];
    for (const dir of SRC_ROOTS) {
      for (const file of sourceFiles(join(root, dir))) {
        const rel = relative(root, file);
        if (rel === OWNER) continue;
        // Strip line comments: the ban is on real imports, not prose about them.
        const code = readFileSync(file, 'utf8')
          .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
        if (ORT_IMPORT.test(code)) offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, [],
      `these modules import ONNX Runtime directly instead of backend.js's loadOrtModule(), `
      + `which gives them a second unconfigured ORT instance as soon as the runtime variant moves: `
      + offenders.join(', '));
  });

  test('backend.js does own the imports, so the rule above is not vacuous', () => {
    const owner = fileURLToPath(new URL('../../app/src/backend.js', import.meta.url));
    const code = readFileSync(owner, 'utf8');
    assert.ok(ORT_IMPORT.test(code), 'backend.js no longer imports ORT: the guard is testing nothing');
    assert.ok(/export async function loadOrtModule/.test(code),
      'loadOrtModule is what the other modules are pointed at; it must exist');
  });
});

// The one-runtime-per-page invariant, guarded at the source level.
//
// ORT chooses its runtime once per JS CONTEXT, and this app has several: the
// main thread, the two encode-pool workers, the decode worker and the two
// throwaway probe workers. So a runtime choice is only real if it reaches all
// of them. Wiring only the main thread produced a page running THREE jsep
// contexts and TWO jspi ones at once, which is not a switch and not an escape
// hatch, and it reads as fine if you look at a single log line.
//
// Nothing behavioural catches this. The variant only diverges between contexts
// when someone forgets a worker, and the symptom (the probe timing a runtime
// the app will not use; ?ortep=jsep leaving the encode pool, which does the
// encoding, on the other engine) produces correct transcripts either way. The
// e2e tier cannot help either: it is minutes per spec and, on a busy machine,
// its failures are model-download stalls rather than anything about ORT.
//
// So this is a tripwire, not a proof: a new worker that builds an ORT session
// without carrying ortVariant fails here, in tier-1, in milliseconds.
describe('the ORT runtime variant reaches every JS context', () => {
  const WORKER_DIR = 'app/ui/src/lib';
  // A worker builds an ORT session if it calls initOrt or one of the
  // ParakeetModel *FromUrls constructors (which call it for you).
  const BUILDS_SESSION = /\binitOrt\s*\(|FromUrls\s*\(/;

  function workerFiles() {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const dir = join(root, WORKER_DIR);
    return readdirSync(dir)
      .filter((n) => n.endsWith('.worker.js'))
      .map((n) => ({ name: `${WORKER_DIR}/${n}`, code: readFileSync(join(dir, n), 'utf8') }));
  }

  test('every worker that builds an ORT session forwards ortVariant', () => {
    const offenders = workerFiles()
      .filter((f) => BUILDS_SESSION.test(f.code) && !/\bortVariant\b/.test(f.code))
      .map((f) => f.name);
    assert.deepEqual(offenders, [],
      'these workers build an ORT session without carrying the runtime variant, so they will '
      + 'silently resolve their own and the page ends up running two different ORT runtimes: '
      + offenders.join(', '));
  });

  test('the guard is not vacuous: some worker really does build a session', () => {
    const builders = workerFiles().filter((f) => BUILDS_SESSION.test(f.code));
    assert.ok(builders.length >= 2,
      `expected several ORT-session workers, found ${builders.length}: the detector above has `
      + 'probably stopped matching and the test is passing on an empty set');
  });

  test('App.jsx hands the variant to the workers it starts', () => {
    // The other half of the same wiring: a worker can only forward a variant
    // it was sent. Existence rather than a count, so refactoring the payloads
    // into a helper does not fail this spuriously.
    const app = readFileSync(fileURLToPath(new URL('../../app/ui/src/App.jsx', import.meta.url)), 'utf8');
    assert.ok(/ortVariant:\s*ORT_VARIANT/.test(app),
      'App.jsx no longer passes ORT_VARIANT into any worker init payload');
  });
});
