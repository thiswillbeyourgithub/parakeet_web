// Ask the browser to mark this origin's IndexedDB as persistent.
//
// The model weights (hundreds of MB to a few GB) are cached in IndexedDB by
// hub.js. Without a persistence grant the storage sits in the "best-effort"
// bucket, which Chromium is free to evict under disk pressure. When that
// happens the cache vanishes and the next visit re-downloads the whole model
// from scratch. Because a re-download often coincides with reopening the app
// after an update, this looks like "the version bump wiped my model" even
// though the version-mismatch purge (App.jsx) only touches the settings DB and
// never the model cache.
//
// persist() promotes the origin to the "persistent" bucket, which browsers
// only evict on explicit user action (clearing site data). Calling it is
// idempotent and a no-op once granted, so it is safe on every load.

/**
 * Request persistent storage for this origin.
 *
 * @param {Navigator} [nav] Navigator-like object (injectable for tests).
 *   Defaults to the global `navigator` when available.
 * @returns {Promise<boolean|null>} The resulting persisted state (true/false),
 *   or null when the Storage API is unavailable or the request threw.
 */
export async function requestPersistentStorage(
  nav = (typeof navigator !== 'undefined' ? navigator : undefined)
) {
  const storage = nav && nav.storage;
  if (!storage || typeof storage.persist !== 'function') return null;
  try {
    // Skip the request when already persistent: some browsers (Firefox) may
    // surface a permission prompt on persist(), and there is no reason to
    // re-prompt for a grant we already hold.
    if (typeof storage.persisted === 'function') {
      const already = await storage.persisted();
      if (already) return true;
    }
    return await storage.persist();
  } catch (e) {
    console.warn('[storage] persist() request failed:', e);
    return null;
  }
}
