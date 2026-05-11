/**
 * Tiny IndexedDB helper. Both the model cache (hub.js) and the UI
 * settings store (App.jsx) used to maintain their own near-identical
 * copies of this boilerplate; they now share this module.
 *
 * Each call to openIdb returns a memoised promise per (dbName, storeName)
 * so concurrent callers all wait on the same open() request.
 */

const dbPromises = new Map();

export function openIdb(dbName, storeName, version = 1) {
  const key = `${dbName}::${storeName}::${version}`;
  if (dbPromises.has(key)) return dbPromises.get(key);
  const p = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onerror = () => reject(request.error || new Error(`Error opening IndexedDB ${dbName}`));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
  });
  dbPromises.set(key, p);
  return p;
}

export async function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onerror = () => reject(request.error || new Error('Error reading from DB'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function idbPut(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);
    request.onerror = () => reject(request.error || new Error('Error writing to DB'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onerror = () => reject(request.error || new Error('Error deleting from DB'));
    request.onsuccess = () => resolve();
  });
}

export async function idbClear(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onerror = () => reject(request.error || new Error('Error clearing DB'));
    request.onsuccess = () => resolve();
  });
}

/**
 * Delete the entire DB file and forget any memoised open() promise so
 * the next openIdb() rebuilds fresh. objectStore.clear() only writes a
 * delete-marker into LevelDB / WebSQL backing stores - the actual SST
 * / log files survive until compaction, which means a forensics tool
 * (or even chrome://indexeddb-internals) can recover the cleared
 * values for an indeterminate window. deleteDatabase forces the
 * backing files to be dropped synchronously and is the only reliable
 * way to evict on-disk residue. The caller MUST first close all open
 * IDBDatabase handles to the same dbName; we close any memoised one
 * here.
 */
export async function idbDeleteDatabase(dbName) {
  // Close every memoised connection that targets this dbName so the
  // delete request doesn't get queued behind an open connection.
  for (const [key, p] of dbPromises.entries()) {
    if (key.startsWith(`${dbName}::`)) {
      try { (await p).close(); } catch (_) {}
      dbPromises.delete(key);
    }
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onerror = () => reject(req.error || new Error(`Error deleting IndexedDB ${dbName}`));
    req.onsuccess = () => resolve();
    req.onblocked = () => {
      // Another tab still holds the DB open. Resolve anyway so the caller
      // can continue with a reload; deleteDatabase will fire onsuccess
      // once that tab releases the handle.
      console.warn(`[idb] deleteDatabase(${dbName}) blocked by another tab; will complete when other tab closes the DB`);
      resolve();
    };
  });
}
