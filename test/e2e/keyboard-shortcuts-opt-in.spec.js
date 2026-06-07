// Tier-3 E2E: global keyboard shortcuts are opt-in and OFF by default.
//
// The single-letter bindings (R/S/F/Space/Enter) fire on any keypress outside a
// text field, which surprises users who expect plain typing/navigation. They are
// now gated on the `keyboardShortcutsEnabled` setting, which defaults to OFF.
//
// We exercise the cheapest observable shortcut: pressing 'S' toggles the settings
// sidebar. With shortcuts disabled it must do nothing; after the user opts in via
// the Settings toggle it must open the panel. No model load is needed.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';

test('keyboard shortcuts are off by default and can be enabled in settings', async ({ page }) => {
  await page.goto('/');

  // Wait for the app to be interactive (the load-model button is the first
  // control rendered once settings have hydrated).
  const loadBtn = page.locator('[data-umami-event="load_model_button"]');
  await expect(loadBtn).toBeVisible({ timeout: 15000 });

  const sidebar = page.locator('.settings-sidebar');

  // Default: shortcuts disabled. Pressing 'S' must NOT open the settings panel.
  await expect(sidebar).toHaveCount(0);
  await page.locator('body').press('s');
  // Give any (erroneous) handler a beat to run, then assert nothing opened.
  await page.waitForTimeout(200);
  await expect(sidebar).toHaveCount(0);

  // Open settings via the header gear button instead.
  await page.locator('.settings-toggle').click();
  await expect(sidebar).toBeVisible();

  // The keyboard-shortcuts toggle lives in the (collapsed) General section.
  await expandSettingsSection(page, 'General');

  // Enable the opt-in toggle.
  const enableToggle = sidebar.getByLabel(/Enable keyboard shortcuts/i);
  await enableToggle.check();
  await expect(enableToggle).toBeChecked();

  // Close the panel with its × button (clicking, not the keyboard).
  await sidebar.locator('.settings-sidebar-close').click();
  await expect(sidebar).toHaveCount(0);

  // Now the 'S' shortcut is live: pressing it reopens settings.
  await page.locator('body').press('s');
  await expect(sidebar).toBeVisible({ timeout: 5000 });
});
