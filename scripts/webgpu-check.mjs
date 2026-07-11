#!/usr/bin/env node
// MANUAL WebGPU harness. NOT part of any test tier and NOT run in CI: the
// automated tier-3 e2e is headless Chromium, which has no WebGPU and falls back
// to WASM int8 (see CLAUDE.md). This is the deliberate exception, run BY HAND on
// a machine with a real GPU + WebGPU-capable Chromium, and it is the WebGPU
// analog of the wasm long-audio-chunking e2e. Two modes:
//
//   default ("chunk")  npm run webgpu:check
//     Feeds the committed 3 min JFK moon-speech crop (test/fixtures/
//     jfk-moon-3min.mp3) on the fp16/WebGPU path and asserts chunking engaged,
//     the transcript recovers the golden content (word-overlap), and no runaway
//     seam duplication. The WebGPU chunk test the headless tier cannot run.
//
//   --full ("memory")  npm run webgpu:memcheck
//     Transcribes the FULL ~17 min speech (downloaded + transcoded into the
//     gitignored cache) and watches the JS heap across the run for a leak. This
//     is the memory-leak test: FAIL on OOM/crash or unbounded heap growth.
//
// Both modes reuse the tier-3 plumbing unchanged so they can never drift from
// production: test/e2e/serve.mjs (UI + local weights at /models with the
// COOP/COEP headers ORT needs, which also make CDP's JS-heap metric precise
// under cross-origin isolation) and test/e2e/seed.mjs (backend 'webgpu-hybrid',
// the UI's actual WebGPU option, so resolveModelQuant picks the fp16 encoder
// fallback_models ships). Both sample the JS heap via CDP; the late/early
// growth check only applies once there are enough chunks to bucket (the full
// run), so the short chunk run leans on completion + no-OOM + content asserts.
//
// SKIPs (exit 2) when no real WebGPU GPU is present, rejecting software/
// SwiftShader fallback adapters so it never pretends to test WebGPU on a
// software rasteriser.
//
// Usage (on a GPU box):
//   npm run build --prefix app/ui            # the harness serves app/ui/dist
//   node scripts/webgpu-check.mjs            # 3 min chunk-correctness check
//   node scripts/webgpu-check.mjs --full     # full 17 min memory-leak run
//   node scripts/webgpu-check.mjs --full --headless --max-growth=1.4
//
// Built with Claude Code.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { seedSettings } from '../test/e2e/seed.mjs';
import { words, overlap } from '../test/e2e/text-overlap.mjs';
import { findFfmpeg } from './transcribe.mjs';
import { ensureFullCompact, FIXTURE_MP3, EXPECTED_TXT } from './gen-jfk-moon-fixtures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'app/ui/dist');
const SERVE = resolve(ROOT, 'test/e2e/serve.mjs');

const MIN_OVERLAP = 0.7;   // fp16 (cleaner) vs the int8 golden: most words match
const LEAK_MIN_CHUNKS = 6; // need this many chunks to bucket early/late heap

