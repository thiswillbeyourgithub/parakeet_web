// Tier-3 E2E: what happens when the LAST configuration the app is willing to
// pick for itself, WASM int8, cannot be loaded.
//
// Every other load failure leaves a setting to revisit. A hand-picked fp32 with
// no shards anywhere gets a banner naming fp32 (transcription-fp32-wasm-no-
// downgrade.spec.js), and a GPU precision this deployment cannot serve gets the
// GPU-to-WASM fallback (gpu-quant-fallback.spec.js), which lands here. So by the
// time WASM int8 fails there is no other precision, backend or source left: the
// app makes exactly one substitution of its own and this is it. fp32 and w4a8
// are hand picks and nothing is allowed to reach for them unasked.
//
// That is the difference this spec pins. A `Failed` status under a page that
// still looks usable reads as "try again", and here there is nothing to try:
// the visitor cannot fix it, so the popup says who can. Same shape as the
// handheld "made for a computer" notice for the same reason, a fact about where
// you are rather than about what you did.
//
// Model-free and fast: no weights are needed to fail to fetch weights.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { routeHfRepoListing, abortHfDownloads, routeNoLocalMirror } from './routes.mjs';
import { seedSettings } from './seed.mjs';

// The default repo's file set, listed honestly. The listing matters: with the
// int8 encoder announced, the load gets all the way to fetching bytes, which is
// the realistic shape of this failure (a mirror that lists more than it serves,
// or a connection that dies mid-download). Nothing here is resolved away early.
const REPO_FILES = [
  'config.json',
  'decoder_joint-model.int8.onnx',
  'encoder-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt',
];

const modal = (page) => page.locator('[data-testid="model-unservable-modal"]');

test('WASM int8 failing from every source is a blocking popup, not a quiet Failed', async ({ page }) => {
  await page.addInitScript(() => {
    window.__CONFIG__ = { VITE_MODEL_SOURCE: 'hf', VITE_MODEL_REPO: 'istupakov/parakeet-tdt-0.6b-v3-onnx' };
  });
  await routeHfRepoListing(page, REPO_FILES);
  await abortHfDownloads(page);
  // And no local mirror to rescue it, so the retry path is spent too. Both
  // halves are needed: the popup is a statement that EVERY source was tried.
  await routeNoLocalMirror(page);

  await page.goto('/');
  // Defaults on purpose: no seeding at all. The configuration under test is the
  // one a first-time visitor arrives with, which is the whole point of treating
  // its failure as fatal rather than as a choice to revisit.
  await expect(page.locator('[data-umami-event="load_model_button"]')).toBeVisible({ timeout: 15000 });
  await expect(modal(page)).toHaveCount(0);

  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(modal(page)).toBeVisible({ timeout: 90 * 1000 });
  // It has to name the thing that failed and the person who can fix it, or it
  // is just a prettier "Failed".
  await expect(modal(page)).toContainText('int8');
  await expect(page.locator('.app-status')).toContainText('Failed', { timeout: 30 * 1000 });

  // Dismissable like the handheld notice: a popup that cannot be closed makes
  // the rest of the page (settings, the About modal, the support report the
  // operator will ask for) unreachable at exactly the moment somebody needs it.
  await modal(page).getByRole('button', { name: 'OK', exact: true }).click();
  await expect(modal(page)).toHaveCount(0);
});

test('a hand-picked precision failing the same way keeps the banner, not the popup', async ({ page }) => {
  // The other side of the line. int8 is fatal because the app chose it; fp32 on
  // WASM was chosen by a person and can be un-chosen, so it stays a banner over
  // a usable page. Collapsing the two would teach visitors that the popup means
  // "you picked wrong", which is the opposite of what it says.
  await page.addInitScript(() => {
    window.__CONFIG__ = { VITE_MODEL_SOURCE: 'hf', VITE_MODEL_REPO: 'istupakov/parakeet-tdt-0.6b-v3-onnx' };
  });
  await routeHfRepoListing(page, REPO_FILES);
  await abortHfDownloads(page);
  await routeNoLocalMirror(page);

  await page.goto('/');
  await seedSettings(page, { wasmEncoderQuant: 'fp32' });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();

  await expect(page.locator('.fallback-prompt')).toContainText('fp32', { timeout: 90 * 1000 });
  await expect(modal(page)).toHaveCount(0);
});
