// Playwright config for the tier-3 full-transcription E2E.
//
// Boots the local static server (serve.mjs) which serves the built UI plus the
// model weights at /models with the cross-origin-isolation headers ORT needs.
// The single happy-path spec loads the WASM int8 model in a real headless
// Chromium and transcribes a short fixture clip end to end, so the timeouts are
// generous (model load + decode is the slow part). This tier is intentionally
// NOT run by the pre-push hook.
//
// Built with Claude Code.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4178;

export default defineConfig({
  testDir: '.',
  // Whole-test budget: model download/init + inference on CPU WASM is slow.
  timeout: 8 * 60 * 1000,
  expect: { timeout: 6 * 60 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node test/e2e/serve.mjs',
    cwd: new URL('../..', import.meta.url).pathname,
    env: { PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
  },
});
