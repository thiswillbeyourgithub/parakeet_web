// Tier-3 E2E: the drug-name fix view (lib/drugRules.js + the "Drugs" layer in
// App.jsx) end to end in headless Chromium on the WASM int8 model.
//
// The vendored rule file knows nothing the JFK clip says, so the spec serves a
// one-rule file instead ("fellow Americans" -> "fellowmab") and a one-rule
// dictation CSV that only matches the DRUG-FIXED text ("fellowmab" ->
// "ORDERMARK"). Seeing ORDERMARK therefore proves, in the real app, that the
// rules were fetched and compiled, that the layer is on by default once the
// setting is, and that it runs BEFORE the dictation regexes. The toggles are
// then checked in both directions, and the sidebar setting must remove the
// view entirely rather than leave a hidden override rewriting the entry.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings, readSetting, expandSettingsSection } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/jfk.mp3');

const WB = "(?<![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F'-])";
const WE = '(?![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F-])';
const DRUG_RULES = JSON.stringify({
  pattern: `${WB}fellow[\\s,]+americans${WE}`,
  replacement: 'fellowmab',
  variant: 'fellow americans',
}) + '\n';

test('drug-name view: on by default, applied before dictation, removable from the sidebar', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/drug-rules/drug_fix_rules.jsonl', (r) => r.fulfill({ contentType: 'application/x-ndjson', body: DRUG_RULES }));
  await page.route('**/dictation-regex/manifest.txt', (r) => r.fulfill({ contentType: 'text/plain', body: 'order.csv\n' }));
  await page.route('**/dictation-regex/order.csv', (r) => r.fulfill({ contentType: 'text/csv', body: 'regex,replacement\nfellowmab,ORDERMARK\n' }));

  await page.goto('/');
  // Let the first boot's default-persist storm flush before seeding (see
  // chunking.spec.js), or the seed is clobbered on reload.
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, { drugFixEnabled: true, transcriptDisplayMode: 'dictation' });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  const drugButton = page.getByTestId('drug-fix-toggle').first();
  const dictationButton = page.locator('.display-mode-button', { hasText: 'Dictation' }).first();
  await expect(drugButton).toHaveAttribute('aria-pressed', 'true');

  // Drugs then Dictée: only reachable if the drug fix ran first.
  await expect(historyText).toContainText('ORDERMARK');

  // Drugs off, Dictée on: the dictation rule has nothing to match any more.
  await drugButton.click();
  await expect(historyText).not.toContainText('ORDERMARK');
  await expect(historyText).toContainText(/fellow,? Americans/i);

  // Drugs on, Dictée off: the drug fix alone.
  await drugButton.click();
  await dictationButton.click();
  await expect(historyText).toContainText('fellowmab');
  await expect(historyText).not.toContainText('ORDERMARK');

  // Sidebar off: the view disappears and the entry is raw again, and the
  // choice persists.
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'General');
  await page.getByTestId('drug-fix-setting').uncheck();
  await expect(page.getByTestId('drug-fix-toggle')).toHaveCount(0);
  await expect(historyText).toContainText(/fellow,? Americans/i);
  await expect.poll(() => readSetting(page, 'drugFixEnabled')).toBe(false);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
