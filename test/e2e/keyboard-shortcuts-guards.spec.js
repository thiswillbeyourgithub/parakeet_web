// Tier-3 E2E: the global shortcut handler stays out of the way, and the help
// table it advertises matches what the handler actually implements.
//
// Three regressions this pins, all found while auditing the bindings:
//   1. The handler ignored modifiers, so with shortcuts enabled Ctrl+R (reload),
//      Ctrl+S (save), Ctrl+F (find) and Cmd+R were preventDefault()ed and
//      rerouted into record/settings actions.
//   2. Its "typing" guard only covered INPUT/TEXTAREA, so a focused <select>
//      lost its own type-ahead ('s' closed the settings panel instead).
//   3. The help table still advertised an 'L' shortcut for loading the model,
//      which was replaced by Space/Enter, and never listed 'P' (pause/resume).
//
// No model load is needed: every assertion is about the handler itself.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';

async function enableShortcuts(page) {
  await page.goto('/');
  await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible({ timeout: 15000 });
  await page.locator('.settings-toggle').click();
  const sidebar = page.locator('.settings-sidebar');
  await expect(sidebar).toBeVisible();
  await expandSettingsSection(page, 'General');
  const toggle = sidebar.getByLabel(/Enable keyboard shortcuts/i);
  await toggle.check();
  await expect(toggle).toBeChecked();
  return sidebar;
}

test('modifier chords are left to the browser', async ({ page }) => {
  const sidebar = await enableShortcuts(page);
  await sidebar.locator('.settings-sidebar-close').click();
  await expect(sidebar).toHaveCount(0);

  // Registered after the app's own window listener, so it observes whether the
  // app called preventDefault() on the chord.
  await page.evaluate(() => {
    window.__chords = [];
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        window.__chords.push({ key: e.key, prevented: e.defaultPrevented });
      }
    });
  });

  for (const chord of ['Control+r', 'Control+s', 'Control+f', 'Meta+r', 'Alt+s']) {
    await page.locator('body').press(chord);
  }
  await page.waitForTimeout(200);

  // None of them may be swallowed, and none may have toggled the panel open.
  const chords = await page.evaluate(() => window.__chords);
  const swallowed = chords.filter(c => c.prevented && c.key.length === 1);
  expect(swallowed, `browser chords hijacked: ${JSON.stringify(swallowed)}`).toEqual([]);
  await expect(sidebar).toHaveCount(0);
});

test('a focused select keeps its own keyboard behaviour', async ({ page }) => {
  const sidebar = await enableShortcuts(page);

  const select = sidebar.locator('select').first();
  await expect(select).toBeVisible();
  await select.focus();
  await select.press('s');
  await page.waitForTimeout(200);

  // 'S' toggles the settings panel; with a <select> focused it must not.
  await expect(sidebar).toBeVisible();
});

test('the advertised shortcut table matches the implemented bindings', async ({ page }) => {
  const sidebar = await enableShortcuts(page);
  await sidebar.getByRole('button', { name: /Show Keyboard Shortcuts/i }).click();

  const keys = await sidebar.locator('table tbody tr td:first-child').allInnerTexts();
  expect(new Set(keys.map(k => k.trim()))).toEqual(new Set([
    'S',
    'Space / Enter',
    'R / Space',
    'R / S / Space',
    'P',
    'F',
  ]));
});
