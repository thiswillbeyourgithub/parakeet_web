// Tier-3 E2E: the "what's new" popup (components/ChangelogModal.jsx) built
// from app/ui/changelog/<version>/{en,fr}.md.
//
// The popup is driven by the settings DB's stored `version`, so the spec
// boots once (which stamps the current version), rewinds that key to the
// previous release and reloads, exactly what a returning visitor's first boot
// after an upgrade sees. It checks the popup lists only the releases since the
// stored version, renders real content, never reappears after a dismissal,
// never greets a first visit, and that the About dialog opens the full
// history. No model weights needed.
//
// Written with the help of Claude Code.

import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, readSetting, writeSetting } from './seed.mjs';

const CHANGELOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/ui/changelog');
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const RELEASED = readdirSync(CHANGELOG_DIR).filter((v) => cmp(v, APP_VERSION) <= 0).sort((a, b) => cmp(b, a));
const PREVIOUS = RELEASED[1];

async function bootAndWaitForVersionStamp(page) {
  await page.goto('/');
  await expect.poll(() => readSetting(page, 'version'), { timeout: 30_000 }).toBe(APP_VERSION);
}

const panel = (page) => page.locator('.modal-panel--changelog');

test('first visit: no release-notes popup', async ({ page }) => {
  await bootAndWaitForVersionStamp(page);
  await page.locator('[data-umami-event="load_model_button"]').waitFor();
  await expect(panel(page)).toHaveCount(0);
});

test('first boot after an upgrade shows only the new release, once', async ({ page }) => {
  test.skip(!PREVIOUS, 'needs at least two released versions in app/ui/changelog');
  await bootAndWaitForVersionStamp(page);
  expect(await writeSetting(page, 'version', PREVIOUS)).toBe(true);
  await page.reload();

  await expect(panel(page).getByTestId('changelog-title')).toHaveText("What's new");
  const releases = panel(page).getByTestId('changelog-release');
  await expect(releases).toHaveCount(1);
  await expect(releases.first()).toHaveAttribute('data-version', APP_VERSION);
  // Real parsed content, not just a heading: at least one section heading.
  await expect(releases.first().locator('h3').first()).toBeVisible();

  // "Show all" swaps in the whole history, newest first.
  await panel(page).getByTestId('changelog-show-all').click();
  await expect(releases).toHaveCount(RELEASED.length);
  await expect(releases.nth(1)).toHaveAttribute('data-version', PREVIOUS);
  await panel(page).locator('.modal-close').click();
  await expect(panel(page)).toHaveCount(0);

  // The upgrade boot overwrote the stored version, so a reload is quiet.
  expect(await readSetting(page, 'version')).toBe(APP_VERSION);
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').waitFor();
  await expect(panel(page)).toHaveCount(0);
});

test('About dialog opens the full release history', async ({ page }) => {
  await bootAndWaitForVersionStamp(page);
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await page.getByTestId('about-release-notes').click();
  await expect(panel(page).getByTestId('changelog-title')).toHaveText('Release notes');
  await expect(panel(page).getByTestId('changelog-release')).toHaveCount(RELEASED.length);
  await expect(panel(page).getByTestId('changelog-show-all')).toHaveCount(0);
});
