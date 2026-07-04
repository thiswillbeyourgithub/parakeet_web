// Tier-3 E2E for the decode-debug introspection UI: the sidebar "Decode debug
// view" checkbox (Debug settings group) makes every new transcription carry a
// per-token debug payload, which adds a per-entry "Debug" base mode next to
// Raw/Speakers. The view renders one clickable pill per decoded token; a click
// opens an inline card with the token's decoding evidence (logit, log-prob,
// boost bonus, duration, confidence) and the top-k alternatives the decoder
// considered at that step.
//
// Runs on the WASM int8 model from the local /models route (see seed.mjs and
// CLAUDE.md for why headless Chromium pins that combination).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings, expandSettingsSection } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures', 'jfk.mp3');

test('decode debug checkbox collects a payload and the Debug view exposes tokens + alternatives', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  // Enable the collection through the real sidebar checkbox (not a seeded
  // setting) so the whole chain is exercised: checkbox -> state -> transcribe
  // option -> entry payload -> view.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Debug');
  const checkbox = page
    .locator('.setting-row', { hasText: 'Add decoder debug view' })
    .locator('input[type="checkbox"]');
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.locator('.settings-sidebar-close').click();

  // Load the model and transcribe the JFK fixture.
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });

  // The run carried a debug payload, so the entry offers the Debug base mode.
  const debugBtn = page.locator('.history-modes button', { hasText: 'Debug' }).first();
  await expect(debugBtn).toBeVisible();
  await debugBtn.click();

  // One pill per decoded token; the 11 s clip decodes to dozens.
  const pills = page.locator('.decode-debug .debug-pill');
  await expect(pills.first()).toBeVisible();
  expect(await pills.count()).toBeGreaterThan(10);

  // The summary names the decoder strategy that produced the run.
  await expect(page.locator('.decode-debug__summary')).toContainText(/greedy|beam/);

  // Clicking a pill opens the inline card: metric grid plus an alternatives
  // table with at least the chosen token and one competitor, logits numeric,
  // and exactly one highlighted (chosen) row.
  await pills.nth(3).click();
  const card = page.locator('.decode-debug__card');
  await expect(card).toBeVisible();
  const altRows = card.locator('.decode-debug__table').first().locator('tbody tr');
  expect(await altRows.count()).toBeGreaterThanOrEqual(2);
  const firstLogit = await altRows.first().locator('td').nth(2).innerText();
  expect(Number.parseFloat(firstLogit)).not.toBeNaN();
  await expect(card.locator('.decode-debug__row--chosen')).toHaveCount(1);

  // Clicking the same pill again closes the card (toggle behaviour).
  await pills.nth(3).click();
  await expect(card).toHaveCount(0);

  // Back to Raw: the plain transcript replaces the pills.
  await page.locator('.history-modes button', { hasText: 'Raw' }).first().click();
  await expect(page.locator('.decode-debug')).toHaveCount(0);
  await expect(historyText).toContainText(/ask/i);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
