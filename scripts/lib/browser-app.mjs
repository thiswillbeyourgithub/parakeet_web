// Shared glue for Node harnesses that drive the BUILT web app in a real browser
// (Playwright). Factored out so scripts/webgpu-check.mjs and
// scripts/transcribe-browser.mjs don't each carry their own copy of the
// serve/launch/seed/load-model dance. It reuses the tier-3 e2e plumbing verbatim
// (test/e2e/serve.mjs serves the UI + local /models weights with the COOP/COEP
// headers ORT needs; test/e2e/seed.mjs writes the settings DB) so a browser-run
// harness can never drift from what the e2e suite exercises.
//
// NOTE: webgpu-check.mjs predates this helper and still inlines the equivalent
// glue; it can be migrated onto these functions in a follow-up (kept separate
// here to avoid churning a GPU-validated script).
//
// Built with Claude Code.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { seedSettings } from '../../test/e2e/seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');
const SERVE = resolve(ROOT, 'test/e2e/serve.mjs');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a static server until it answers (or the request 404s, which still means
// it is up). Throws if it never comes up within `timeoutMs`.
export async function waitForServer(baseURL, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(baseURL);
      if (r.ok || r.status === 404) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`static server at ${baseURL} did not come up within ${timeoutMs}ms`);
}

// Spawn the tier-3 static server (test/e2e/serve.mjs) on `port`, serving the
// built app plus the local /models weights (from PARAKEET_E2E_MODEL_DIR, default
// ./fallback_models). Returns the child process and the baseURL; call
// waitForServer(baseURL) before driving it. `modelDir` overrides the weights dir.
export function spawnAppServer({ port, modelDir } = {}) {
  const env = { ...process.env, PORT: String(port) };
  if (modelDir) env.PARAKEET_E2E_MODEL_DIR = modelDir;
  const proc = spawn('node', [SERVE], { cwd: ROOT, env, stdio: 'inherit' });
  return { proc, baseURL: `http://127.0.0.1:${port}` };
}

// Launch a Chromium with WebGPU enabled. Headed is more reliable than headless
// for real WebGPU on a GPU box (see webgpu-check.mjs). `channel` selects the
// browser build: 'chromium' (the always-present bundled Playwright browser) or
// 'chrome' (a system Google Chrome, if installed).
export function launchWebGpuBrowser({ headless = false, channel = 'chromium' } = {}) {
  return chromium.launch({
    headless,
    channel,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });
}

// Boot the app in `page` with a known configuration: force the LOCAL model
// source (so hub.js resolves weights from serve.mjs's /models, incl. the fp32
// shards and the diarization models), navigate, seed the settings DB, and
// reload so the app picks the settings up. `settings` are the unprefixed keys
// seedSettings understands (e.g. { backend, webgpuEncoderQuant, beamWidth }).
export async function bootApp(page, { baseURL, settings = {}, modelSource = 'local' } = {}) {
  // modelSource is a CONFIG value the docker entrypoint writes into
  // window.__CONFIG__ (NOT a settings-DB key), so inject it the same way before
  // any app script runs. With 'local', hub.js HEAD-probes /models.
  await page.addInitScript((src) => { window.__CONFIG__ = { VITE_MODEL_SOURCE: src }; }, modelSource);
  await page.goto(baseURL);
  await seedSettings(page, settings);
  await page.reload();
}

// Click the "Load model" button and wait for the ready check mark (✔). Throws if
// the tab dies (OOM / GPU device lost) or the model never becomes ready.
export async function loadModelAndWaitReady(page, { timeoutMs = 6 * 60 * 1000 } = {}) {
  await page.locator('[data-umami-event="load_model_button"]').click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => null);
    if (body === null) throw new Error('tab closed during model load (OOM / GPU device lost?)');
    if (body.includes('✔')) return;
    await sleep(500);
  }
  throw new Error(`model did not become ready within ${timeoutMs}ms`);
}

// Reject a software/fallback WebGPU adapter (SwiftShader/lavapipe) the same way
// webgpu-check.mjs does: a software adapter is useless for a real GPU run (and
// OOMs on big models). Returns { ok, adapter, reason }.
export async function probeRealWebGpu(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu is undefined' };
    try {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!a) return { ok: false, reason: 'requestAdapter() returned null' };
      const info = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
      const desc = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.toLowerCase();
      const software = a.isFallbackAdapter
        || /swiftshader|lavapipe|llvmpipe|software|basic render|microsoft basic/.test(desc);
      if (software) return { ok: false, reason: `software adapter (${desc.trim() || 'unknown'})` };
      return { ok: true, adapter: desc.trim() || 'unknown' };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  });
}
