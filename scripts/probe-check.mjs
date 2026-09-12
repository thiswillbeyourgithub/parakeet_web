#!/usr/bin/env node
// MANUAL real-GPU check of the autoconfigure performance probe (not a test
// tier). Run it by hand on a box with a real GPU:
//
//   node scripts/probe-check.mjs                # headed (recommended)
//   node scripts/probe-check.mjs --headless     # usually has no navigator.gpu
//   node scripts/probe-check.mjs --port 4189
//
// Exit codes: 0 pass, 1 fail, 2 skip (no real GPU here, or an adapter without
// `shader-f16`, on which the app deliberately never auto-probes).
//
// WHY THIS EXISTS SEPARATELY FROM THE E2E TIER: test/e2e/perf-probe.spec.js can
// only prove the probe stays out of the way (headless CI has no GPU, so the GPU
// arm can never win there). The one thing that needs a real GPU is the verdict
// itself: does the probe actually pick the GPU on a machine where the GPU is
// genuinely faster, and does that choice reach the app? That is what this runs.
//
// It is also the tool for the question the probe was built to answer. WebGPU is
// now on app-wide and the probe decides per machine, so the useful thing to
// know is what it decides on GPUs other than the one reference box. Run it
// there, and read the verdict it prints.
//
// Built with Claude Code.

import {
  sleep, spawnAppServer, waitForServer, launchWebGpuBrowser, probeRealWebGpu,
} from './lib/browser-app.mjs';
import { PROBE_MARGIN } from '../app/ui/src/lib/perfProbe.js';

