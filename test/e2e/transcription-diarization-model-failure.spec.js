// Tier-3 E2E for the diarization model-load FAILURE UX: when the speaker models
// can't be downloaded, the app must NOT pop a browser alert. Instead it greys
// out both the per-entry "Speakers" button and the sidebar's "Speakers" default-
// display option, each showing the failure reason as a hover tooltip.
//
// We force the failure deterministically by routing the CAM++ embedding model to
// a 404, so this spec needs NO diarization weights (it never skips) and the ASR
// model (a different repo/path) still loads normally. The background prefetch
// fires the moment the ASR model is ready, hits the 404, and flips the Speakers
// controls into their unavailable state.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings, expandSettingsSection } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

test('diarization model-load failure greys out the Speakers controls with a tooltip (no alert)', async ({ page }) => {
  // Force the embedding model to 404 so getDiarizationModels always rejects,
  // regardless of whether the real weights are present locally. The ASR weights
  // live under a different path and are untouched. A RegExp (not a glob) so the
  // match against the full model URL is unambiguous.
  await page.route(/3dspeaker_speech_campplus/, (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'forced 404 for test' }));

  // The whole point of the feature: a model-load failure must never raise a
  // browser alert/confirm/prompt. Record any dialog so we can assert none fired.
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  await page.goto('/');
  await seedSettings(page, {});
  await page.reload();

  // Load the ASR model; its ready check mark also means the diarization prefetch
  // has been kicked off (it fires on modelReady).
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // --- Sidebar default-display option: the "Speakers" option must become
  // disabled once the prefetch fails (it lives in the collapsible Output
  // section of the settings drawer). ---
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Transcript output');
  const diarizedOption = page.locator('option[value="diarized"]');
  // Auto-retries until the prefetch failure propagates: the reason-tooltip title
  // is only set once diarizationModelError lands, so this waits on the state.
  // Generous timeout: the hub retries a failed download 6x with exponential
  // backoff (~61 s total) before the prefetch finally rejects.
  await expect(diarizedOption).toHaveAttribute('title', /Speaker diarization unavailable/, { timeout: 90 * 1000 });
  // ...and by then the option must be disabled (read the canonical property).
  expect(await diarizedOption.evaluate((el) => el.disabled)).toBe(true);
  // Close the drawer so it doesn't overlap the history entry below.
  await page.locator('.settings-sidebar-close').click();

  // --- Per-entry Speakers button: transcribe a clip so the button renders, then
  // assert it is greyed (unavailable class + aria-disabled) with the reason as
  // its title. ---
  await page.locator('#audio-file-input').setInputFiles(fixture('jfk.mp3'));
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  const speakersBtn = page.locator('.history-modes button', { hasText: 'Speakers' }).first();
  await expect(speakersBtn).toBeVisible({ timeout: 30 * 1000 });
  await expect(speakersBtn).toHaveClass(/display-mode-button--unavailable/);
  await expect(speakersBtn).toHaveAttribute('aria-disabled', 'true');
  await expect(speakersBtn).toHaveAttribute('title', /Speaker diarization unavailable/);

  // Clicking the greyed button must do nothing: no diarized view, no alert.
  await speakersBtn.click();
  await expect(page.locator('.diar-turns')).toHaveCount(0);

  expect(dialogs, `unexpected browser dialog(s): ${dialogs.join(' | ')}`).toHaveLength(0);
});
