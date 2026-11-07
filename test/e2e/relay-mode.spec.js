// Tier-3 E2E for the /models relay debug override (Debug section, persisted
// `relayMode`, app/ui/src/lib/relayMode.js). It checks the one thing the
// setting promises, WHICH HOST the load talks to, by recording every request
// the page makes. Needs no model weights: both sources are made to fail, so
// each load ends quickly in Failed, and only the requests matter (a 404 is
// final in hub.js, so no attempt waits on the retry backoff).
//
// The 'auto' case is the control: it proves the detector would see a /models
// request if the app made one, so the 'forbid' assertion of zero cannot pass
// just because nothing was being watched.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';
import { routeNoLocalMirror } from './routes.mjs';

const HF_RE = /^https:\/\/([^/]*\.)?huggingface\.co\//;
const isLocalModels = (url) => new URL(url).pathname.startsWith('/models/');

async function loadAndRecord(page, { modelSource, relayMode }) {
  const requests = [];
  const logs = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript((src) => {
    window.__CONFIG__ = { ...(window.__CONFIG__ || {}), VITE_MODEL_SOURCE: src };
  }, modelSource);
  // Both sources fail fast: HF is aborted outright, /models answers 404.
  await page.route(HF_RE, (route) => route.abort());
  await routeNoLocalMirror(page);

  await page.goto('/');
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Debug');
  const select = page.locator('[data-testid="relay-mode"]');
  await expect(select).toHaveValue('auto');
  await select.selectOption(relayMode);
  if (relayMode !== 'auto') {
    // Persisted: a reload keeps the pick (the section's open state persists too).
    await page.reload();
    await page.locator('.settings-toggle').click();
    await expandSettingsSection(page, 'Debug');
    await expect(select).toHaveValue(relayMode);
  }
  // The open sidebar covers the load button.
  await page.locator('.settings-sidebar-close').click();
  requests.length = 0;
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('.app-status')).toContainText('Failed', { timeout: 60 * 1000 });
  return {
    hf: requests.filter((u) => HF_RE.test(u)),
    local: requests.filter(isLocalModels),
    logs,
  };
}

test('auto (control): HF fails, the load falls back to /models', async ({ page }) => {
  const { hf, local } = await loadAndRecord(page, { modelSource: 'both', relayMode: 'auto' });
  expect(hf.length, 'auto tries HuggingFace first').toBeGreaterThan(0);
  expect(local.length, 'and then the relay').toBeGreaterThan(0);
});

test('forbid: HuggingFace only, /models never touched', async ({ page }) => {
  const { hf, local, logs } = await loadAndRecord(page, { modelSource: 'both', relayMode: 'forbid' });
  expect(hf.length).toBeGreaterThan(0);
  expect(local, 'no request may reach /models under forbid').toEqual([]);
  expect(logs.some((l) => l.includes('relay debug mode: forbid'))).toBe(true);
});

test('force: every file through /models, even on an HF-only deployment', async ({ page }) => {
  const { hf, local, logs } = await loadAndRecord(page, { modelSource: 'hf', relayMode: 'force' });
  expect(local.length).toBeGreaterThan(0);
  expect(hf, 'no request may reach HuggingFace under force').toEqual([]);
  expect(logs.some((l) => l.includes('relay debug mode: force'))).toBe(true);
});
