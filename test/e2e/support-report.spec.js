// Tier-3 E2E for the Debug-section support report: a modelless spec (no
// weights, runs in seconds) that opens the sidebar, expands Debug, and asserts
// the report textarea fills with valid JSON describing this very browser.
// Chromium is the reference engine for the WASM feature probes: simd and
// threads (the test server sends COOP/COEP, so crossOriginIsolated is true)
// must both read true here, which validates the probe byte-modules against a
// real engine, not just against WebAssembly.validate's signature.
// Also covers the copy button end to end via a granted clipboard permission.
// Written with the help of Claude Code.
import { test, expect } from '@playwright/test';
import { expandSettingsSection } from './seed.mjs';

test('support report fills with valid JSON and copies to clipboard', async ({ page, context }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Debug');

  const textarea = page.locator('.support-report-text');
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue(/parakeetweb-support-report/, { timeout: 15_000 });

  const report = JSON.parse(await textarea.inputValue());
  expect(report.format).toBe('parakeetweb-support-report/1');
  expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(report.app.name).toBe('parakeet_web');
  expect(report.app.version).toMatch(/^\d+\.\d+/);
  expect(report.settings.backend).toBe('wasm');
  expect(report.settings.beamWidth).toBeGreaterThan(0);
  expect(report.model.loaded).toBe(false);
  expect(report.browser.userAgent).toContain('Chrome');
  expect(report.hardware.hardwareConcurrency).toBeGreaterThan(0);
  expect(report.capabilities.wasm.simd).toBe(true);
  expect(report.capabilities.wasm.threads).toBe(true);
  expect(report.capabilities.crossOriginIsolated).toBe(true);
  expect(report.capabilities.sharedArrayBuffer).toBe(true);

  // Copy round-trip: the button regenerates, sanitizes, and writes to the
  // clipboard; what lands there must parse back to the same report format.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.support-report-copy').click();
  await expect(page.locator('.support-report-copy')).toContainText('Copied');
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.format).toBe('parakeetweb-support-report/1');

  expect(errors).toEqual([]);
});
