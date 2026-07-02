// Tier-3 E2E: the record / upload / phone controls appear as soon as a model
// LOAD HAS STARTED, not only once it finishes (Q2). This lets the user capture
// audio while the weights are still downloading; the audio is queued and
// transcribed automatically once the model is ready. In the idle state the
// controls stay hidden (only the Load Model button shows).
//
// (Previous behavior, inverted here: the controls used to stay hidden until the
// model reached 'modelReady'. That gate is now "a load has started".)
//
// We stall every model-weight fetch so loadModel() parks in 'loadingModel' and
// never reaches 'modelReady' - exactly the window the controls must now be
// usable in, and it needs no real weights.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';

test('record/upload/phone controls appear and stay usable while the model loads', async ({ page }) => {
  // Stall every model-weight fetch so loadModel() enters its loading state and
  // never reaches 'modelReady'. The handler intentionally never fulfils/aborts,
  // holding the request pending for the life of the test.
  await page.route(/huggingface\.co/, () => { /* keep the request pending forever */ });

  await page.goto('/');

  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });

  // Before loading starts, the controls are absent (status is 'idle'): only the
  // Load Model button is offered.
  await expect(page.locator('.controls')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="record_button"]')).toHaveCount(0);
  await expect(page.locator('[data-umami-event="upload_file_button"]')).toHaveCount(0);

  await loadBtn.click();

  // The load button disappears once status leaves 'idle' (and it would reappear
  // on 'failed'), so its absence proves we are parked in the loading state.
  await expect(loadBtn).toBeHidden({ timeout: 15000 });

  // The crux (new behavior): with the load underway but NOT finished, the
  // capture controls are on screen and usable.
  await expect(page.locator('.controls')).toHaveCount(1);

  const record = page.locator('[data-umami-event="record_button"]');
  const upload = page.locator('[data-umami-event="upload_file_button"]');
  await expect(record).toBeVisible();
  await expect(record).toBeEnabled();       // recording needs only the mic, not the model
  await expect(upload).toBeVisible();
  // The phone-mic button is present and usable too.
  await expect(page.getByRole('button', { name: /Phone Mic/i })).toBeEnabled();
});
