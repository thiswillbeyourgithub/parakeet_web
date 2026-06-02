// Tier-3 E2E: startup settings restore must not hang the app when the settings
// IndexedDB never opens. This happens for real when another tab holds a
// versionchange that blocks our open request (the open just sits there, firing
// neither success nor error), which would otherwise leave the app wedged on an
// unconfigured state forever. The restore watchdog (App.jsx,
// SETTINGS_LOAD_TIMEOUT_MS) must give up, log it, and boot on defaults.
//
// We simulate the blocked DB by stubbing indexedDB.open for the settings DB so
// its open request never settles. Unlike transcription.spec.js this needs no
// model weights, so it is quick. Built with Claude Code.

import { test, expect } from '@playwright/test';

const SETTINGS_DB = 'parakeetweb-settings-db';

test('boots on defaults when the settings DB open hangs', async ({ page }) => {
  // Before any app code runs, make the settings DB open hang forever: return a
  // request object whose onsuccess/onerror/onupgradeneeded are never fired (a
  // plain object accepts the assignments openIdb makes but invokes nothing), so
  // the open() promise never settles. Other DBs open normally.
  await page.addInitScript((dbName) => {
    const realOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name, version) {
      if (name === dbName) return {};
      return realOpen(name, version);
    };
  }, SETTINGS_DB);

  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });

  await page.goto('/');

  // The app shell renders immediately; confirm it is interactive (the model-load
  // button is present and clickable) rather than stuck on a blank screen.
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });
  await expect(loadBtn).toBeEnabled();

  // The watchdog must fire and boot on defaults. Its warning is emitted in the
  // same branch that calls setSettingsLoaded(true), so seeing it is proof the
  // timeout path ran and the app booted instead of hanging on the dead DB.
  await expect
    .poll(() => warnings.some((w) => w.includes('Settings restore timed out')), {
      timeout: 20000,
      message: 'expected the settings-restore watchdog to fire and log a timeout',
    })
    .toBe(true);
});
