// Tier-3 E2E: the "Dictation commands" popup (components/DictationCommandsModal.jsx).
//
// Serves a three-rule dictation CSV (newline, comma, list dash) and checks the
// popup in the real app: it opens from the main screen before any model is
// loaded (the rules load on boot, independently of the model), lists exactly
// the rows those rules support (no full-stop row, since no rule handles
// "point"), bolds the recommended phrase, and also opens from the settings
// sidebar. A second test checks both entry points are absent when no rules are
// served, since the popup would have nothing to list. No model weights needed.
//
// Written with the help of Claude Code.
import { test, expect } from '@playwright/test';

const CSV = [
  'id,remplacement,regex',
  'a,\\n,"(?i)\\s*(?:retours?\\s+|all(?:er|ez)\\s+)?[àa]\\s+la\\s+lignes?[.,?!;\\s]*"',
  'b,", ","(?i)[.,?!;\\s]*virgules?[.,?!;\\s]*"',
  'c,- ,"(?i)[.,?!;\\s]*nouveaux?\\s+tir(?:ets?|ée?s?|er)[.,?!;\\s]*"',
].join('\n') + '\n';

async function serveRules(page, csv) {
  await page.route('**/dictation-regex/manifest.txt', (r) => (csv
    ? r.fulfill({ contentType: 'text/plain', body: 'rules.csv\n' })
    : r.fulfill({ status: 404, body: '' })));
  await page.route('**/dictation-regex/rules.csv', (r) => r.fulfill({ contentType: 'text/csv', body: csv }));
}

test('dictation commands popup: opens from the main screen and the sidebar, lists only supported phrases', async ({ page }) => {
  await serveRules(page, CSV);
  await page.goto('/');

  await page.getByTestId('dict-commands-open').click();
  const table = page.getByTestId('dict-commands-table');
  await expect(table).toBeVisible();
  const rows = table.getByTestId('dict-command-row');
  await expect(rows).toHaveCount(3);

  const newline = rows.filter({ hasText: '↵' });
  await expect(newline).toContainText('retour à la ligne, à la ligne, aller à la ligne');
  await expect(newline.getByTestId('dict-command-recommended')).toHaveText('retour à la ligne');
  // "saute une ligne" is curated but no served rule handles it.
  await expect(newline).not.toContainText('saute une ligne');
  await expect(rows.filter({ hasText: 'nouveau tiret' }).getByTestId('dict-command-recommended')).toHaveText('nouveau tiret');
  await expect(table).not.toContainText('point');

  await page.locator('.modal-close').click();
  await expect(table).toHaveCount(0);

  await page.locator('.settings-toggle').click();
  await page.getByTestId('dict-commands-open-sidebar').click();
  await expect(page.locator('.settings-sidebar')).toHaveCount(0);
  await expect(page.getByTestId('dict-commands-table').getByTestId('dict-command-row')).toHaveCount(3);
});

test('dictation commands popup: no entry point when no rules are served', async ({ page }) => {
  await serveRules(page, null);
  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30_000 });
  await expect(page.getByTestId('dict-commands-open')).toHaveCount(0);
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  await expect(page.getByTestId('dict-commands-open-sidebar')).toHaveCount(0);
});
