// Tier-3 E2E: model-defining controls (backend / encoder precision / CPU
// threads) stay editable AFTER the model has loaded, and changing one disposes
// the live model and reloads with the new setting (Q1: immediate live swap).
// Previously these controls greyed out once status hit 'modelReady'; now they
// stay usable and a change triggers an unload+reload so switching precision or
// thread count never needs a page refresh (and frees memory before the new
// weights load).
//
// Reuses the WASM-int8 local-model setup (serve.mjs serves the weights at
// /models; seedSettings forces local source + wasm). CPU threads is the only
// param that reliably reloads to SUCCESS on headless int8 (a precision change
// would need fp16/fp32 shards the harness does not ship), so we swap the thread
// count and observe the control locking (reload underway) then unlocking (model
// ready again) - a purely UI-observable full reload cycle.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

test('model params stay editable after load and a change live-swaps the model', async ({ page }) => {
  // "Disposing existing model before loading new one" only logs when loadModel
  // runs with a model already loaded, i.e. exactly on a live swap. Count it to
  // prove the reload was triggered by the param change (the first load, with no
  // prior model, never logs it).
  let disposeLogs = 0;
  page.on('console', (m) => {
    if (m.text().includes('Disposing existing model before loading new one')) disposeLogs += 1;
  });

  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await seedSettings(page);
  await page.reload();

  // Load the model to 'modelReady'.
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
  expect(disposeLogs, 'first load must not dispose (no prior model)').toBe(0);

  // Open settings and reveal the Model and performance group where the model
  // params now live.
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-sidebar')).toBeVisible();
  await expandSettingsSection(page, 'Model and performance');

  // The crux of "make them usable": with the model loaded, the backend radio,
  // an encoder-precision radio, and the CPU-threads field are all ENABLED
  // (they used to be disabled once modelReady).
  const backendWasm = page.locator('input[name="backend"][value="wasm"]');
  const precisionInt8 = page.locator('input[name="encoderQuant"][value="int8"]');
  const threads = page.locator('input[name="cpuThreads"]');
  await expect(backendWasm).toBeEnabled();
  await expect(precisionInt8).toBeEnabled();
  await expect(threads).toBeEnabled();

  // Pick a valid thread count that differs from the current one so the swap
  // actually fires. If the machine reports a single core the field can't change
  // (min==max), so there is nothing to swap - skip rather than assert falsely.
  const current = Number(await threads.inputValue());
  const max = Number(await threads.getAttribute('max'));
  const target = current === 1 ? (max >= 2 ? 2 : null) : 1;
  test.skip(target === null, 'single-core host: CPU threads cannot change, no swap to exercise');

  await threads.fill(String(target));
  await threads.blur();

  // The change disposes the live model and reloads: the control locks while the
  // reload runs, then unlocks once the model is ready again. Observing both
  // edges proves a genuine unload+reload cycle happened.
  await expect(threads).toBeDisabled({ timeout: 60 * 1000 });
  await expect(threads).toBeEnabled({ timeout: 6 * 60 * 1000 });
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // And it was a live swap, not a fresh load: the dispose path ran exactly once.
  expect(disposeLogs, 'the param change must have disposed the previous model').toBe(1);
});
