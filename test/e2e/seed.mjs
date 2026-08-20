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
// We first WAIT for the first boot to finish stamping `version`: once the
// version key exists, the first boot is past its purge branch (a fresh DB
// always hits the mismatch path and saves the version there), so no concurrent
// `clearAllSettings()` can clobber the seed, and the reload reads a matching
// version and never purges. We also write a matching `version` ourselves so the
// reload's check is unconditionally satisfied.
//
// That version gate alone is NOT sufficient, though. `saveSetting('version')`
// runs BEFORE `setSettingsLoaded(true)`, and every `usePersistedSetting` effect
// writes its CURRENT (default) value the moment `settingsLoaded` flips. So the
// version key appears, we write the seed, and the first boot's default-persist
// storm then overwrites it key by key. Observed directly: a seeded
// `wasmEncoderQuant: 'fp32'` read back as `int8` right after the reload, so the
// spec silently ran on defaults (it loaded int8 weights and never reached the
// unsatisfiable-quant guard it was written to assert). Under the loaded
// full-suite run this surfaced as an intermittent
// transcription-fp32-wasm-no-downgrade failure that passed in isolation.
//
// So after the version gate we write the seed and HOLD it: re-write and re-read
// until the values stay put across several consecutive checks, which outlasts
// the one-shot default-persist storm. This is also self-healing if a pending
// `deleteDatabase` (logged as "blocked by another tab") lands late and drops
// the store.
// Exported because a spec that seeds a stored perf-probe verdict has to stamp
// the SAME version into it: verdictStillValid() rejects a verdict from another
// app version, and a rejected verdict silently re-runs the probe.
export const APP_VERSION = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../app/package.json'), 'utf-8'),
).version;

const SETTINGS_DB = 'parakeetweb-settings-db';
const SETTINGS_STORE = 'settings-store';
const SETTINGS_PREFIX = 'parakeetweb_';

// A key written by a plain `usePersistedSetting` (App.jsx), i.e. one of the
// values the first boot re-persists once `settingsLoaded` flips. Used purely as
// evidence that the default-persist storm has begun. If App.jsx ever stops
// persisting this key the wait below times out loudly, which is the intended
// failure mode: a seeder that silently stops synchronising is what caused the
// bug this guards against.
const STORM_SENTINEL = 'wasmEncoderQuant';

