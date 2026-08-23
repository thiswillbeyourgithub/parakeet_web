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

// Re-export so harnesses can re-seed settings between reloads (e.g. to undo a
// backend the app persisted after a WebGPU->WASM fallback) without each one
// reaching into test/e2e/seed.mjs directly.
export { seedSettings };

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
// waitForServer(baseURL) before driving it. `modelDir` overrides the weights dir;
// `distDir` overrides the served app build (PARAKEET_E2E_DIST_DIR), which is how
// an A/B harness serves two builds side by side on two ports.
export function spawnAppServer({ port, modelDir, distDir } = {}) {
  const env = { ...process.env, PORT: String(port) };
  if (modelDir) env.PARAKEET_E2E_MODEL_DIR = modelDir;
  if (distDir) env.PARAKEET_E2E_DIST_DIR = distDir;
  const proc = spawn('node', [SERVE], { cwd: ROOT, env, stdio: 'inherit' });
  return { proc, baseURL: `http://127.0.0.1:${port}` };
}

// Launch a Chromium with WebGPU enabled. Headed is more reliable than headless
// for real WebGPU on a GPU box (see webgpu-check.mjs). `channel` selects the
// browser build: 'chromium' (the always-present bundled Playwright browser) or
// 'chrome' (a system Google Chrome, if installed).
//
// 'chromium' is mapped to undefined (same as webgpu-check.mjs) instead of being
// passed literally: with channel:'chromium' Playwright runs the FULL Chromium
// binary even for headless, and that binary's blob-storage paging is broken
// under multi-GB blob traffic here (paged blob files come back NotReadableError
// / net::ERR_BLOB_REFERENCED_BLOB_BROKEN, killing every int8 model load
// at ORT session create; reproduced app-free, 2026-08-12). The default launch
// uses the headless shell for headless runs, which never hits it, and headed
// runs use the full binary either way.
export function launchWebGpuBrowser({ headless = false, channel = 'chromium' } = {}) {
  return chromium.launch({
    headless,
    channel: channel === 'chromium' ? undefined : channel,
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
  // WebGPU is available app-wide now, so a seeded webgpu-hybrid backend is
  // honoured without any query parameter. `?webgpu=1` is kept on the webgpu
  // path purely as a no-op guard: if the app-wide pin ever came back (it
  // coerced every persisted webgpu backend to wasm, which transcribe-browser's
  // retry loop used to misread as an adapter-probe flake), this keeps these
  // harnesses working. page.reload() preserves the query string, so re-seed +
  // reload retries keep it too.
  const wantWebgpu = String(settings.backend || '').startsWith('webgpu');
  await page.goto(wantWebgpu ? `${baseURL}/?webgpu=1` : baseURL);
  await seedSettings(page, settings);
  await page.reload();
}

// Click the "Load model" button and wait for the ready check mark (✔). Throws if
// the tab dies (OOM / GPU device lost), the app lands on the Failed status
// (surfaced immediately with the on-page error text instead of masking the
// real failure as a slow timeout), or the model never becomes ready.
export async function loadModelAndWaitReady(page, { timeoutMs = 6 * 60 * 1000 } = {}) {
  await page.locator('[data-umami-event="load_model_button"]').click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => null);
    if (body === null) throw new Error('tab closed during model load (OOM / GPU device lost?)');
    if (body.includes('✔')) return;
    // The status line reads "Status: Failed" (en) / "Statut : Échec" (fr); the
    // banner under it (modelLoadError / quantUnavailable) carries the reason.
    if (/Failed|Échec/.test(body)) {
      const reason = (body.match(/^.*(?:Failed|Échec).*$/m) || [''])[0].trim();
      throw new Error(`model load FAILED${reason ? ` (${reason})` : ''}; see the page console for the underlying error`);
    }
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
