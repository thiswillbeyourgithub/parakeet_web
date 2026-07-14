// Tier-3 E2E for the app-wide WebGPU kill switch (App.jsx WEBGPU_DISABLED).
// WebGPU's browser runtime has no GPU kernels for this encoder's shape ops, so
// it runs mostly on CPU and slower than the WASM int8 path; the app therefore
// disables WebGPU and defaults everyone to WASM int8. This spec asserts the UI
// consequences:
//   1. the WebGPU backend radio is greyed out (disabled),
//   2. the fp16 encoder-precision radio is greyed out (fp16 is WebGPU-only),
//   3. int8 is the active default, and int8-lite / fp32 stay selectable on WASM
//      (fp32 is an opt-in sharded encoder, still allowed on the WASM backend),
//   4. a PERSISTED 'webgpu-hybrid' backend is coerced to WASM on boot, so an old
//      saved setting can never resurrect the GPU path.
// It touches no model weights (nothing is loaded), so it never skips and is fast.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection } from './seed.mjs';

async function openPrecisionControls(page) {
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Model and performance');
}

test('WebGPU + fp16 are greyed out; int8 is the WASM default with fp32 opt-in still allowed', async ({ page }) => {
  await page.goto('/');
  await seedSettings(page);
  await page.reload();

  await openPrecisionControls(page);

  const webgpuRadio = page.locator('input[name="backend"][value="webgpu-hybrid"]');
  const wasmRadio = page.locator('input[name="backend"][value="wasm"]');
  await expect(webgpuRadio).toBeVisible();
  await expect(webgpuRadio).toBeDisabled();
  await expect(wasmRadio).toBeChecked();

  const int8 = page.locator('input[name="encoderQuant"][value="int8"]');
  const int8Lite = page.locator('input[name="encoderQuant"][value="int8-lite"]');
  const fp16 = page.locator('input[name="encoderQuant"][value="fp16"]');
  const fp32 = page.locator('input[name="encoderQuant"][value="fp32"]');
  // int8 is the default; int8-lite and fp32 are opt-in on WASM; fp16 is
  // WebGPU-only and therefore greyed out while WebGPU is disabled.
  await expect(int8).toBeEnabled();
  await expect(int8).toBeChecked();
  await expect(int8Lite).toBeEnabled();
  await expect(fp32).toBeEnabled();
  await expect(fp32).not.toBeChecked();
  await expect(fp16).toBeDisabled();
});

test('a persisted webgpu-hybrid backend is coerced to WASM on boot', async ({ page }) => {
  // Simulate an old profile that had selected WebGPU before it was disabled.
  await page.goto('/');
  await seedSettings(page, { backend: 'webgpu-hybrid' });
  await page.reload();

  await openPrecisionControls(page);

  // The coercion (App.jsx coerceBackend) must have flipped it back to WASM.
  await expect(page.locator('input[name="backend"][value="wasm"]')).toBeChecked();
  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).not.toBeChecked();
  await expect(page.locator('input[name="backend"][value="webgpu-hybrid"]')).toBeDisabled();
});