// Seed the app's settings DB. Every spec gets the base config it needs to boot:
// load the int8 weights from the local /models route (serve.mjs) on the WASM
// backend, since headless Chromium has no WebGPU and the int8 encoder is the
// only one that fits the blob-fetch cap (see CLAUDE.md). `extra` extends or
// overrides that base with spec-specific keys, passed UNPREFIXED (the
// `parakeetweb_` prefix is applied here), e.g.
//   seedSettings(page, { verboseLog: true, chunkDuration: 5 }).
export async function seedSettings(page, extra = {}) {
  // Wait for the first boot to have stamped `version` AND to have run its
  // default-persist storm (see the race note above). `version` alone is written
  // BEFORE `setSettingsLoaded(true)`, so it only proves the purge branch is
  // done; STORM_SENTINEL is a plain `usePersistedSetting` key, so its presence
  // proves the storm's effects have started flushing. They all flush in the same
  // effect pass, so once one lands the rest are immediate, and the hold loop
  // below absorbs the remainder. Polled in-page; opening the DB read-only each
  // tick is cheap for a short wait.
  await page.waitForFunction(
    async ({ DB, STORE, PREFIX, SENTINEL }) => {
      // Existence gate: a bare indexedDB.open(name) CREATES a missing DB as an
      // empty version-1 shell with no store. This poll can land exactly in the
      // first boot's purge window (deleteDatabase just completed, store not yet
      // recreated), and the shell it left behind then never fires
      // onupgradeneeded for the app's versioned open again: every transaction
      // throws NotFoundError and the whole harness run dies (seen live from
      // scripts/transcribe-browser.mjs, which seeds right after goto). So only
      // open once the DB is listed. The open stays versionLESS on purpose: the
      // app's openIdb self-heal can bump the DB past version 1, and a stale
      // open(DB, 1) would then reject with VersionError forever.
      const listed = await indexedDB.databases().catch(() => null);
      if (!listed || !listed.some((d) => d.name === DB)) return false;
      return new Promise((resolve) => {
        const req = indexedDB.open(DB);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(false); return; }
          const tx = db.transaction([STORE], 'readonly');
          const os = tx.objectStore(STORE);
          const version = os.get(PREFIX + 'version');
          const sentinel = os.get(PREFIX + SENTINEL);
          tx.oncomplete = () => {
            db.close();
            resolve(version.result !== undefined && sentinel.result !== undefined);
          };
          tx.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      });
    },
    {
      DB: SETTINGS_DB,
      STORE: SETTINGS_STORE,
      PREFIX: SETTINGS_PREFIX,
      SENTINEL: STORM_SENTINEL,
    },
    { polling: 100, timeout: 30 * 1000 },
  );

  // Write the seed, then keep re-writing until a read-back confirms it survived
  // STABLE_CHECKS consecutive polls (see the default-persist-storm note above).
  await page.waitForFunction(
    async ({ extra, version, DB, STORE, PREFIX, STABLE_CHECKS }) => {
      const settings = { version, modelSource: 'local', backend: 'wasm', ...extra };
      // VersionLESS open: the app's openIdb self-heal can bump the DB past
      // version 1, and an open(DB, 1) against that rejects with VersionError.
      // The upgrade handler only fires if this open itself created the DB
      // (a purge racing us), in which case creating the store right here is
      // the correct recovery. Any residual store-less shell makes the
      // transaction below throw; return false so the poll retries instead of
      // rejecting the whole seed (that reject was a live harness crash).
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      try {
        if (!db.objectStoreNames.contains(STORE)) return false;
        await new Promise((res, rej) => {
          const tx = db.transaction([STORE], 'readwrite');
          const os = tx.objectStore(STORE);
          for (const [k, v] of Object.entries(settings)) os.put(v, PREFIX + k);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
        const got = await new Promise((res, rej) => {
          const tx = db.transaction([STORE], 'readonly');
          const os = tx.objectStore(STORE);
          const out = {};
          for (const k of Object.keys(settings)) {
            const get = os.get(PREFIX + k);
            get.onsuccess = () => { out[k] = get.result; };
          }
          tx.oncomplete = () => res(out);
          tx.onerror = () => rej(tx.error);
        });
        const held = Object.entries(settings)
          .every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
        window.__seedStableCount = held ? (window.__seedStableCount || 0) + 1 : 0;
        return window.__seedStableCount >= STABLE_CHECKS;
      } finally {
        db.close();
      }
    },
    {
      extra,
      version: APP_VERSION,
      DB: SETTINGS_DB,
      STORE: SETTINGS_STORE,
      PREFIX: SETTINGS_PREFIX,
      STABLE_CHECKS: 3,
    },
    { polling: 150, timeout: 30 * 1000 },
  );
}

// Read one (unprefixed) key back from the app's settings DB, so a spec can
// deterministically wait for a UI edit's async IDB write instead of sleeping.
// Shared here because several specs need it (it used to be copied per spec).
export function readSetting(page, key) {
  return page.evaluate(({ DB, STORE, PREFIX, key }) => new Promise((resolve) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      // A reset/purge can leave a freshly re-created DB without the store;
      // an unguarded transaction() would throw inside the page.
      if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(undefined); return; }
      const get = db.transaction([STORE], 'readonly').objectStore(STORE).get(`${PREFIX}${key}`);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); resolve(undefined); };
    };
    req.onerror = () => resolve(undefined);
  }), { DB: SETTINGS_DB, STORE: SETTINGS_STORE, PREFIX: SETTINGS_PREFIX, key });
}

// Delete one (unprefixed) key from the app's settings DB. Needed to simulate a
// LEGACY profile: the app's default-persist storm writes every known key on
// first boot, so a key the current version persists can only be made absent
// (as it would be in a pre-feature profile) by removing it after seeding.
export function deleteSetting(page, key) {
  return page.evaluate(({ DB, STORE, PREFIX, key }) => new Promise((resolve) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      const del = db.transaction([STORE], 'readwrite').objectStore(STORE).delete(`${PREFIX}${key}`);
      del.onsuccess = () => { db.close(); resolve(true); };
      del.onerror = () => { db.close(); resolve(false); };
    };
    req.onerror = () => resolve(false);
  }), { DB: SETTINGS_DB, STORE: SETTINGS_STORE, PREFIX: SETTINGS_PREFIX, key });
}

// Expand a collapsible Settings group by clicking its header toggle, so a spec
// can reach controls that now live inside a (default-collapsed) section. The
// settings drawer must already be open. `name` is matched as a substring of the
// section title (e.g. 'Model and performance'). Idempotent: a no-op
// when the section is already expanded (aria-expanded="true").
export async function expandSettingsSection(page, name) {
  const toggle = page.locator('.settings-group-toggle', { hasText: name });
  await toggle.waitFor({ state: 'visible', timeout: 30 * 1000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}
