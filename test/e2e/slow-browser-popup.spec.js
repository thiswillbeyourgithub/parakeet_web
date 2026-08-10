// Tier-3 coverage for the slow-browser warning popup (App.jsx +
// lib/browserFamily.js): the WASM engine is ~9x slower outside the Chromium
// family (SpiderMonkey SIMD codegen, PERF_PLAN #5 2026-08-10), so non-Chromium
// visitors get a dismissable heads-up recommending Brave/Chrome/Edge.
//
// Three behaviours pinned:
// 1. Chromium NEVER shows it (a false positive would nag every normal user).
// 2. Firefox shows it, the dismiss button closes it, and the page stays
//    usable. Driven by a MANUALLY launched Playwright Firefox against the
//    same webServer (the configured project matrix is chromium-only; needs no
//    model weights, so it is cheap).
// 3. Dismissal is NOT remembered: a reload shows the popup again by design
//    (the slowness is real on every visit), so this spec fails if anyone
//    "helpfully" persists the dismissed state.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { firefox, devices } from 'playwright';

const MODAL = '[data-testid="slow-browser-modal"]';

test('chromium never shows the slow-browser popup', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  // The popup renders at mount when it renders at all, so after the app is
  // interactive a short settle is enough to prove absence.
  await page.waitForTimeout(1000);
  await expect(page.locator(MODAL)).toHaveCount(0);
});

test('firefox shows it, dismiss closes it, reload brings it back', async ({ baseURL }) => {
  const browser = await firefox.launch({ headless: true });
  try {
    // TRAP: inside a @playwright/test worker, browsers launched via the
    // `playwright` library inherit the active project's context options as
    // defaults, INCLUDING devices['Desktop Chrome'].userAgent, so a bare
    // newPage() here is a Firefox wearing a "Chrome/NNN" UA and the popup
    // (correctly) stays hidden. Pass the Desktop Firefox preset explicitly
    // so the page presents a genuine Firefox UA.
    const context = await browser.newContext({ ...devices['Desktop Firefox'] });
    const page = await context.newPage();
    await page.goto(baseURL);
    const modal = page.locator(MODAL);
    await modal.waitFor({ timeout: 30 * 1000 });
    // Dismiss via the button; the app stays usable underneath.
    await page.getByTestId('slow-browser-modal').getByRole('button').click();
    await expect(modal).toHaveCount(0);
    await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
    // Reload: the dismissal must NOT have been persisted.
    await page.reload();
    await modal.waitFor({ timeout: 30 * 1000 });
  } finally {
    await browser.close();
  }
});