// --- args --------------------------------------------------------------------
function parseArgs(argv) {
  // Default to the bundled Playwright Chromium ('chromium'): it is always present,
  // whereas system Google Chrome ('chrome') may not be installed on a given box.
  const a = { full: false, headless: false, fp32: false, maxGrowth: 1.5, port: 4179, pollMs: 2000, channel: 'chromium' };
  // Flags that take a value, accepted as either --flag=value or --flag value.
  const takesValue = new Set(['--max-growth', '--port', '--poll-ms', '--channel']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    let k = arg, v = null;
    if (eq !== -1) {
      k = arg.slice(0, eq);
      v = arg.slice(eq + 1);
    } else if (takesValue.has(arg)) {
      v = argv[++i]; // space-separated form: consume the next token as the value
    }
    switch (k) {
      case '--full': a.full = true; break;
      case '--headless': a.headless = true; break;
      case '--fp32': a.fp32 = true; break;
      case '--max-growth': a.maxGrowth = Number(v); break;
      case '--port': a.port = Number(v); break;
      case '--poll-ms': a.pollMs = Number(v); break;
      case '--channel': a.channel = v; break; // 'chrome' (installed) | 'chromium' (bundled)
      case '-h': case '--help':
        console.log(`Usage: node scripts/webgpu-check.mjs [options]
  --full             Run the full ~17 min speech (memory-leak mode) instead of the 3 min crop
  --headless         Run headless (WebGPU is more reliable headed on a GPU box)
  --fp32             Use the fp32 WebGPU encoder instead of fp16 (needs no shader-f16;
                     the only path that runs real WebGPU compute on a Dawn build lacking it)
  --max-growth F     Max late/early JS-heap median ratio before it is a leak (default: 1.5)
  --channel C        Browser channel: 'chrome' (installed) or 'chromium' (bundled) (default: chromium)
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

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const MB = (b) => (b / 1024 / 1024).toFixed(1);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.full ? 'memory' : 'chunk';
  const baseURL = `http://127.0.0.1:${args.port}`;

  if (!existsSync(DIST)) {
    console.error(`[webgpu-check] ${DIST} missing. Run: npm run build --prefix app/ui`);
    process.exit(1);
  }

  // Pick the audio. Chunk mode uses the committed crop (no network); memory mode
  // ensures the full speech exists (downloads + transcodes on first run).
  let audio, golden = null;
  if (mode === 'chunk') {
    audio = FIXTURE_MP3;
    golden = readFileSync(EXPECTED_TXT, 'utf-8').trim();
  } else {
    audio = ensureFullCompact(findFfmpeg());
  }
  console.error(`[webgpu-check] mode=${mode} audio=${audio}`);

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
    let sessionMode = null;        // "[Parakeet.js] Creating ONNX sessions with execution mode '...'"
    let lastChunk = 0, chunkTotal = 0;
    let pipelineEngaged = false;   // saw App.jsx's "[Decode] pipeline engaged" marker
    let stageSplit = null;         // App.jsx's "[Transcribe] Stage split: ..." line
    let totalTimeLine = null;      // App.jsx's "[Transcribe] Total time for entire audio: ..."
    const debug = !!process.env.WEBGPU_DEBUG; // forward all page console to stderr
    // Benign console noise to ignore, all by-design and not failures:
    //  - "Failed to load resource ... 404": with local source, hub.js HEAD-probes
    //    candidate weights that may not exist locally (decoder fp16/fp32 sidecars),
    //    and serve.mjs does not ship the optional runtime /config.js. Each miss is
    //    logged as a 404 console error.
    //  - the /config.js 404 is served as an HTML error page, so the browser's
    //    attempt to parse it as a script raises a "Unexpected token '<'" pageerror.
    //  - ORT's "VerifyEachNodeIsAssignedToAnEp" is a W:onnxruntime WARNING (routed
    //    to console.error by ort-web) emitted on EVERY webgpu-HYBRID session: hybrid
    //    deliberately runs some nodes (shape ops, the joiner) on CPU, so a partial
    //    EP assignment is the expected, healthy state, not an error.
    const benign = (t) => (
      /Failed to load resource.*\b404\b/i.test(t)
      || /Unexpected token '<'/.test(t)
      || /VerifyEachNodeIsAssignedToAnEp|Some nodes were not assigned to the preferred execution providers|Rerunning with verbose output/.test(t)
    );
    page.on('console', (m) => {
      const txt = m.text();
      if (debug) console.error(`  [page:${m.type()}] ${txt}`);
      if (m.type() === 'error' && !benign(txt)) errors.push(txt);
      const md = /Creating ONNX sessions with execution mode '([^']+)'/.exec(txt);
      if (md) sessionMode = md[1];
      const hit = /\[Transcribe\] Completed chunk (\d+)\/(\d+)/.exec(txt);
      if (hit) { lastChunk = Number(hit[1]); chunkTotal = Number(hit[2]); }
      if (txt.includes('[Decode] pipeline engaged')) pipelineEngaged = true;
      const st = /\[Transcribe\] Stage split: (encode [\d.]+s, decode [\d.]+s \| pipeline overlap ceiling ~[\d.]+s.*)/.exec(txt);
      if (st) stageSplit = st[1];
      const tt = /\[Transcribe\] Total time for entire audio: ([^(]+\(proc_t\/dur_t [\d.]+\))/.exec(txt);
      if (tt) totalTimeLine = tt[1].trim();
    });
    page.on('pageerror', (e) => { if (!benign(e.message)) errors.push(`pageerror: ${e.message}`); });
    page.on('crash', () => { crashed = true; });

    // Force the LOCAL model source (serve.mjs /models), which is where the fp16
    // weights live: the upstream HF repo ships no encoder-model.fp16.onnx, so on
    // 'hf' the app falls back to the 2.4 GB fp32 encoder. modelSource is a CONFIG
    // value the docker entrypoint writes into window.__CONFIG__ (NOT a settings-DB
    // key), so we inject it the same way before any app script runs. With local
    // source, hub.js HEAD-probes /models and resolves the fp16 encoder.
    await page.addInitScript(() => { window.__CONFIG__ = { VITE_MODEL_SOURCE: 'local' }; });

    await page.goto(baseURL);

    // Hard gate: a REAL WebGPU adapter, else SKIP. Chromium with
    // --enable-unsafe-webgpu hands out a software (SwiftShader/lavapipe) adapter
    // on a GPU-less box; that is useless for a GPU test (and OOMs loading the
    // 1.2 GB fp16 model), so reject fallback/software adapters too.
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
      console.error(`[webgpu-check] SKIP: no real WebGPU GPU (${gpu.reason}). Run on a box with a GPU + WebGPU-capable Chromium.`);
      await cleanup();
      process.exit(2);
    }
    console.error(`[webgpu-check] WebGPU adapter: ${gpu.adapter || 'unknown'}`);

    // --fp32 forces the fp32 WebGPU encoder. fp32 needs no shader-f16 (the one
    // WebGPU feature this box's Dawn build does not expose), so it is the only
    // in-harness way to exercise the real WebGPU compute path here, and it is
    // what makes the decode-worker pipeline observable end to end.
    const quant = args.fp32 ? 'fp32' : 'fp16';
    await seedSettings(page, { backend: 'webgpu-hybrid', webgpuEncoderQuant: quant });
    await page.reload();

    console.error(`[webgpu-check] loading model on WebGPU (${quant}) ...`);
    await page.locator('[data-umami-event="load_model_button"]').click();
    const loadDeadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < loadDeadline) {
      if (crashed) throw new Error('tab crashed during model load (OOM?)');
      const body = await page.locator('body').innerText().catch(() => null);
      if (body === null) throw new Error('tab closed during model load (OOM / GPU device lost?)');
      if (body.includes('✔')) break;
      await sleep(500);
    }

    // Confirm WebGPU, not a silent WASM fallback (the app flips webgpu* -> wasm
    // when webgpuAvailable is false).
    if (!sessionMode || !sessionMode.startsWith('webgpu')) {
      throw new Error(`expected a WebGPU session, but the app built '${sessionMode}'. Silent WASM fallback?`);
    }
    console.error(`[webgpu-check] session mode: ${sessionMode}`);

    // --- run, sampling the JS heap via CDP -----------------------------------
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

    console.error('[webgpu-check] uploading audio, transcribing ...');
    await page.locator('#audio-file-input').setInputFiles(audio);

    const historyText = page.locator('.history-text').first();
    const runDeadline = Date.now() + (mode === 'memory' ? 40 : 15) * 60 * 1000;
    while (Date.now() < runDeadline) {
      if (crashed) { sampling = false; await sampler; throw new Error('tab crashed during transcription (OOM / GPU device lost?)'); }
      const txt = (await historyText.innerText().catch(() => '')) || '';
      if (txt && !/transcribing/i.test(txt) && chunkTotal > 0 && lastChunk >= chunkTotal) break;
      await sleep(1000);
    }
    sampling = false;
    await sampler;
    const transcript = ((await historyText.innerText().catch(() => '')) || '').trim();

    // --- heap analysis (always reported; leak ratio only with enough chunks) --
    const valid = samples.filter((s) => Number.isFinite(s.heap));
    const maxChunk = Math.max(chunkTotal, ...valid.map((s) => s.chunk), 0);
    const peak = valid.length ? Math.max(...valid.map((s) => s.heap)) : NaN;
    let ratio = NaN, earlyMed = NaN, lateMed = NaN, leaked = false;
    const canJudgeLeak = maxChunk >= LEAK_MIN_CHUNKS && valid.length >= LEAK_MIN_CHUNKS;
    if (canJudgeLeak) {
      const early = valid.filter((s) => s.chunk > 0 && s.chunk <= maxChunk / 3).map((s) => s.heap);
      const late = valid.filter((s) => s.chunk >= (2 * maxChunk) / 3).map((s) => s.heap);
      earlyMed = median(early.length ? early : valid.map((s) => s.heap));
      lateMed = median(late.length ? late : valid.map((s) => s.heap));
      ratio = lateMed / earlyMed;
      leaked = ratio > args.maxGrowth;
    }

    // --- content checks (chunk mode) -----------------------------------------
    const finished = chunkTotal > 0 && lastChunk >= chunkTotal;
    const contentChecks = [];
    if (mode === 'chunk') {
      const o = overlap(words(golden), words(transcript));
      const gotN = words(transcript).length, goldN = words(golden).length;
      contentChecks.push({ name: 'chunking engaged (>=2)', ok: chunkTotal >= 2, detail: `total=${chunkTotal}` });
      contentChecks.push({ name: `content overlap (>=${MIN_OVERLAP})`, ok: o >= MIN_OVERLAP, detail: o.toFixed(2) });
      contentChecks.push({ name: 'no runaway duplication', ok: gotN <= goldN * 1.5, detail: `${gotN} words vs golden ${goldN}` });
      // The decode-worker pipeline (GPU encode overlapping WASM decode) engages
      // on any WebGPU multi-chunk run; assert the marker so a green run proves
      // the worker path ran rather than silently falling through to in-thread.
      contentChecks.push({ name: 'decode-worker pipeline engaged', ok: pipelineEngaged, detail: pipelineEngaged ? 'yes' : 'NOT engaged (fell through to in-thread?)' });
    } else {
      contentChecks.push({ name: `chunking engaged (>=${LEAK_MIN_CHUNKS})`, ok: chunkTotal >= LEAK_MIN_CHUNKS, detail: `total=${chunkTotal}` });
    }

    // --- verdict --------------------------------------------------------------
    console.log(`\n=== WebGPU ${mode} result ===`);
    console.log(`chunks transcribed : ${lastChunk}/${chunkTotal}`);
    if (totalTimeLine) console.log(`wall time          : ${totalTimeLine}`);
    if (stageSplit) console.log(`${stageSplit}`);
    console.log(`heap samples       : ${valid.length}`);
    if (canJudgeLeak) {
      console.log(`early-run median   : ${MB(earlyMed)} MB`);
      console.log(`late-run median    : ${MB(lateMed)} MB`);
      console.log(`late/early ratio   : ${ratio.toFixed(2)} (max allowed ${args.maxGrowth})`);
    } else {
      console.log(`leak ratio         : n/a (need >=${LEAK_MIN_CHUNKS} chunks; got ${maxChunk})`);
    }
    console.log(`peak heap          : ${MB(peak)} MB`);
    for (const c of contentChecks) console.log(`${c.ok ? 'ok ' : 'XX '}${c.name}: ${c.detail}`);
    console.log(`console errors     : ${errors.length}`);
    if (errors.length) console.log(errors.map((e) => `  - ${e}`).join('\n'));

    const reasons = [];
    if (!finished) reasons.push('transcription did not complete');
    if (crashed) reasons.push('tab crashed (OOM)');
    if (leaked) reasons.push(`JS heap grew ${ratio.toFixed(2)}x (> ${args.maxGrowth})`);
    if (errors.length) reasons.push('console errors during run');
    for (const c of contentChecks) if (!c.ok) reasons.push(`failed: ${c.name} (${c.detail})`);
    const ok = reasons.length === 0;
    console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${ok ? `${mode} mode OK on WebGPU` : reasons.join('; ')}`);

    await cleanup();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`[webgpu-check] ${e.stack || e}`);
    await cleanup();
    process.exit(1);
  }
}

main();
