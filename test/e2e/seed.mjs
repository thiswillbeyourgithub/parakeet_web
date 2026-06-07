// Shared settings-DB seeder for the tier-3 E2E specs. Writes the app's
// IndexedDB settings store directly so a spec can boot the app with a known
// configuration before any UI interaction. Centralised here so the model-loading
// specs don't each carry their own copy of the indexedDB plumbing (the seed
// block used to be duplicated verbatim across several specs).
//
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// The app stamps its package version into the settings DB on first boot and, on
// any later boot, PURGES every setting when the stored version does not match
// (App.jsx, the `storedVersion !== VERSION` branch). The canonical spec flow is
// `goto('/')` (first boot creates the DB) -> `seedSettings` -> `reload`. But the
// first boot's settings restore runs ASYNCHRONOUSLY and races this seeder: if
// the first boot reads the (still-absent) version before we write but runs its
// `clearAllSettings()` after, it wipes the freshly-seeded values, so the reload
// boots on DEFAULTS (e.g. verboseLog off, empty boost list) and the spec's
// premise silently breaks. Under the loaded full-suite run this surfaced as a
// flaky `boost-rebuild-on-status` failure (no `[Boost] rebuilding trie` ever
// logged because verbose was off and no phrases were loaded).
//
// We close the race by WAITING for the first boot to finish stamping `version`
// before we write: once the version key exists, the first boot is past its
// purge branch (a fresh DB always hits the mismatch path and saves the version
// there), so no concurrent `clearAllSettings()` can clobber the seed, and the
// reload reads a matching version and never purges. We also write a matching
// `version` ourselves so the reload's check is unconditionally satisfied.
const APP_VERSION = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../app/package.json'), 'utf-8'),
).version;

const SETTINGS_DB = 'parakeetweb-settings-db';
const SETTINGS_STORE = 'settings-store';
const SETTINGS_PREFIX = 'parakeetweb_';

// Seed the app's settings DB. Every spec gets the base config it needs to boot:
// load the int8 weights from the local /models route (serve.mjs) on the WASM
// backend, since headless Chromium has no WebGPU and the int8 encoder is the
// only one that fits the blob-fetch cap (see CLAUDE.md). `extra` extends or
// overrides that base with spec-specific keys, passed UNPREFIXED (the
// `parakeetweb_` prefix is applied here), e.g.
//   seedSettings(page, { verboseLog: true, chunkDuration: 5 }).
export async function seedSettings(page, extra = {}) {
  // Wait for the first boot to have stamped `version` (see the race note above).
  // Polled in-page; opening the DB read-only each tick is cheap for a short wait.
  await page.waitForFunction(
    ({ DB, STORE, PREFIX }) => new Promise((resolve) => {
      const req = indexedDB.open(DB);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(false); return; }
        const get = db.transaction([STORE], 'readonly').objectStore(STORE).get(PREFIX + 'version');
        get.onsuccess = () => { db.close(); resolve(get.result !== undefined); };
        get.onerror = () => { db.close(); resolve(false); };
      };
      req.onerror = () => resolve(false);
    }),
    { DB: SETTINGS_DB, STORE: SETTINGS_STORE, PREFIX: SETTINGS_PREFIX },
    { timeout: 30 * 1000 },
  );

  await page.evaluate(async ({ extra, version, DB, STORE, PREFIX }) => {
    const settings = { version, modelSource: 'local', backend: 'wasm', ...extra };
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
  }, { extra, version: APP_VERSION, DB: SETTINGS_DB, STORE: SETTINGS_STORE, PREFIX: SETTINGS_PREFIX });
}

// Expand a collapsible Settings group by clicking its header toggle, so a spec
// can reach controls that now live inside a (default-collapsed) section. The
// settings drawer must already be open. `name` is matched as a substring of the
// section title (e.g. 'Engine' for "Engine & performance"). Idempotent: a no-op
// when the section is already expanded (aria-expanded="true").
export async function expandSettingsSection(page, name) {
  const toggle = page.locator('.settings-group-toggle', { hasText: name });
  await toggle.waitFor({ state: 'visible', timeout: 30 * 1000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}
