// Tier-3 E2E: the sidebar model picker (VITE_MODEL_REPO as a comma-separated
// list) and its ?model= link override.
//
// Model-free on purpose: this exercises repo SELECTION, which is settled
// entirely before a byte of weights is fetched, so the spec needs no ONNX files
// and runs in seconds. Loading a model here would only test hub.js again.
//
// The failure this guards against is silent. A picker that ignores ?model=, or
// one that writes a link-driven choice back over the visitor's own, still
// transcribes perfectly with a real model, so nothing in the UI, the console or
// the transcript reveals that the wrong model ran.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, readSetting } from './seed.mjs';

const BASE = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const ULTIMED = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

/** Boot the app with a two-repo instance config. */
async function configureTwoRepos(page) {
  await page.addInitScript(([base, ultimed]) => {
    window.__CONFIG__ = {
      // 'local' keeps the app off HuggingFace entirely: this spec never loads
      // weights, and an accidental network probe would only add flake.
      VITE_MODEL_SOURCE: 'local',
      VITE_MODEL_REPO: `${base},${ultimed}`,
    };
  }, [BASE, ULTIMED]);
}

/** Open the sidebar and reveal the group the picker lives in. */
async function openEngineSettings(page) {
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  const toggle = page.locator('.settings-group-toggle', { hasText: 'Model and performance' });
  await toggle.waitFor({ state: 'visible', timeout: 30 * 1000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return page.locator('select[data-umami-event="model_repo_select"]');
}

test('the picker offers every configured repo and defaults to the first', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/');

  const picker = await openEngineSettings(page);
  await expect(picker).toBeVisible();

  // Both repos offered, in the configured order, labelled short with the full
  // id kept on the option for hover.
  const options = picker.locator('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('value', BASE);
  await expect(options.nth(1)).toHaveAttribute('value', ULTIMED);
  await expect(options.nth(0)).toHaveText('optimized');
  await expect(options.nth(1)).toHaveText('UltiMed');
  await expect(options.nth(1)).toHaveAttribute('title', ULTIMED);

  // A visitor who has never chosen gets the first entry.
  await expect(picker).toHaveValue(BASE);
});

test('the picker is hidden when the instance offers a single repo', async ({ page }) => {
  // The historical single-id configuration must look exactly as it did: a
  // one-option control would be pure noise.
  await page.addInitScript((base) => {
    window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local', VITE_MODEL_REPO: base };
  }, BASE);
  await page.goto('/');

  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  const toggle = page.locator('.settings-group-toggle', { hasText: 'Model and performance' });
  await toggle.waitFor({ state: 'visible', timeout: 30 * 1000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();

  await expect(page.locator('select[data-umami-event="model_repo_select"]')).toHaveCount(0);
  // The full repo id is still shown, so the page never hides which model it runs.
  await expect(page.locator('.settings-sidebar')).toContainText(BASE);
});

test('a picked repo is remembered across reloads', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/');

  const picker = await openEngineSettings(page);
  await picker.selectOption(ULTIMED);
  await expect.poll(() => readSetting(page, 'modelRepo'), { timeout: 15000 }).toBe(ULTIMED);

  await page.reload();
  const picker2 = await openEngineSettings(page);
  await expect(picker2).toHaveValue(ULTIMED);
});

test('?model= overrides the saved choice for that visit, without saving it', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/');
  // A returning visitor who deliberately chose the default repo.
  await seedSettings(page, { modelRepo: BASE });
  expect(await readSetting(page, 'modelRepo')).toBe(BASE);

  // The link wins: this is the whole point of the param, otherwise a shared
  // link lands on whatever the recipient last used.
  await page.goto('/?model=ultimed');
  const picker = await openEngineSettings(page);
  await expect(picker).toHaveValue(ULTIMED);

  // ...but it must NOT be written back, or following a link once would silently
  // redefine this visitor's default forever. Poll so a late write would fail
  // the assertion rather than slip past it.
  await expect.poll(() => readSetting(page, 'modelRepo'), { timeout: 5000 }).toBe(BASE);

  // Their own choice is intact on an ordinary visit.
  await page.goto('/');
  const picker2 = await openEngineSettings(page);
  await expect(picker2).toHaveValue(BASE);
});

test('choosing in the sidebar after a ?model= visit saves the new choice', async ({ page }) => {
  // The URL guard suppresses persistence; picking by hand has to lift it, or
  // the visitor could never change their mind while on such a link.
  await configureTwoRepos(page);
  await page.goto('/');
  await seedSettings(page, { modelRepo: BASE });

  await page.goto('/?model=ultimed');
  const picker = await openEngineSettings(page);
  await expect(picker).toHaveValue(ULTIMED);
  expect(await readSetting(page, 'modelRepo')).toBe(BASE);

  // Switch back to the default by hand: that is the visitor's own decision and
  // must be saved, even though the URL put them on the other repo.
  await picker.selectOption(BASE);
  await expect.poll(() => readSetting(page, 'modelRepo'), { timeout: 15000 }).toBe(BASE);
});

test('an unknown or ambiguous ?model= is ignored, not guessed', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/');
  await seedSettings(page, { modelRepo: ULTIMED });

  // 'whisper' matches neither repo.
  await page.goto('/?model=whisper');
  const picker = await openEngineSettings(page);
  await expect(picker).toHaveValue(ULTIMED);

  // 'parakeet' matches BOTH equally, so there is no right answer and the saved
  // choice must stand rather than a coin flip being loaded.
  await page.goto('/?model=parakeet');
  const picker2 = await openEngineSettings(page);
  await expect(picker2).toHaveValue(ULTIMED);
});

test('a saved repo the operator has removed is discarded', async ({ page }) => {
  // Dropping a repo from VITE_MODEL_REPO has to actually take it out of
  // circulation, including for the people who had selected it.
  await configureTwoRepos(page);
  await page.goto('/');
  await seedSettings(page, { modelRepo: ULTIMED });

  await page.addInitScript((base) => {
    window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local', VITE_MODEL_REPO: base };
  }, BASE);
  await page.goto('/');

  // openEngineSettings expands the (collapsed) group the repo id lives in.
  await expect(await openEngineSettings(page)).toHaveCount(0);
  await expect(page.locator('.settings-sidebar')).toContainText(BASE);
  await expect(page.locator('.settings-sidebar')).not.toContainText(ULTIMED);
});
