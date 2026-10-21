// Tier-3 E2E: the self-compiled custom ORT CPU runtime in the real app.
//
// backend.js gives every JS context whose sessions are all WASM (the main
// thread on the WASM backend, the encode-pool workers) the custom runtime, and
// falls back to stock on ANY failure. That fallback is the reason this spec
// exists: a missing, unpinnable or unloadable custom file produces a perfectly
// good transcript on the stock runtime, so only the per-context
// `ORT runtime variant:` markers can tell the two apart. The unit tier covers
// the selection and fallback logic with stubs (test/unit/ort-asset-verify);
// this proves the real files load, pass the integrity manifest, build sessions
// in every context, and transcribe JFK to the golden.
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

function watch(page) {
  const seen = { variants: [], fallbacks: [], errors: [] };
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') seen.errors.push(t);
    const v = /ORT runtime variant: (\S+) \((main|worker)\)/.exec(t);
    if (v) seen.variants.push(`${v[1]} (${v[2]})`);
    if (/runtime unavailable|failed its smoke session/.test(t)) seen.fallbacks.push(t);
  });
  return seen;
}

async function bootAndLoad(page, path, extra) {
  await page.goto(path);
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30 * 1000 });
  await page.waitForTimeout(500);
  await seedSettings(page, extra);
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });
}

test('every WASM context runs the custom runtime and JFK still matches the golden', async ({ page }) => {
  const seen = watch(page);
  // chunkDuration 10 splits the ~11 s clip, so on a machine that passes the
  // encode-pool gate the pool workers build sessions too (more contexts checked).
  await bootAndLoad(page, '/', { chunkDuration: 10, parallelEncode: true });

  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);
  const historyText = page.locator('.history-text').first();
  await expect(historyText).not.toBeEmpty({ timeout: 6 * 60 * 1000 });
  await expect(async () => {
    const got = (await historyText.innerText()).trim();
    const o = overlap(words(GOLDEN), words(got));
    expect(o, `transcript "${got}" overlap ${o.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
  }).toPass({ timeout: 60 * 1000 });

  expect(seen.fallbacks, 'the custom runtime fell back to stock').toEqual([]);
  expect(seen.variants).toContain('custom-relaxed (main)');
  expect(seen.variants.filter((v) => !v.startsWith('custom-relaxed')),
    `contexts not on the custom runtime: ${seen.variants.join(', ')}`).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('?ortep=stock keeps every context on the npm runtime', async ({ page }) => {
  const seen = watch(page);
  await bootAndLoad(page, '/?ortep=stock', {});
  expect(seen.variants.length).toBeGreaterThan(0);
  expect(seen.variants.filter((v) => v.startsWith('custom')),
    `contexts on the custom runtime despite ?ortep=stock: ${seen.variants.join(', ')}`).toEqual([]);
  expect(seen.fallbacks).toEqual([]);
});
