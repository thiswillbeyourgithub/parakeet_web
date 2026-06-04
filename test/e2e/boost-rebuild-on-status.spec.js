// Tier-3 regression E2E: the phrase-boost trie must rebuild once per real model
// change, NOT on every `status` transition. The boost rebuild effect used to
// depend on the raw `status` string, which also flips on recording start/stop,
// file transcribe, and each chunk-progress tick. On a large curated list each
// flip re-ran parseBoostPhrases + the trie rebuild and pushed fresh
// boost-warning arrays that forced the giant phrase-list textarea to reconcile,
// freezing the "My Computer" tab. The fix keys the effect on the loaded
// tokenizer's vocab signature instead, so unrelated status churn no longer
// rebuilds.
//
// This pins it end to end: with verbose logging on, "[Boost] rebuilding trie"
// is logged once per rebuild. We record the count once the model is ready, run
// a full transcription (which flips `status` through transcribing -> modelReady
// and would re-trigger the buggy effect when it lands back on modelReady), and
// assert the count did not grow. Reuses the WASM-int8 local-model setup of
// transcription.spec.js.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/sample.aac');

// Boot with verbose logging on and a Custom boost list present (a few phrases is
// enough to build a trie and emit the rebuild log; the bug is about *how often*
// it rebuilds, not list size).
const seed = (page) => seedSettings(page, {
  verboseLog: true,
  boostSource: '__custom__',
  boostPhrases: 'venlafaxine\nacetaminophen\nmetoprolol',
});

test('boost trie does not rebuild on transcribe status churn', async ({ page }) => {
  let boostRebuilds = 0;
  // This spec's whole signal (the rebuild log) is gated on the seeded
  // `verboseLog` + boost list actually being applied. If the app instead boots
  // on DEFAULTS (verbose off, empty list) the rebuild log never fires and the
  // test would time out at 0 with no clue why. Two boots-on-defaults paths can
  // strike: the settings-load watchdog timing out, and the version-mismatch
  // PURGE wiping the seed (the flake this guards). Watch for both so a
  // regression fails loudly here, not as a cryptic 6-minute timeout below.
  let settingsPurges = 0, settingsTimeouts = 0;
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'log' && text.includes('[Boost] rebuilding trie')) boostRebuilds += 1;
    if (text.includes('[App] Version mismatch')) settingsPurges += 1;
    if (text.includes('[App] Settings restore timed out')) settingsTimeouts += 1;
  });

  // First load creates the settings DB/store; seed it, then reload so the app
  // picks up local model source + wasm backend + the boost list.
  await page.goto('/');
  await seed(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // Model ready: the app renders a ✔ once weights are loaded and initialised.
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Precondition check: the seeded verbose + boost settings must have survived
  // the reload. A purge of the seeded data (or a watchdog timeout) boots on
  // defaults, which is the actual cause of the historic flake here; assert it
  // did NOT happen so the failure is self-explaining rather than a 0-rebuilds
  // timeout. The model still loads on defaults (its source is env-driven, not
  // an IndexedDB setting), so ✔ alone does not prove the seed took. The fresh
  // DB legitimately purges exactly once on the very first boot (seedSettings
  // waits for that to finish before writing); the reload must NOT purge again,
  // so a second purge means the seed was wiped.
  expect(settingsTimeouts, 'settings-load watchdog fired; seeded settings were not applied').toBe(0);
  expect(settingsPurges, 'seeded settings were purged on reload (version stamp missing/stale)').toBeLessThanOrEqual(1);

  // Let the post-model-ready rebuild (and its 300ms debounce) settle, then take
  // the baseline: this is the one legitimate rebuild (the vocab became known).
  await expect.poll(() => boostRebuilds, { timeout: 30 * 1000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1000);
  const afterReady = boostRebuilds;

  // Transcribe the fixture clip. Uploads transcribe immediately, so feeding the
  // file starts it; this churns `status` (transcribing... -> modelReady) which
  // is exactly what used to re-trigger the rebuild.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  // Give any (buggy) status-driven rebuild its debounce window to fire.
  await page.waitForTimeout(1000);
  expect(
    boostRebuilds,
    `boost trie rebuilt ${boostRebuilds - afterReady} extra time(s) on transcribe status churn (expected 0)`,
  ).toBe(afterReady);
});
