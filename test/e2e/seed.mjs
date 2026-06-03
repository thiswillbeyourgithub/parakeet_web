// Shared settings-DB seeder for the tier-3 E2E specs. Writes the app's
// IndexedDB settings store directly so a spec can boot the app with a known
// configuration before any UI interaction. Centralised here so the model-loading
// specs don't each carry their own copy of the indexedDB plumbing (the seed
// block used to be duplicated verbatim across several specs).
//
// Built with Claude Code.

// Seed the app's settings DB. Every spec gets the base config it needs to boot:
// load the int8 weights from the local /models route (serve.mjs) on the WASM
// backend, since headless Chromium has no WebGPU and the int8 encoder is the
// only one that fits the blob-fetch cap (see CLAUDE.md). `extra` extends or
// overrides that base with spec-specific keys, passed UNPREFIXED (the
// `parakeetweb_` prefix is applied here), e.g.
//   seedSettings(page, { verboseLog: true, chunkDuration: 5 }).
export async function seedSettings(page, extra = {}) {
  await page.evaluate(async (extra) => {
    const DB = 'parakeetweb-settings-db', STORE = 'settings-store', PREFIX = 'parakeetweb_';
    const settings = { modelSource: 'local', backend: 'wasm', ...extra };
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction([STORE], 'readwrite');
      const os = tx.objectStore(STORE);
      for (const [k, v] of Object.entries(settings)) os.put(v, PREFIX + k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, extra);
}
