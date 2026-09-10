// Tier-3 E2E: the French medical dictation preset, reachable two ways that must
// configure the same station: a `?mode=<alias>` link and the sidebar's
// "Mode Dictée Médical" button (app/ui/src/lib/medMode.js).
//
// Model-free on purpose: the preset is settled entirely before a byte of weights
// is fetched, so the spec needs no ONNX files and runs in seconds. Loading a
// model here would only re-test hub.js.
//
// The failure this guards against is silent. A preset that applies six of its
// seven settings still transcribes perfectly: the visitor just gets the generic
// model, or the 60 s window, or no lexicon, and neither the UI, the console nor
// the transcript ever says which. So each value is asserted individually, both
// in the UI and (for the ones with no visible control in a headless build) in
// the settings DB the preset is supposed to have written.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readSetting } from './seed.mjs';

const BASE = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const ULTIMED = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

// The list the preset selects, served from test/e2e/fixtures/boost-phrases/.
const MED_LIST = 'french_medical.txt';

/**
 * Boot the app as a two-repo instance, which is what makes the preset's
 * "ultimed" model query resolvable. VITE_MODEL_SOURCE=local keeps the spec off
 * HuggingFace entirely, so an accidental network probe cannot add flake.
 */
async function configureTwoRepos(page) {
  await page.addInitScript(([base, ultimed]) => {
    window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local', VITE_MODEL_REPO: `${base},${ultimed}` };
  }, [BASE, ULTIMED]);
}

const openSidebar = async (page) => {
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
};

/**
 * Expand a collapsible settings group whose title matches `titleRe`. A regex
 * rather than seed.mjs's substring helper because the preset switches the UI to
 * French halfway through this spec, so the very same section is reached under an
 * English title before it and a French one after.
 */