function parseArgs(argv) {
  const out = { port: 4189, headless: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const next = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--port') out.port = Number(next());
    else if (flag === '--headless') out.headless = true;
    else if (flag === '--help' || flag === '-h') out.help = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('usage: node scripts/probe-check.mjs [--port N] [--headless]');
  process.exit(0);
}

// A skip is not a failure and not a harness error, so it needs its own channel
// out of the try block. Thrown rather than process.exit()ed: an exit from inside
// the try skips the async `finally`, which is what tears the browser down and
// kills the spawned server, and would leave that server holding the port.
class Skip extends Error {}

const fail = [];
let skip = null;
const { proc, baseURL } = spawnAppServer({ port: args.port });
let browser;
let exitCode = 0;
try {
  await waitForServer(baseURL);
  browser = await launchWebGpuBrowser({ headless: args.headless });

  // 1. Does this box actually have a usable GPU? Without one there is nothing
  //    to check, and reporting a pass would be a lie. Probe from the served
  //    origin, not about:blank, which does not expose navigator.gpu here.
  const gate = await browser.newContext().then(async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(baseURL);
    const r = await probeRealWebGpu(p);
    await ctx.close();
    return r;
  });
  if (!gate.ok) throw new Skip(`no real WebGPU GPU here (${gate.reason})`);
  // A real GPU is not enough: since 2026-09-11 the app only probes where the
  // answer could be acted on, and fp16 is the only GPU precision it will ever
  // select unasked (gpuBackendAutoUsable in lib/encoderQuants.js). An adapter
  // without `shader-f16` therefore prefetches nothing, runs no probe and stores
  // no verdict, ON PURPOSE. That is a skip, not a failure: this script has
  // nothing left to measure, and asserting a verdict here would be asserting
  // the app misbehaves. (This box is exactly that case: Dawn does not expose
  // `shader-f16` on the RTX 3090 Ti even though Vulkan advertises it, so the
  // script read FAIL for two days before the gate was aligned.)
  if (!gate.shaderF16) {
    throw new Skip(`adapter has no shader-f16 (${gate.adapter}), so the app never auto-probes here`);
  }
  console.log(`GPU: ${gate.adapter} (shader-f16)`);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  const probeAssets = [];
  page.on('console', (m) => {
    const t = m.text();
    logs.push(t);
    if (t.includes('[Probe]')) console.log(`  ${t}`);
  });
  page.on('request', (r) => {
    if (r.url().includes('/probe/')) probeAssets.push(r.url().split('/').pop());
  });

  // 2. A normal page load must prefetch both artifacts at idle, so the
  //    measurement itself never waits on the network.
  console.log('\n== prefetch on load ==');
  await page.goto(baseURL);
  await page.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30_000 });
  await sleep(6000);
  console.log(`  fetched: ${probeAssets.join(', ') || 'NOTHING'}`);
  if (probeAssets.length !== 2) fail.push(`expected 2 prefetched artifacts, got ${probeAssets.length}`);

  // 3. Clicking Load model must run the probe FIRST (its verdict decides which
  //    weights get downloaded) and pause animations while it does.
  console.log('\n== probe runs on the Load model click ==');
  await page.locator('[data-umami-event="load_model_button"]').click();
  const t0 = Date.now();
  while (!logs.some((l) => l.includes('[Probe]') && l.includes('wins')) && Date.now() - t0 < 180_000) {
    await sleep(500);
  }
  const verdictLine = logs.find((l) => l.includes('[Probe]') && l.includes('wins'));
  if (!verdictLine) fail.push('the probe never produced a verdict');
  if (!logs.some((l) => l.includes('[Probe] animations paused'))) {
    // Not cosmetic: an animating page gates WebGPU callback delivery
    // process-wide, which would tax the GPU arm and understate the GPU.
    fail.push('animations were not paused during the probe');
  }

  // 4. The verdict must reach the app and be stored, WITHOUT being recorded as
  //    a human choice (that would suppress every future probe).
  console.log('\n== verdict applied and persisted ==');
  await sleep(2500);
  const read = (key) => page.evaluate((k) => new Promise((resolve) => {
    const req = indexedDB.open('parakeetweb-settings-db');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const g = db.transaction('settings-store', 'readonly').objectStore('settings-store').get(`parakeetweb_${k}`);
      g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
      g.onerror = () => { db.close(); resolve(null); };
    };
  }), key);
  const backend = await read('backend');
  const verdict = await read('perfProbeVerdict');
  const userPicked = await read('backendUserPicked');
  console.log(`  backend: ${backend} | userPicked: ${userPicked}`);
  console.log(`  verdict: ${JSON.stringify(verdict)}`);

  if (userPicked !== false) fail.push(`the probe marked the backend as user-picked (${userPicked})`);
  if (!verdict || typeof verdict !== 'object') fail.push('no verdict was persisted');
  else {
    if (verdict.backend !== backend) fail.push(`stored verdict (${verdict.backend}) and live backend (${backend}) disagree`);
    // On a box with a real GPU the expected answer is the GPU. A WASM verdict
    // is not automatically a bug (some GPUs really are slower), but it is the
    // answer worth reading closely, so say so loudly rather than passing quietly.
    if (verdict.backend === 'webgpu-hybrid') {
      console.log(`\nVERDICT: GPU wins by ${verdict.speedup.toFixed(2)}x (margin ${PROBE_MARGIN}x)`);
      if (!(verdict.speedup >= PROBE_MARGIN)) fail.push('picked the GPU below the margin');
    } else {
      console.log(`\nVERDICT: stayed on WASM (${verdict.reason || 'below margin'}, `
        + `speedup ${verdict.speedup == null ? 'n/a' : verdict.speedup.toFixed(2)}x).`);
      console.log('This box would NOT be moved to WebGPU. Worth checking by hand whether that is right.');
    }
  }

  // 5. The ?webgpu=0 kill switch must still put a visitor fully back on the
  //    CPU path: nothing fetched, nothing run, normal WASM load starts.
  console.log('\n== ?webgpu=0 kill switch ==');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const logs2 = [];
  const assets2 = [];
  page2.on('console', (m) => logs2.push(m.text()));
  page2.on('request', (r) => { if (r.url().includes('/probe/')) assets2.push(r.url()); });
  await page2.goto(`${baseURL}/?webgpu=0`);
  await page2.locator('[data-umami-event="load_model_button"]').waitFor({ timeout: 30_000 });
  await sleep(6000);
  await page2.locator('[data-umami-event="load_model_button"]').click();
  await sleep(8000);
  console.log(`  probe assets: ${assets2.length} | probe logs: ${logs2.filter((l) => l.includes('[Probe]')).length}`);
  if (assets2.length) fail.push('probe artifacts were fetched under ?webgpu=0');
  if (logs2.some((l) => l.includes('[Probe]'))) fail.push('the probe ran under ?webgpu=0');
  if (!logs2.some((l) => l.includes('[Hub]') || l.includes('[Parakeet.js]'))) {
    fail.push('the normal WASM load did not start');
  }
  await ctx2.close();
} catch (e) {
  if (e instanceof Skip) skip = e.message;
  else fail.push(`harness error: ${e?.message ?? e}`);
} finally {
  await browser?.close();
  proc.kill();
}

if (skip) {
  console.log(`\nSKIP: ${skip}`);
  exitCode = 2;
} else if (fail.length) {
  console.log(`\nFAIL\n - ${fail.join('\n - ')}`);
  exitCode = 1;
} else {
  console.log('\nPASS: the probe measured this machine and its answer reached the app.');
}
process.exit(exitCode);
