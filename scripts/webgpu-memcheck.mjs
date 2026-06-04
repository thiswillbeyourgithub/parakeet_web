#!/usr/bin/env node
// MANUAL WebGPU memory-leak harness. NOT part of any test tier and NOT run in
// CI: the automated tier-3 e2e is headless Chromium, which has no WebGPU and
// falls back to WASM int8 (see CLAUDE.md). This harness is the deliberate
// exception, run BY HAND on a machine with a real GPU + WebGPU-capable Chromium,
// to prove the fp16/WebGPU path can transcribe the FULL ~17 min JFK moon speech
// without leaking JS heap or crashing the tab (OOM).
//
// It reuses the tier-3 plumbing unchanged so it can never drift from production:
//   - test/e2e/serve.mjs serves the built UI + the local weights at /models with
//     the COOP/COEP headers ORT needs (and which make CDP's JS-heap metric
//     precise under cross-origin isolation),
//   - test/e2e/seed.mjs seeds the settings DB (here: backend 'webgpu-hybrid',
//     the UI's actual WebGPU option, so resolveModelQuant picks the fp16 encoder
//     fallback_models ships),
//   - scripts/gen-jfk-moon-fixtures.mjs provides the full speech (downloaded +
//     transcoded into the gitignored cache; the committed fixture is only the
//     3 min crop).
//
// Pass/fail (per the chosen "heap growth + no OOM" signal):
//   FAIL if the tab crashes / OOMs, OR the app silently fell back to WASM
//        (no GPU == not what we are testing), OR the JS heap's late-run median
//        grows past --max-growth x its early-run median (a steady leak).
//   PASS if the full speech transcribes and the JS heap stays bounded.
//   SKIP (exit 2) if WebGPU is unavailable in this browser.
//
// Usage (on a GPU box):
//   npm run build --prefix app/ui          # the harness serves app/ui/dist
//   node scripts/webgpu-memcheck.mjs       # headed Chrome/Chromium + WebGPU
//   node scripts/webgpu-memcheck.mjs --headless --max-growth=1.4
//
// Built with Claude Code.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { seedSettings } from '../test/e2e/seed.mjs';
import { findFfmpeg } from './transcribe.mjs';
import { ensureFullCompact, FULL_COMPACT_PATH } from './gen-jfk-moon-fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'app/ui/dist');
const SERVE = resolve(ROOT, 'test/e2e/serve.mjs');

// --- args --------------------------------------------------------------------
function parseArgs(argv) {
  const a = { headless: false, maxGrowth: 1.5, port: 4179, pollMs: 2000, channel: 'chrome' };
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const [k, v] = eq === -1 ? [arg, null] : [arg.slice(0, eq), arg.slice(eq + 1)];
    switch (k) {
      case '--headless': a.headless = true; break;
      case '--max-growth': a.maxGrowth = Number(v); break;
      case '--port': a.port = Number(v); break;
      case '--poll-ms': a.pollMs = Number(v); break;
      case '--channel': a.channel = v; break; // 'chrome' | 'chromium' (bundled)
      case '-h': case '--help':
        console.log(`Usage: node scripts/webgpu-memcheck.mjs [options]
  --headless         Run headless (WebGPU is more reliable headed on a GPU box)
  --max-growth F     Max late/early JS-heap median ratio before it is a leak (default: 1.5)
  --channel C        Browser channel: 'chrome' (installed) or 'chromium' (bundled) (default: chrome)
  --port N           Static server port (default: 4179)
  --poll-ms N        JS-heap sampling interval (default: 2000)`);
        process.exit(0);
    }
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(baseURL, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(baseURL); if (r.ok || r.status === 404) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`static server at ${baseURL} did not come up`);
}

