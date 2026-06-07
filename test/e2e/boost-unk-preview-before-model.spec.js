// Regression E2E: the "untokenizable terms" warning for a curated list must
// appear as soon as the list is loaded, NOT only after a model is loaded (which,
// when the user transcribes before explicitly loading a model, looked like the
// warning only showing up "after the first transcription").
//
// A server-prebuilt artifact (<name>.json) ships its own `skipped` list (the
// phrases the model vocab can't represent, e.g. CJK), and it is fetched into
// the app the moment the curated list is selected, independently of the model.
// The boost rebuild effect used to early-return and clear the warning whenever
// no tokenizer was loaded yet, so the skipped list stayed hidden until the model
// was ready. The fix surfaces the prebuilt `skipped` immediately on list-load.
//
// This pins it end to end WITHOUT loading any model weights: it seeds a curated
// boost source, opens Settings, and asserts the skipped term + summary show up
// while the app is still in its pre-model state. The boost-phrases fixtures are
// served by serve.mjs from test/e2e/fixtures/boost-phrases/.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

// Boot with the curated list selected (no model is loaded in this test, but the
// seeded WASM backend keeps the app initialising sanely). The one-shot boost-init
// effect then fetches the list + its prebuilt JSON on load.
const seed = (page) => seedSettings(page, {
  verboseLog: true,
  boostSource: 'clinical-cjk.txt',
});

test('curated list untokenizable terms warning shows before any model is loaded', async ({ page }) => {
  // First load creates the settings DB/store; seed it, then reload so the app
  // picks up the curated boost source.
  await page.goto('/');
  await seed(page);
  await page.reload();

  // Deliberately do NOT click "Load model": the warning must not depend on it.
  // Open Settings, where the boosting controls (and the warning) live.
  await page.locator('.settings-toggle').click();
  // The boost controls live in the (collapsed) Phrase boosting section.
  await expandSettingsSection(page, 'Phrase boosting');

  // The "N term(s) skipped" summary must be present even though no tokenizer
  // exists yet (this is the regression: it used to stay hidden until a model
  // loaded). The skipped terms live in a textarea inside the collapsed <details>;
  // expand it and confirm the prebuilt artifact's skipped term is listed.
  const summary = page.getByText('1 term(s) skipped');
  await expect(summary).toBeVisible({ timeout: 15 * 1000 });
  await summary.click();
  await expect(page.locator('details textarea[readonly]')).toHaveValue(/中文薬/, { timeout: 15 * 1000 });

  // Sanity: the model really is not loaded (no ✔ ready marker), so this proves
  // the warning came from the prebuilt artifact, not a model-driven encode.
  await expect(page.locator('body')).not.toContainText('✔');
});
