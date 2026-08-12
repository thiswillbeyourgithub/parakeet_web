// Tier-1 unit test pinning the "return the READ-BACK blob, not the composite"
// rule in _streamAndCache (app/src/hub.js).
//
// Why this exists: the download path streams a file into IndexedDB segment
// records (partial-<key>-seg-N), then assembles the final Blob by composition
// (new Blob([...segments, ...tail])). Blob composition is by REFERENCE, so the
// composite only points at the segment blobs' renderer blob storage, whose
// paged data Chromium's full binary has been observed to lose under multi-GB
// blob traffic. Handing ORT an object URL made from that composite later died
// with net::ERR_BLOB_REFERENCED_BLOB_BROKEN (observed with the ~880 MB int8
// encoder via scripts/transcribe-browser.mjs), a failure that only shows up
// once the blob is actually fetched, long after the download "succeeded". Two
// hardenings are pinned here: segment records are persisted BY VALUE
// (ArrayBuffer, never Blob, so no IDB record can alias blob storage), and the
// caller is served the blob READ BACK from the cache record.
//
// The fix: after a successful cache write, re-read the record with
// getFileFromDb(cacheKey) and build the object URL from THAT blob, which is
// backed by the cache record's own storage (the exact blob a warm reload already
// serves). This test pins the identity: URL.createObjectURL must receive the
// object that came out of the DB, not the in-memory composite. It fails against
// the pre-fix code, which passed the composite.
//
// Node has no IndexedDB, so the test installs a minimal fake implementing only
// what app/src/idb.js uses (open with onupgradeneeded/onsuccess, and
// get/put/delete requests firing onsuccess/onerror). The fake mimics the one
// semantic that makes the identity assertion meaningful: put stores a CLONE of a
// Blob value (like real structured cloning), so the stored record is never the
// same object the caller wrote.
//
// Built with Claude Code.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalModelFile } from '../../app/src/hub.js';

// ---------------------------------------------------------------------------
// Minimal fake IndexedDB
// ---------------------------------------------------------------------------
// One module-level instance: openIdb memoises its DB promise per
// (dbName, storeName, version) for the lifetime of the process, so the fake has
// to outlive individual tests. reset() clears the backing store and the
// instrumentation between tests instead.

const fakeIdb = {
  data: new Map(),            // key -> stored value (blobs are clones)
  lastGetReturned: new Map(), // key -> the exact value the last get() handed back
  putValueTypes: new Map(),   // key -> constructor name of the value handed to put()
  failPuts: false,
  reset() {
    this.data.clear();
    this.lastGetReturned.clear();
    this.putValueTypes.clear();
    this.failPuts = false;
  },
};

// Fire a request callback on a later turn, so the caller has had time to assign
// its onsuccess/onerror handlers synchronously after the call returns.
function later(fn) { queueMicrotask(fn); }

function makeRequest() {
  return { onsuccess: null, onerror: null, result: undefined, error: null };
}

