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