async function expandSection(page, titleRe) {
  const toggle = page.locator('.settings-group-toggle', { hasText: titleRe });
  await toggle.waitFor({ state: 'visible', timeout: 30 * 1000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

const ENGINE_SECTION = /Model and performance|Mod\u00e8le et performance/;
const BOOSTING_SECTION = /Phrase boosting|Renforcement de phrases/;

const modelPicker = (page) => page.locator('select[data-umami-event="model_repo_select"]');
const medModeButton = (page) => page.locator('button[data-umami-event="med_mode_button"]');
// The boost source <select> is the one carrying the Custom sentinel option.
const boostSelect = (page) =>
  page.locator('select', { has: page.locator('option[value="__custom__"]') });

/**
 * Assert the full preset landed, both on screen and on disk.
 *
 * The display mode is checked in the settings DB rather than in its <select>:
 * the "dictation" option only renders when the operator serves dictation regex
 * rules, and serve.mjs (like a bare deployment) serves none. The setting is
 * still what drives the view once rules exist, so that is the thing to pin.
 */
async function expectMedModeApplied(page) {
  // The UI is French. Asserted through the section headers, which are the
  // preset's most visible consequence and are translated.
  await expect(page.locator('.settings-group-toggle', { hasText: 'Général' }))
    .toBeVisible({ timeout: 15 * 1000 });

  // The medical model, resolved from the "ultimed" query against the offered
  // repos. The picker lives in the (default-collapsed) engine group.
  await expandSection(page, ENGINE_SECTION);
  await expect(modelPicker(page)).toHaveValue(ULTIMED, { timeout: 15 * 1000 });

  // 30 s chunks, and chunking itself on.
  await expect.poll(() => readSetting(page, 'chunkDuration'), { timeout: 15 * 1000 }).toBe(30);
  await expect.poll(() => readSetting(page, 'enableChunking'), { timeout: 15 * 1000 }).toBe(true);

  // Dictation view by default, and auto-copy on: the preset's only value that
  // flips a default rather than restoring it, so it is worth its own assertion.
  await expect.poll(() => readSetting(page, 'transcriptDisplayMode'), { timeout: 15 * 1000 })
    .toBe('dictation');
  await expect.poll(() => readSetting(page, 'autoCopyToClipboard'), { timeout: 15 * 1000 })
    .toBe(true);

  // One precision per backend. Headless Chromium has no adapter, so the visible
  // radio is the WASM one (int8); the WebGPU choice is only checkable on disk,
  // and it matters just as much because the preset has to survive a later move
  // to the GPU backend.
  await expect(page.locator('input[name="encoderQuant"][value="int8"]')).toBeChecked();
  await expect.poll(() => readSetting(page, 'webgpuEncoderQuant'), { timeout: 15 * 1000 })
    .toBe('fp32');

  // The French medical lexicon, with its text actually loaded (not merely selected).
  await expandSection(page, BOOSTING_SECTION);
  await expect(boostSelect(page)).toHaveValue(MED_LIST, { timeout: 15 * 1000 });
  await expect(page.locator('textarea[placeholder^="Une phrase par ligne"]'))
    .toHaveValue(/cholécystectomie/, { timeout: 15 * 1000 });

  // Boost tuning back at the app defaults, so the preset lands on the same
  // station regardless of what the visitor had been fiddling with.
  await expect.poll(() => readSetting(page, 'boostStrength'), { timeout: 15 * 1000 }).toBe(1);
  await expect.poll(() => readSetting(page, 'boostMinp'), { timeout: 15 * 1000 }).toBe(0.1);
}

test('?mode=med configures the whole medical dictation station', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/?mode=med');
  await openSidebar(page);
  await expectMedModeApplied(page);
});

test('the doctor-facing aliases all reach the same preset', async ({ page }) => {
  // The param exists for links people type from memory, so an accented,
  // capitalised spelling has to work as well as the canonical one.
  await configureTwoRepos(page);
  await page.goto('/?mode=M%C3%A9decin');
  await openSidebar(page);
  await expandSection(page, ENGINE_SECTION);
  await expect(modelPicker(page)).toHaveValue(ULTIMED, { timeout: 15 * 1000 });
  await expect.poll(() => readSetting(page, 'chunkDuration'), { timeout: 15 * 1000 }).toBe(30);
});

test('an unknown ?mode= leaves the visitor\'s settings alone', async ({ page }) => {
  // "No opinion" must mean no opinion: an unrelated mode param arriving on a
  // shared link must not silently reconfigure the machine.
  await configureTwoRepos(page);
  await page.goto('/?mode=kiosk');
  await openSidebar(page);
  await expect(page.locator('.settings-group-toggle', { hasText: 'General' }))
    .toBeVisible({ timeout: 15 * 1000 });
  await expandSection(page, ENGINE_SECTION);
  await expect(modelPicker(page)).toHaveValue(BASE);
  await expect.poll(() => readSetting(page, 'chunkDuration'), { timeout: 15 * 1000 }).toBe(60);
  // Including the privacy-relevant one: an unknown mode must not switch the
  // clipboard on behind the visitor's back.
  await expect.poll(() => readSetting(page, 'autoCopyToClipboard'), { timeout: 15 * 1000 })
    .toBe(false);
});

test('the preset is sticky: it survives a reload without the param', async ({ page }) => {
  // Unlike ?model=, this one persists on purpose (a "medical mode" link is a
  // setup instruction, not a one-visit override). Reload on a bare URL and the
  // station must still be configured.
  await configureTwoRepos(page);
  await page.goto('/?mode=med');
  await openSidebar(page);
  await expectMedModeApplied(page);

  await page.goto('/');
  await openSidebar(page);
  await expectMedModeApplied(page);
});

test('the sidebar button applies the same preset with no link involved', async ({ page }) => {
  await configureTwoRepos(page);
  await page.goto('/');
  await openSidebar(page);
  // It sits above the collapsible groups, so it is reachable without expanding
  // anything: that placement is part of the contract (the preset spans four
  // different groups, so it belongs in none of them).
  await expect(medModeButton(page)).toBeVisible();
  await expect(medModeButton(page)).toHaveText('Mode Dictée Médical');
  await medModeButton(page).click();
  await expectMedModeApplied(page);
});
