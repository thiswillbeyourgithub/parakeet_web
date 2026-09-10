// Regression E2E: the server-prebuilt boost encoding must be fetched, parsed and
// packed OFF the main thread.
//
// On a real deployment the artifact next to a curated list is large: the French
// clinical lexicon prebuilds to ~37 MB of JSON holding ~478k encoded surface
// forms. Doing the JSON.parse + packEncoded inline in applyBoostSource froze the
// main thread for 2.7 s on a 6x-throttled CPU (measured, `?mode=med` cold boot),
// which is precisely page load for a `?mode=` link: the visitor's first click,
// on the settings sidebar, went nowhere. The work now happens inside
// phraseBoost.worker.js.
//
// The assertion does not time anything (a small fixture would not stall either
// way, so a timing bound here would prove nothing). It pins the mechanism: a
// dedicated worker keeps its OWN performance timeline, so a resource it fetched
// never appears in the window's. The list text, still fetched by the page, must
// be there; its prebuilt sibling must not, while still being requested by
// somebody. Reverting the fix flips both halves.
//
// No model weights are needed, so this runs anywhere the fixtures are served.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

test('the prebuilt boost encoding is fetched by the worker, not the page', async ({ page }) => {
  // Every request the browser makes, whatever context issued it.
  const requested = [];
  page.on('request', (r) => {
    if (r.url().includes('/boost-phrases/')) requested.push(new URL(r.url()).pathname);
  });

  await page.goto('/');
  await seedSettings(page, { verboseLog: true, boostSource: 'clinical-cjk.txt' });
  await page.reload();

  // The one-shot boost-init effect loads the curated list on boot. Wait for the
  // prebuilt to have been asked for at all before deciding who asked for it.
  await expect
    .poll(() => requested.includes('/boost-phrases/clinical-cjk.json'), { timeout: 30 * 1000 })
    .toBe(true);

  const mainThread = await page.evaluate(() => performance
    .getEntriesByType('resource')
    .map((e) => new URL(e.name).pathname)
    .filter((p) => p.includes('/boost-phrases/')));

  // The list text is read by the page itself (it goes straight into app state).
  expect(mainThread).toContain('/boost-phrases/clinical-cjk.txt');
  // The multi-megabyte encoding is not: the worker fetched and parsed it.
  expect(mainThread, `main-thread resources: ${mainThread.join(', ')}`)
    .not.toContain('/boost-phrases/clinical-cjk.json');

  // And it was actually used: the prebuilt's own `skipped` list is what puts the
  // untokenizable-terms warning on screen before any model exists, so a worker
  // that fetched the bytes and dropped them would not get this far.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Phrase boosting');
  await expect(page.getByText('1 term(s) skipped')).toBeVisible({ timeout: 15 * 1000 });
});
