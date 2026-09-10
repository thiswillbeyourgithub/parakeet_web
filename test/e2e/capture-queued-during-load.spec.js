// Tier-3 E2E: audio captured while the model is still loading must be QUEUED
// and transcribed automatically once the model is ready (Q2), not dropped or
// refused. Previously the upload path hard-refused with an alert while loading.
//
// We make the loading window deterministic by delaying ONE weight-adjacent file
// fetch: the app parks mid-load for ~15 s, during which
// we upload a clip. Decode/resample need no model, so the clip is buffered; when
// the delayed file finally arrives and the model becomes ready, the queue
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

  // Hold ONE weight file open for ~15 s so the app parks mid-load long enough
  // to upload a file into it. The held file is deliberately NOT the encoder:
  // hub.js fetches filesToGet strictly in order and the encoder is first, so
  // holding it means the load stalls before a single byte has crossed the
  // network. That is a real state (and the app correctly still says "Loading
  // model" in it), but it is the wrong one for the download-phase assertion
  // below. Holding vocab.txt instead lets the encoder and decoder stream in
  // full first, so bytes have provably moved by the time we look.
  await page.route('**/vocab.txt', async (route) => {
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
  // And that the status line names the phase it is actually in. The encoder and
  // decoder have streamed by now, so anything still saying "Loading model"
  // would be the old conflation that made a multi-minute cold download
  // indistinguishable from a slow machine. The word only ever switches on a
  // real byte event, which is what keeps a cache-only load from claiming a
  // download it never made.
  await expect(page.locator('.app-status')).toContainText('Downloading model', { timeout: 15 * 1000 });
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