function makeStoreApi() {
  return {
    get(key) {
      const request = makeRequest();
      later(() => {
        request.result = fakeIdb.data.get(key);
        fakeIdb.lastGetReturned.set(key, request.result);
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    put(value, key) {
      const request = makeRequest();
      fakeIdb.putValueTypes.set(key, value && value.constructor ? value.constructor.name : typeof value);
      later(() => {
        if (fakeIdb.failPuts) {
          request.error = new Error('put failed');
          if (request.onerror) request.onerror();
          return;
        }
        // Real IDB structured-clones on write: the stored record is a different
        // object from the one the caller handed in. That difference is the whole
        // point of this test, so the fake reproduces it for Blob values.
        const stored = value instanceof Blob ? new Blob([value], { type: value.type }) : value;
        fakeIdb.data.set(key, stored);
        request.result = key;
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    delete(key) {
      const request = makeRequest();
      later(() => {
        fakeIdb.data.delete(key);
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    getAllKeys() {
      const request = makeRequest();
      later(() => {
        request.result = [...fakeIdb.data.keys()];
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    clear() {
      const request = makeRequest();
      later(() => {
        fakeIdb.data.clear();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

function makeFakeDb(version) {
  const storeNames = new Set();
  const storeApi = makeStoreApi();
  return {
    version,
    objectStoreNames: { contains: (name) => storeNames.has(name) },
    createObjectStore(name) { storeNames.add(name); return storeApi; },
    close() {},
    transaction(_names, _mode) { return { objectStore: () => storeApi }; },
  };
}

const fakeDbs = new Map(); // dbName -> fake db object

function fakeIndexedDBOpen(name, version = 1) {
  const request = makeRequest();
  later(() => {
    const isNew = !fakeDbs.has(name);
    if (isNew) fakeDbs.set(name, makeFakeDb(version));
    const db = fakeDbs.get(name);
    request.result = db;
    // A brand-new DB gets the upgrade callback first (that is where idb.js
    // creates the object store), then success.
    if (isNew && request.onupgradeneeded) request.onupgradeneeded({ target: { result: db } });
    if (request.onsuccess) request.onsuccess();
  });
  return request;
}

// ---------------------------------------------------------------------------
// Test payload + fetch stub (same house style as stream-to-memory.test.mjs)
// ---------------------------------------------------------------------------

function streamingResponse(payload, chunkSize) {
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= payload.length) { controller.close(); return; }
      const end = Math.min(offset + chunkSize, payload.length);
      controller.enqueue(payload.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-length': String(payload.length),
      'content-type': 'application/octet-stream',
    },
  });
}

// Deterministic, non-trivial bytes (cheap to generate at multi-MB sizes).
function makePayload(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// Larger than hub's 8 MB FLUSH_INTERVAL, so at least one segment record is
// written mid-download and the composite really is a by-reference assembly of a
// stored segment plus the in-memory tail (the exact shape that broke).
const PAYLOAD_SIZE = Math.round(8.5 * 1024 * 1024);
const CHUNK_SIZE = 512 * 1024;

const originalIndexedDB = globalThis.indexedDB;
const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalFetch = globalThis.fetch;

let createdUrls = []; // { arg, url } per URL.createObjectURL call
let urlCounter = 0;

beforeEach(() => {
  fakeIdb.reset();
  createdUrls = [];
  urlCounter = 0;
  globalThis.indexedDB = { open: fakeIndexedDBOpen };
  globalThis.URL.createObjectURL = (arg) => {
    const url = `blob:fake-${urlCounter++}`;
    createdUrls.push({ arg, url });
    return url;
  };
});

after(() => {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIndexedDB;
  if (originalCreateObjectURL === undefined) delete globalThis.URL.createObjectURL;
  else globalThis.URL.createObjectURL = originalCreateObjectURL;
  globalThis.fetch = originalFetch;
});

describe('_streamAndCache returns the cached blob read back from IndexedDB', () => {
  test('the object URL is built from the DB record, not the in-memory composite', async () => {
    const payload = makePayload(PAYLOAD_SIZE);
    globalThis.fetch = async () => streamingResponse(payload, CHUNK_SIZE);

    const got = await getLocalModelFile('/models', 'test/repo', 'enc.onnx');

    assert.equal(typeof got, 'string', 'the default (non-asBytes) path returns an object URL');
    assert.equal(got, 'blob:fake-0');
    assert.equal(createdUrls.length, 1, 'exactly one object URL must be minted per download');

    // The completed cache record: the only key that is neither partial state nor
    // the meta- sibling.
    const keys = [...fakeIdb.data.keys()];
    const cacheKeys = keys.filter(k => !k.includes('partial') && !k.startsWith('meta-'));
    assert.equal(cacheKeys.length, 1, `expected exactly one cache record, got ${JSON.stringify(keys)}`);
    const cacheKey = cacheKeys[0];

    // The by-value hardening: every segment record must have been persisted as
    // an ArrayBuffer, never a Blob (a Blob record can alias renderer blob
    // storage, whose paged data the full Chromium binary loses under pressure).
    const segTypes = [...fakeIdb.putValueTypes].filter(([k]) => k.includes('-seg-'));
    assert.ok(segTypes.length >= 1, 'at least one segment record must have been written mid-download');
    for (const [key, type] of segTypes) {
      assert.equal(type, 'ArrayBuffer',
        `segment record ${key} must be stored by value as an ArrayBuffer, got ${type}`);
    }

    const readBack = fakeIdb.lastGetReturned.get(cacheKey);
    assert.ok(readBack instanceof Blob, 'the fix must re-read the cache record after writing it');
    // The regression pin: pre-fix this was the composite blob, whose backing
    // segment records get deleted right after, leaving a broken blob reference.
    assert.strictEqual(
      createdUrls[0].arg,
      readBack,
      'URL.createObjectURL must receive the blob read back from IndexedDB, not the composite',
    );
    // And it must not be the record we stored either: the readback is what the
    // DB handed out, which is the object whose lifetime the record guarantees.
    assert.strictEqual(readBack, fakeIdb.data.get(cacheKey));

    // Content is unchanged by the swap: the readback holds the served bytes.
    assert.equal(readBack.size, payload.length);
    const bytes = await blobBytes(readBack);
    assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from(payload)), 0,
      'the cached blob must hold exactly the served bytes');

    // All partial/segment state is cleaned up: only the record and its meta sibling remain.
    assert.deepEqual(
      [...fakeIdb.data.keys()].sort(),
      [cacheKey, `meta-${cacheKey}`].sort(),
      'every partial-/segment record must be deleted after a successful cache write',
    );
  });

  test('a failing cache write falls back to the in-memory composite', async () => {
    const payload = makePayload(PAYLOAD_SIZE);
    globalThis.fetch = async () => streamingResponse(payload, CHUNK_SIZE);
    fakeIdb.failPuts = true;

    const got = await getLocalModelFile('/models', 'test/repo', 'enc.onnx');

    assert.equal(got, 'blob:fake-0', 'a cache failure must still yield a usable object URL');
    assert.equal(createdUrls.length, 1);
    const arg = createdUrls[0].arg;
    assert.ok(arg instanceof Blob, 'the fallback hands over the composite blob');
    assert.equal(arg.size, payload.length);
    const bytes = await blobBytes(arg);
    assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from(payload)), 0,
      'the fallback composite must still hold exactly the served bytes');

    // Nothing was cached (every put failed), so there is no cache record to read back.
    const cacheKeys = [...fakeIdb.data.keys()].filter(k => !k.includes('partial') && !k.startsWith('meta-'));
    assert.deepEqual(cacheKeys, []);
  });
});