// Median of a numeric array.
function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const MB = (b) => (b / 1024 / 1024).toFixed(1);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseURL = `http://127.0.0.1:${args.port}`;

  if (!existsSync(DIST)) {
    console.error(`[memcheck] ${DIST} missing. Run: npm run build --prefix app/ui`);
    process.exit(1);
  }

  // Ensure the full speech clip exists (downloads + transcodes on first run).
  const ffmpeg = findFfmpeg();
  ensureFullCompact(ffmpeg);
  console.error(`[memcheck] full speech: ${FULL_COMPACT_PATH}`);

  // Boot the same static server the tier-3 e2e uses.
  const serve = spawn('node', [SERVE], {
    cwd: ROOT, env: { ...process.env, PORT: String(args.port) }, stdio: 'inherit',
  });
  let browser;
  const cleanup = async () => {
    try { await browser?.close(); } catch { /* ignore */ }
    try { serve.kill('SIGTERM'); } catch { /* ignore */ }
  };

  try {
    await waitForServer(baseURL);

    // WebGPU is finicky headless; the flag is required either way on a GPU box.
    browser = await chromium.launch({
      headless: args.headless,
      channel: args.channel === 'chromium' ? undefined : args.channel,
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // --- console wiring: errors, chunk-complete logs, the session-mode line ----
    const errors = [];
    let crashed = false;
    let sessionMode = null;        // from "[Parakeet.js] Creating ONNX sessions with execution mode '...'"
    let lastChunk = 0, chunkTotal = 0;
    page.on('console', (m) => {
      const txt = m.text();
      if (m.type() === 'error') errors.push(txt);
      const mode = /Creating ONNX sessions with execution mode '([^']+)'/.exec(txt);
      if (mode) sessionMode = mode[1];
      const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(txt);
      if (hit) { lastChunk = Number(hit[1]); chunkTotal = Number(hit[2]); }
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('crash', () => { crashed = true; });

    await page.goto(baseURL);

    // Hard gate: a REAL WebGPU adapter, else SKIP. Chromium with
    // --enable-unsafe-webgpu hands out a software (SwiftShader/lavapipe) adapter
    // on a GPU-less box; that is useless for a GPU memory test (and OOMs loading
    // the 1.2 GB fp16 model), so reject fallback/software adapters too rather
    // than pretend to exercise WebGPU.
    const gpu = await page.evaluate(async () => {
      if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu is undefined' };
      try {
        const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!a) return { ok: false, reason: 'requestAdapter() returned null' };
        const info = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
        const desc = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.toLowerCase();
        const software = a.isFallbackAdapter || /swiftshader|lavapipe|llvmpipe|software|basic render|microsoft basic/.test(desc);
        if (software) return { ok: false, reason: `software adapter (${desc.trim() || 'fallback'})` };
        return { ok: true, adapter: desc.trim() };
      } catch (e) { return { ok: false, reason: String(e) }; }
    });
    if (!gpu.ok) {
      console.error(`[memcheck] SKIP: no real WebGPU GPU (${gpu.reason}). Run on a box with a GPU + WebGPU-capable Chromium.`);
      await cleanup();
      process.exit(2);
    }
    console.error(`[memcheck] WebGPU adapter: ${gpu.adapter || 'unknown'}`);

    await seedSettings(page, { backend: 'webgpu-hybrid' });
    await page.reload();

    console.error('[memcheck] loading model on WebGPU (fp16) ...');
    await page.locator('[data-umami-event="load_model_button"]').click();
    // Wait for the ready check mark (model loaded), polling for crash too.
    const loadDeadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < loadDeadline) {
      if (crashed) throw new Error('tab crashed during model load (OOM?)');
      const body = await page.locator('body').innerText().catch(() => null);
      if (body === null) throw new Error('tab closed during model load (OOM / GPU device lost?)');
      if (body.includes('✔')) break;
      await sleep(500);
    }

    // Confirm we are actually on WebGPU and the app did not silently fall back to
    // WASM (its guard flips webgpu* -> wasm when webgpuAvailable is false).
    if (!sessionMode || !sessionMode.startsWith('webgpu')) {
      throw new Error(`expected a WebGPU session, but the app built '${sessionMode}'. Silent WASM fallback?`);
    }
    console.error(`[memcheck] session mode: ${sessionMode}`);

    // --- run the full speech, sampling the JS heap via CDP -------------------
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapUsed = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? NaN;
    };

    const samples = []; // { t, chunk, heap }
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        try { samples.push({ t: Date.now(), chunk: lastChunk, heap: await heapUsed() }); }
        catch { /* page may be mid-navigation */ }
        await sleep(args.pollMs);
      }
    })();

    console.error('[memcheck] uploading full speech, transcribing ...');
    await page.locator('#audio-file-input').setInputFiles(FULL_COMPACT_PATH);

    const historyText = page.locator('.history-text').first();
    const runDeadline = Date.now() + 40 * 60 * 1000;
    while (Date.now() < runDeadline) {
      if (crashed) { sampling = false; await sampler; throw new Error('tab crashed during transcription (OOM / GPU device lost?)'); }
      const txt = (await historyText.innerText().catch(() => '')) || '';
      if (txt && !/transcribing/i.test(txt) && chunkTotal > 0 && lastChunk >= chunkTotal) break;
      await sleep(1000);
    }
    sampling = false;
    await sampler;

    // --- verdict --------------------------------------------------------------
    const valid = samples.filter((s) => Number.isFinite(s.heap));
    if (valid.length < 6) throw new Error(`too few heap samples (${valid.length}); cannot judge growth`);
    // Compare the late third of the run against the early third (post-warmup),
    // bucketed by chunk index so the windows track progress, not wall time.
    const maxChunk = Math.max(...valid.map((s) => s.chunk), chunkTotal);
    const early = valid.filter((s) => s.chunk > 0 && s.chunk <= maxChunk / 3).map((s) => s.heap);
    const late = valid.filter((s) => s.chunk >= (2 * maxChunk) / 3).map((s) => s.heap);
    const earlyMed = median(early.length ? early : valid.map((s) => s.heap));
    const lateMed = median(late.length ? late : valid.map((s) => s.heap));
    const peak = Math.max(...valid.map((s) => s.heap));
    const ratio = lateMed / earlyMed;

    console.log('\n=== WebGPU memory-leak result ===');
    console.log(`chunks transcribed : ${lastChunk}/${chunkTotal}`);
    console.log(`heap samples       : ${valid.length}`);
    console.log(`early-run median   : ${MB(earlyMed)} MB`);
    console.log(`late-run median    : ${MB(lateMed)} MB`);
    console.log(`peak               : ${MB(peak)} MB`);
    console.log(`late/early ratio   : ${ratio.toFixed(2)} (max allowed ${args.maxGrowth})`);
    console.log(`console errors     : ${errors.length}`);
    if (errors.length) console.log(errors.map((e) => `  - ${e}`).join('\n'));

    const finished = chunkTotal > 0 && lastChunk >= chunkTotal;
    const leaked = ratio > args.maxGrowth;
    const ok = finished && !crashed && !leaked && errors.length === 0;
    console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${
      !finished ? 'transcription did not complete' :
      crashed ? 'tab crashed (OOM)' :
      leaked ? `JS heap grew ${ratio.toFixed(2)}x (> ${args.maxGrowth})` :
      errors.length ? 'console errors during run' :
      'full speech transcribed, JS heap bounded'}`);

    await cleanup();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`[memcheck] ${e.stack || e}`);
    await cleanup();
    process.exit(1);
  }
}

main();
