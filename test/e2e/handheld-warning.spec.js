// Tier-3 E2E: the "this is made for a computer" warnings on phones/tablets.
//
// Two warnings, both gated on lib/deviceClass.js:
//   1. On load, a dismissable popup saying the app is designed for a computer
//      (it downloads hundreds of MB and runs the model on the device itself).
//   2. On "Phone Mic", a popup explaining the feature pairs a phone with a
//      COMPUTER that has no microphone, which is not what a phone user wants.
//
// The device is faked with Playwright's userAgent override, so no real phone
// and no model load are needed (test 2 only starts a load to reveal the
// button, it never waits for weights).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';

const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';

test.describe('on a desktop', () => {
  test.use({ userAgent: DESKTOP_UA });

  test('no handheld warning is shown', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="handheld-modal"]')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ userAgent: PHONE_UA });

  test('the app warns it is made for a computer, and the warning dismisses', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('[data-testid="handheld-modal"]');
    await expect(modal).toBeVisible({ timeout: 15000 });
    // It must land BEFORE any weights are fetched: the point is to warn ahead
    // of a several-hundred-megabyte download.
    await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible();

    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toHaveCount(0);
  });

  test('Phone Mic explains what it is for before pairing', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="handheld-modal"]')
      .getByRole('button', { name: 'OK', exact: true }).click();

    // The capture controls only exist once a load has been initiated. Start one
    // and move on: this spec never needs the weights to arrive.
    await page.locator('[data-umami-event="load_model_button"]').click();
    const phoneMic = page.getByRole('button', { name: /Phone Mic/i });
    await expect(phoneMic).toBeVisible({ timeout: 30000 });

    // First click: the warning, not the pairing dialog.
    await phoneMic.click();
    const warn = page.locator('[data-testid="remote-mic-handheld-modal"]');
    await expect(warn).toBeVisible();
    await expect(page.locator('.modal-panel--remote-mic')).toHaveCount(0);

    // Cancelling backs out without pairing, and the warning returns next time.
    await warn.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(warn).toHaveCount(0);
    await phoneMic.click();
    await expect(warn).toBeVisible();

    // Confirming pairs, and the acknowledgement holds for the rest of the load.
    await warn.getByRole('button', { name: /Pair anyway/i }).click();
    await expect(page.locator('.modal-panel--remote-mic')).toBeVisible({ timeout: 15000 });
  });
});
