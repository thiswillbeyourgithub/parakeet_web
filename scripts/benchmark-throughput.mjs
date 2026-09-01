#!/usr/bin/env node
// Drives the app's own sidebar Benchmark section from the CLI, for one model
// directory and a chosen set of backend/quant rows, and prints the throughput
// numbers it produces (RTF, load time, encode/decode split).
//
// The app already measures throughput correctly, through the paths a user
// actually gets (app/ui/src/lib/benchmark.js); what was missing is a way to
// point it at an arbitrary model directory and compare execution providers in
// one command. test/e2e/benchmark-section.spec.js drives the same UI but is a
// test: it is headless-only (so no WebGPU row can ever appear) and asserts a
// single wasm:int8 row.
//
// WebGPU needs a headed browser with a real adapter, so --combos containing a
// webgpu row implies headed Chromium (override with --headless to see it fail).
//
// Usage:
//   node scripts/benchmark-throughput.mjs --model-dir <dir> [options]
//     --combos wasm:int8,webgpu-hybrid:fp32   rows to run (default wasm:int8)
//     --repeats N        timed repeats per row, medianed by the app (default 1)
//     --long             90s tiled profile instead of the 11s clip
//     --label NAME       label for the printed table and the JSON
//     --json PATH        write the full report JSON here
//     --port N           app server port (default 4181)
//     --headless/--headed
//
// Written with Claude Code.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expandSettingsSection } from '../test/e2e/seed.mjs';
import {
  ROOT, bootApp, launchWebGpuBrowser, probeRealWebGpu, spawnAppServer, waitForServer,
} from './lib/browser-app.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const modelDir = flag('model-dir');
if (!modelDir) {
  console.error('--model-dir is required');
  process.exit(2);
}
const combos = (flag('combos', 'wasm:int8')).split(',').map((s) => s.trim()).filter(Boolean);
const repeats = Number(flag('repeats', '1'));
const port = Number(flag('port', '4181'));
const label = flag('label', modelDir.split('/').filter(Boolean).pop());
const jsonOut = flag('json');
const wantsGpu = combos.some((c) => c.startsWith('webgpu'));
const headless = has('headless') ? true : has('headed') ? false : !wantsGpu;

const baseURL = `http://127.0.0.1:${port}`;
const server = spawnAppServer({ port, modelDir: resolve(modelDir) });
let browser;
try {
  await waitForServer(baseURL);
  browser = await launchWebGpuBrowser({ headless });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[browser:error] ${m.text()}`);
    else if (process.env.BENCH_DEBUG_CONSOLE) console.log(`[browser:${m.type()}] ${m.text()}`);
  });

  await bootApp(page, { baseURL, settings: { beamWidth: 1 } });
  if (wantsGpu) {
    const gpu = await probeRealWebGpu(page);
    console.log(`[gpu] adapter: ${JSON.stringify(gpu)}`);
  }

  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Benchmark');

  // Take the plan as the app computed it for this device, then select exactly
  // the requested rows: a row the planner did not offer cannot be run here.
  const planned = await page.locator('input[name^="benchmark-combo-"]').evaluateAll(
    (els) => els.map((e) => e.name.replace('benchmark-combo-', '')),
  );
  console.log(`[plan] device offers: ${planned.join(', ') || '(none)'}`);
  const missing = combos.filter((c) => !planned.includes(c));
  if (missing.length) throw new Error(`requested rows not planned on this device: ${missing.join(', ')}`);

  for (const name of planned) {
    const box = page.locator(`input[name="benchmark-combo-${name}"]`);
    const want = combos.includes(name);
    if (await box.isChecked() !== want) await box.click();
  }
  if (repeats > 1) await page.locator('input[name="benchmarkRepeats"]').fill(String(repeats));
  if (has('long')) {
    const long = page.locator('input[name="benchmarkLongProfile"]');
    if (!await long.isChecked()) await long.click();
  }

  console.log(`[run] ${label}: ${combos.join(' + ')} (repeats ${repeats}, ${has('long') ? 'long' : 'short'} profile)`);
  const started = Date.now();
  await page.locator('[data-umami-event="benchmark_run"]').click();

  const textarea = page.locator('.benchmark-report-text');
  const budgetMs = (8 + 8 * combos.length * repeats) * 60 * 1000;
  await textarea.waitFor({ state: 'visible', timeout: budgetMs });
  await page.waitForFunction(
    () => (document.querySelector('.benchmark-report-text')?.value || '').includes('parakeetweb-benchmark-report'),
    null, { timeout: budgetMs },
  );
  const report = JSON.parse(await textarea.inputValue());
  console.log(`[run] finished in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

  const num = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '-');
  console.log(`model: ${label}`);
  console.log('row                    status   audio_s  load_s  wall_s     RTF  x_realtime  encode_s  decode_s  sim');
  for (const r of report.results) {
    const rtf = typeof r.rtf === 'number' ? r.rtf : null;
    console.log(
      `${r.id.padEnd(22)} ${String(r.status).padEnd(8)} ${num(r.audioSec, 1).padStart(7)} `
      + `${num(r.loadMs / 1000, 1).padStart(6)} ${num(r.wallMs / 1000, 1).padStart(7)} `
      + `${num(rtf, 3).padStart(7)} ${(rtf ? (1 / rtf).toFixed(2) : '-').padStart(11)} `
      + `${num(r.metrics?.encode_ms / 1000, 1).padStart(9)} ${num(r.metrics?.decode_ms / 1000, 1).padStart(9)} `
      + `${num(r.similarity, 2).padStart(5)}`,
    );
    if (r.status !== 'ok') console.log(`  error: ${JSON.stringify(r.error)}`);
  }
  const env = report.environment || {};
  console.log(`\nthreads ${env.ort?.wasm?.numThreads}, cores ${env.hardware?.hardwareConcurrency}, `
    + `gpu ${env.webgpu ? JSON.stringify(env.webgpu.adapter || env.webgpu) : 'none'}`);

  if (jsonOut) {
    writeFileSync(resolve(jsonOut), JSON.stringify({ label, modelDir, combos, repeats, report }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
  process.exitCode = report.results.every((r) => r.status === 'ok') ? 0 : 1;
} finally {
  await browser?.close();
  server.proc.kill();
}
