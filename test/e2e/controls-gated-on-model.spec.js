// Tier-3 E2E: the record / upload / remote-mic controls must stay hidden until
// the model is fully loaded. Showing them mid-load let a user click Record (or
// pick a file) before the worker was ready, racing against an unfinished model.
// They are gated on `modelLoaded` (App.jsx, derived from tokenizerVocabSig) so
// they only mount once status has reached 'modelReady'.
//
// We never let the model finish loading: every huggingface.co request is held
// open (the route handler never resolves), so the app parks in 'loadingModel'.
// That is exactly the window the gate must cover, and it needs no real weights.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';

test('record/upload controls stay hidden while the model is still loading', async ({ page }) => {
  // Stall every model-weight fetch so loadModel() enters its loading state and
  // never reaches 'modelReady'. The handler intentionally never fulfils/aborts,
  // holding the request pending for the life of the test.
  await page.route(/huggingface\.co/, () => { /* keep the request pending forever */ });

  await page.goto('/');

  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });

  // Before loading starts, the controls are absent (status is 'idle').
  await expect(page.locator('.controls')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="record_button"]')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="upload_file_button"]')).toHaveCount(0);

  await loadBtn.click();

  // The load button disappears once status leaves 'idle' (and it would reappear
  // on 'failed'), so its absence proves we are parked in the loading state, not
  // idle and not failed.
  await expect(loadBtn).toBeHidden({ timeout: 15000 });

  // The crux: with loading underway but not finished, none of the three colored
  // controls may be on screen.
  await expect(page.locator('.controls')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="record_button"]')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="upload_file_button"]')).toHaveCount(0);
});
