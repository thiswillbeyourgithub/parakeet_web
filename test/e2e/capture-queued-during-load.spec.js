// Tier-3 E2E: audio captured while the model is still loading must be QUEUED
// and transcribed automatically once the model is ready (Q2), not dropped or
// refused. Previously the upload path hard-refused with an alert while loading.
//
// We make the loading window deterministic by delaying ONLY the encoder weight
// fetch (the long pole): the app parks in 'loadingModel' for ~15 s, during which
// we upload a clip. Decode/resample need no model, so the clip is buffered; when
// the delayed encoder finally arrives and the model becomes ready, the queue
// drains and the buffered clip transcribes on its own. We then assert the
// transcript recovered the spoken content.
//
// Reuses the WASM-int8 local-model setup (serve.mjs serves the weights at
// /models; seedSettings forces local source + wasm).
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';
import { words, overlap } from './text-overlap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO = resolve(here, '../fixtures/jfk.mp3');
const GOLDEN = readFileSync(resolve(here, '../fixtures/jfk.expected.txt'), 'utf-8').trim();

test('a file uploaded while the model is loading is queued and transcribed once ready', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Hold the encoder download open for ~15 s so the app stays in 'loadingModel'
  // long enough to upload a file mid-load. Only the encoder is delayed; every
  // other file loads normally, so the load completes shortly after the delay.
  await page.route('**/encoder-model.int8.onnx', async (route) => {
    await new Promise((r) => setTimeout(r, 15000));
    await route.continue();
  });

  await page.goto('/');
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await seedSettings(page);
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  // The capture controls appear during the load (Q2). Upload the clip before the
  // model is ready: the file input is inside .controls, which now renders while
  // 'loadingModel'.
  const fileInput = page.locator('#audio-file-input');
  await fileInput.waitFor({ state: 'attached', timeout: 30 * 1000 });
  // Prove we really are mid-load, not already ready, when we hand over the file.
  await expect(page.locator('[data-umami-event="load_model_button"]')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('✔');
  await fileInput.setInputFiles(FIXTURE_AUDIO);

  // The queued-capture banner confirms the clip was buffered (not dropped/refused)
  // while the model was still loading.
  const queuedBanner = page.locator('.banner--info', { hasText: /transcrib/i });
  await expect(queuedBanner).toBeVisible({ timeout: 10 * 1000 });

  // Once the delayed encoder arrives and the model is ready, the queue drains and
  // the buffered clip transcribes with no further user action.
  const historyText = page.locator('.history-text').first();
  await expect(historyText).toBeVisible({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(historyText).not.toContainText('transcribing', { timeout: 6 * 60 * 1000 });

  // The transcript recovered the spoken content (robust to casing/punctuation).
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `queued "${got}" vs golden "${GOLDEN}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  // The queued banner is gone once the model is ready and the clip has run.
  await expect(queuedBanner).toHaveCount(0);

  expect(errors, `page console errors: ${errors.join('\n')}`).toHaveLength(0);
});
