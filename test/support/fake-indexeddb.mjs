// Minimal fake IndexedDB for the tier-1 tests that exercise app/src/hub.js's
// caching paths under Node, which has no IndexedDB of its own.
//
// It implements only what app/src/idb.js actually uses: open() with
// onupgradeneeded/onsuccess, and a store with get/put/delete/getAllKeys/clear,
// every one of them firing its callback on a LATER turn so the caller has had
// time to assign its handlers synchronously after the call returns. Reaching
// for a full fake-indexeddb dependency would pull a package in to cover six
// methods, and would also hide the two behaviours these tests are built to
// observe: what type a value was stored AS, and whether the object handed back
// by get() is the same object that went in.
//
// One module-level instance, because openIdb memoises its DB promise per
// (dbName, storeName, version) for the lifetime of the process, so the fake has
// to outlive individual tests. Call fakeIdb.reset() in beforeEach to clear the
// backing store and the instrumentation between tests.
//
// Built with Claude Code.

export const fakeIdb = {
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
        // object from the one the caller handed in. Some callers test exactly
        // that difference, so the fake reproduces it for Blob values.
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

export function fakeIndexedDBOpen(name, version = 1) {
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

// The object to assign to globalThis.indexedDB.
export const fakeIndexedDB = { open: fakeIndexedDBOpen };
