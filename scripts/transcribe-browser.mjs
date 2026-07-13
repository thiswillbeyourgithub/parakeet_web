#!/usr/bin/env node
// Browser-driving transcription harness: runs the REAL web app in a headed,
// WebGPU-enabled Chromium (Playwright) and automates it end to end, so you get
// the exact production path the browser users hit -- real WebGPU compute on the
// GPU, the fp32 encoder (via shards), the MAES beam decoder, AND speaker
// diarization -- from a single terminal command, then saves the result as
// Markdown.
//
// This exists because scripts/transcribe.mjs (the pure-Node CLI) CANNOT do two
// things this needs: (1) WebGPU is a browser API with no Node equivalent (Node's
// onnxruntime-web is WASM/CPU only; the closest is the CUDA EP), and (2) speaker
// diarization lives entirely in the browser app (the sherpa-onnx WASM engine +
// the pyannote/CAM++ models, driven by diarizer.js). Driving the actual app in a
// browser gives BOTH for free, with zero re-implementation and no drift from
// what users see.
//
// It reuses the tier-3 e2e plumbing unchanged (test/e2e/serve.mjs serves the
// built UI + local /models weights with the COOP/COEP headers ORT needs;
// test/e2e/seed.mjs seeds the settings DB) via scripts/lib/browser-app.mjs, the
// same machinery scripts/webgpu-check.mjs uses, so this can never diverge from
// production behaviour.
//
// Requires a BUILT app (app/ui/dist): run `npm run build --prefix app/ui` first.
// The fp32 WebGPU encoder needs the sharded weights served locally
// (fallback_models/sharded/encoder-model.onnx.data.NNN); diarization needs the
// two models served at /models (fallback_models, fetched by `npm run e2e:models`
// or already present). On this repo's box both are present.
//
// Example (matches the "WebGPU fp32, beam 5, no boost, 2 speakers, .md" recipe):
//   node scripts/transcribe-browser.mjs recording.ogg
//   node scripts/transcribe-browser.mjs recording.ogg -w 5 -n 2 -o out.md
//   node scripts/transcribe-browser.mjs recording.ogg --no-diarize --quant int8
//
// Built with Claude Code.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';

import {
  ROOT, sleep, waitForServer, spawnAppServer, launchWebGpuBrowser,
  bootApp, loadModelAndWaitReady, probeRealWebGpu, seedSettings,
} from './lib/browser-app.mjs';

// The app's on-mount WebGPU probe (navigator.gpu.requestAdapter) resolves in
// well under a second; give it a comfortable margin to settle so it never races
// our gate probe or the model load into a false negative.
const WEBGPU_SETTLE_MS = 1500;

const DIST = resolve(ROOT, 'app/ui/dist');

// --- arg parsing (pure, exported for unit tests) --------------------------
// Defaults are tuned to the high-quality WebGPU use case: fp32 encoder on the
// GPU, MAES beam width 5, phrase boosting OFF (nothing seeded), and 2-speaker
// diarization. Override any of them with flags.
export function parseArgs(argv) {
  const a = {
    audio: null,
    out: null,               // default derived from the audio basename
    backend: 'webgpu-hybrid', // the app's user-selectable WebGPU backend
    quant: 'fp32',           // WebGPU encoder quant (fp32 needs no shader-f16)
    beamWidth: 5,            // MAES beam width (1 = greedy)
    diarize: true,           // run speaker diarization
    numSpeakers: 2,          // forced speaker count (0 = auto-detect)
    lang: 'en',              // seed UI language so control text matches
    headless: false,        // headed is more reliable for real WebGPU
    channel: 'chromium',    // bundled Playwright browser (always present)
    port: 4180,             // avoid clashing with e2e (4178) / webgpu-check (4179)
    modelDir: null,         // override the served weights dir
    timeoutMin: 120,        // overall transcription timeout
    keepOpen: false,        // leave the browser open after finishing
  };
  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${name}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inlineVal = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = (name) => { if (inlineVal !== null) return inlineVal; i++; return need(i - 1, name); };
    switch (flag) {
      case '-h': case '--help': a.help = true; break;
      case '-o': case '--out': a.out = val(flag); break;
      case '--backend': a.backend = val(flag); break;
      case '--quant': a.quant = val(flag); break;
      case '-w': case '--beam-width': a.beamWidth = parseInt(val(flag), 10); break;
      case '-n': case '--num-speakers': a.numSpeakers = parseInt(val(flag), 10); break;
      case '--no-diarize': a.diarize = false; break;
      case '--lang': a.lang = val(flag); break;
      case '--headless': a.headless = true; break;
      case '--channel': a.channel = val(flag); break;
      case '--port': a.port = parseInt(val(flag), 10); break;
      case '--model-dir': a.modelDir = val(flag); break;
      case '--timeout-min': a.timeoutMin = Number(val(flag)); break;
      case '--keep-open': a.keepOpen = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (a.audio) throw new Error(`Unexpected extra argument: ${arg}`);
        a.audio = arg;
    }
  }
  if (a.help) return a;
  if (!a.audio) throw new Error('No audio file given. See --help.');
  if (a.backend !== 'webgpu-hybrid' && a.backend !== 'wasm') {
    throw new Error(`--backend must be webgpu-hybrid or wasm (got ${a.backend})`);
  }
  if (a.quant !== 'fp32' && a.quant !== 'fp16' && a.quant !== 'int8') {
    throw new Error(`--quant must be fp32, fp16 or int8 (got ${a.quant})`);
  }
  if (!Number.isInteger(a.beamWidth) || a.beamWidth < 1 || a.beamWidth > 10) {
    throw new Error('--beam-width must be an integer in [1, 10] (the UI cap)');
  }
  if (!Number.isInteger(a.numSpeakers) || a.numSpeakers < 0 || a.numSpeakers > 10) {
    throw new Error('--num-speakers must be an integer in [0, 10] (0 = auto)');
  }
  if (!Number.isFinite(a.timeoutMin) || a.timeoutMin <= 0) {
    throw new Error('--timeout-min must be a positive number');
  }
  if (!a.out) a.out = defaultOutPath(a.audio);
  return a;
}

// Default .md path: the audio file with its extension swapped for .md.
export function defaultOutPath(audio) {
  const ext = extname(audio);
  return (ext ? audio.slice(0, -ext.length) : audio) + '.md';
}

// --- Markdown building (pure, exported for unit tests) --------------------
// Render diarized turns as `**Speaker:** text` blocks. Empty-text turns are
// dropped; consecutive turns are blank-line separated so the .md reads cleanly.
export function turnsToMarkdown(turns) {
  return turns
    .filter((t) => t && t.text)
    .map((t) => `**${(t.speaker || 'Speaker').trim()}:** ${t.text.trim()}`)
    .join('\n\n');
}

// Assemble the full Markdown document: a small front-matter-ish header (source,
// settings, provenance) followed by the transcript body.
export function buildMarkdown({ audio, backend, quant, beamWidth, numSpeakers, diarized, generatedAt }, body) {
  const name = basename(audio);
  const title = name.replace(/\.[^.]+$/, '');
  const speakersLine = diarized
    ? `- Speakers: ${numSpeakers > 0 ? numSpeakers : 'auto'} (diarized)`
    : '- Speakers: not diarized';
  const header = [
    `# Transcript: ${title}`,
    '',
    `- Source: ${name}`,
    `- Backend: ${backend} (encoder ${quant}), beam width ${beamWidth}, no phrase boost`,
    speakersLine,
    `- Transcribed: ${generatedAt}`,
    '- Generated with Claude Code (Parakeet Web browser harness)',
    '',
  ].join('\n');
  return `${header}\n${body}\n`;
}

function printHelp() {
  console.log(`Transcribe an audio file by driving the REAL web app in a WebGPU browser.

Usage:
  node scripts/transcribe-browser.mjs <audio> [options]

Runs the built app (app/ui/dist) in a headed, WebGPU-enabled Chromium, loads the
model, transcribes <audio>, optionally diarizes it into N speakers, and writes
the result as Markdown. Requires a prior build: npm run build --prefix app/ui

Arguments:
  <audio>                 Path to an audio file (any format the app can decode).

Options:
  -o, --out FILE          Output .md path. Default: <audio> with a .md extension.
  -w, --beam-width N      MAES beam width, integer [1, 10]. 1 = greedy. Default 5.
  -n, --num-speakers N    Force N speakers for diarization, [0, 10]. 0 = auto.
                          Default 2. Ignored with --no-diarize.
      --no-diarize        Skip speaker diarization; write the plain transcript.
      --backend B         webgpu-hybrid (default, real GPU) or wasm (CPU).
      --quant Q           WebGPU encoder quant: fp32 (default), fp16 or int8.
                          fp16 needs the shader-f16 GPU feature (this box lacks
                          it, so fp16 transcribes empty here; use fp32 or int8).
      --lang L            Seed the UI language (default en) so control text matches.
      --headless          Run headless (WebGPU is more reliable headed on a GPU box).
      --channel C         Browser build: chromium (default) or chrome.
      --port N            Static-server port. Default 4180.
      --model-dir DIR     Weights dir to serve at /models. Default ./fallback_models.
      --timeout-min N     Overall transcription timeout, minutes. Default 120.
      --keep-open         Leave the browser open after finishing (for inspection).
  -h, --help              Show this help.
`);
}

// --- main -----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const audioPath = resolve(args.audio);
  if (!existsSync(audioPath)) throw new Error(`audio file not found: ${audioPath}`);
  if (!existsSync(resolve(DIST, 'index.html'))) {
    throw new Error(`built app missing at ${DIST}. Build it first: npm run build --prefix app/ui`);
  }

  const { proc: serve, baseURL } = spawnAppServer({ port: args.port, modelDir: args.modelDir });
  let browser;
  const cleanup = async () => {
    if (!args.keepOpen) { try { await browser?.close(); } catch { /* ignore */ } }
    try { serve.kill('SIGTERM'); } catch { /* ignore */ }
  };

  // Console plumbing: capture the session mode (to prove WebGPU, not a silent
  // WASM fallback), the completion marker, chunk progress, and real errors.
  // NOTE: on webgpu-hybrid the app builds MORE than one ONNX session and each
  // logs its own mode: the encoder on 'webgpu-hybrid', then (right after the
  // model is ready) initDecodeWorker builds a decode-only session on 'wasm'.
  // So the LAST "Creating ONNX sessions" line is legitimately 'wasm' and must
  // NOT be read as a fallback. We latch `sawWebGpuSession` on ANY webgpu-mode
  // session (i.e. the encoder ran on the GPU); a genuine silent fallback builds
  // the encoder itself on wasm and never latches it.
  let sessionMode = null;
  let sawWebGpuSession = false;
  let transcribeDone = false;
  let crashed = false;
  let lastChunk = 0, chunkTotal = 0;
  const errors = [];
  const debug = !!process.env.BROWSER_DEBUG;
  // Benign console noise (same set webgpu-check.mjs ignores): local 404 HEAD
  // probes for optional weights, the /config.js SPA-fallback parse error, and
  // ORT's expected partial-EP-assignment warning on every webgpu-hybrid session.
  const benign = (t) => (
    /Failed to load resource.*\b404\b/i.test(t)
    || /Unexpected token '<'/.test(t)
    || /VerifyEachNodeIsAssignedToAnEp|Some nodes were not assigned preferred execution providers|Rerunning with verbose output/.test(t)
  );

  try {
    await waitForServer(baseURL);
    browser = await launchWebGpuBrowser({ headless: args.headless, channel: args.channel });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (m) => {
      const txt = m.text();
      if (debug) console.error(`  [page:${m.type()}] ${txt}`);
      if (m.type() === 'error' && !benign(txt)) errors.push(txt);
      const sm = /Creating ONNX sessions with execution mode '([^']+)'/.exec(txt);
      if (sm) { sessionMode = sm[1]; if (sm[1].startsWith('webgpu')) sawWebGpuSession = true; }
      const ch = /chunk (\d+)\/(\d+)/.exec(txt);
      if (ch) { lastChunk = Number(ch[1]); chunkTotal = Number(ch[2]); }
      if (txt.includes('[Transcribe] Total time for entire audio')) transcribeDone = true;
    });
    page.on('pageerror', (e) => { if (!benign(e.message)) errors.push(`pageerror: ${e.message}`); });
    page.on('crash', () => { crashed = true; });

    // Boot the app on the requested backend/quant, beam width, and language.
    const settings = {
      backend: args.backend,
      webgpuEncoderQuant: args.quant,
      beamWidth: args.beamWidth,
      lang: args.lang,
    };
    const wantWebgpu = args.backend.startsWith('webgpu');
    await bootApp(page, { baseURL, settings });

    // Let the app's OWN on-mount WebGPU probe (navigator.gpu.requestAdapter)
    // resolve BEFORE we touch WebGPU. This ordering matters: if our gate probe
    // (or the model load) fires a concurrent requestAdapter, under
    // --enable-unsafe-webgpu the app's probe can transiently come back null ->
    // webgpuAvailable=false -> App.jsx flips the seeded webgpu-hybrid backend to
    // a WASM fallback. Settling first lets it resolve true, alone, so it never
    // flips.
    if (wantWebgpu) await sleep(WEBGPU_SETTLE_MS);

    // Hard gate: for a WebGPU backend, require a REAL GPU adapter (fail fast on
    // a GPU-less box). Runs after the settle above, so it can't race the app.
    if (wantWebgpu) {
      const gpu = await probeRealWebGpu(page);
      if (!gpu.ok) {
        throw new Error(
          `no real WebGPU GPU adapter (${gpu.reason}). Use --backend wasm for a CPU run, `
          + `or run on a machine with a WebGPU-capable GPU.`);
      }
      console.error(`[transcribe-browser] WebGPU adapter: ${gpu.adapter}`);
    }

    // Load the model, retrying if the app still built a WASM session for a
    // WebGPU request. Two things defeat a naive retry, so each attempt handles
    // both: (1) a WebGPU->WASM fallback is PERSISTED to IndexedDB (App.jsx
    // saveSetting('backend', ...)), so we RE-SEED the requested backend before
    // reloading, else every retry rebuilds WASM; (2) the fresh reload must
    // re-probe the GPU with no concurrent probe, so we settle again before
    // loading. We gate on `sawWebGpuSession` (the ENCODER built on the GPU), NOT
    // the last session log: webgpu-hybrid also builds a WASM joiner + WASM
    // decode worker, so the final "Creating ONNX sessions" line is legitimately
    // 'wasm'.
    const MAX_LOAD_ATTEMPTS = 4;
    for (let attempt = 1; ; attempt += 1) {
      if (attempt > 1) {
        // Undo the persisted WASM fallback and re-probe cleanly.
        await seedSettings(page, settings);
        await page.reload();
        if (wantWebgpu) await sleep(WEBGPU_SETTLE_MS);
      }
      sessionMode = null;
      sawWebGpuSession = false;
      const tag = attempt > 1 ? ` (attempt ${attempt}/${MAX_LOAD_ATTEMPTS})` : '';
      console.error(`[transcribe-browser] loading model (${args.backend}, ${args.quant})${tag} ...`);
      await loadModelAndWaitReady(page, { timeoutMs: 8 * 60 * 1000 });
      if (crashed) throw new Error('tab crashed during model load (OOM / GPU device lost?)');
      // A WASM run (as requested) or a satisfied WebGPU request is done.
      if (!wantWebgpu || sawWebGpuSession) break;
      if (attempt >= MAX_LOAD_ATTEMPTS) {
        throw new Error(`app kept building a '${sessionMode}' session instead of WebGPU after `
          + `${attempt} attempts (WebGPU adapter probe flake). The GPU probed OK, so re-run, `
          + `or pass --backend wasm to run on CPU.`);
      }
      console.error(`[transcribe-browser] app fell back to '${sessionMode}'; re-seeding webgpu backend and retrying ...`);
    }
    console.error(`[transcribe-browser] session mode: ${sessionMode}`);

    // Upload the clip; the app transcribes an upload immediately.
    console.error(`[transcribe-browser] transcribing ${basename(audioPath)} (this can take a while) ...`);
    await page.locator('#audio-file-input').setInputFiles(audioPath);

    const deadline = Date.now() + args.timeoutMin * 60 * 1000;
    while (Date.now() < deadline) {
      if (crashed) throw new Error('tab crashed during transcription (OOM / GPU device lost?)');
      const alive = await page.locator('body').innerText().catch(() => null);
      if (alive === null) throw new Error('tab closed during transcription (OOM / GPU device lost?)');
      if (transcribeDone) break;
      await sleep(1000);
    }
    if (!transcribeDone) throw new Error(`transcription did not finish within ${args.timeoutMin} min`);
    console.error(`[transcribe-browser] transcription complete (${chunkTotal || 1} chunk(s))`);

    // Capture the plain transcript BEFORE diarizing (diarizing swaps the view).
    const historyText = page.locator('.history-text').first();
    await historyText.waitFor({ state: 'visible', timeout: 60 * 1000 });
    const plain = ((await historyText.innerText().catch(() => '')) || '').trim();

    let body = plain;
    let diarized = false;
    if (args.diarize) {
      console.error(`[transcribe-browser] diarizing (${args.numSpeakers > 0 ? args.numSpeakers + ' speakers' : 'auto'}) ...`);
      // Force the speaker count from the entry kebab: selecting it calls
      // diarizeEntry(trans, n), which loads the diarization models, runs ONE
      // segmentation pass, and switches the entry into the diarized view.
      await page.getByRole('button', { name: 'More actions' }).first().click();
      const select = page.locator('.kebab-speakers select').first();
      await select.waitFor({ state: 'visible', timeout: 30 * 1000 });
      await select.selectOption(String(args.numSpeakers));
      // Diarization renders .diar-turns only once it completes (single render),
      // so the first turn appearing is the done signal.
      const firstTurn = page.locator('.diar-turns .diar-turn').first();
      await firstTurn.waitFor({ state: 'visible', timeout: args.timeoutMin * 60 * 1000 });
      // Let the turn list settle (all turns rendered) before scraping.
      await sleep(1000);
      const turns = await page.$$eval('.diar-turns .diar-turn', (nodes) => nodes.map((n) => ({
        speaker: (n.querySelector('.diar-speaker-label')?.innerText
          || n.querySelector('.diar-speaker-input')?.value || '').trim(),
        text: (n.querySelector('.diar-turn-text')?.innerText || '').trim(),
      })));
      if (!turns.length) throw new Error('diarization produced no speaker turns');
      body = turnsToMarkdown(turns);
      diarized = true;
      const speakers = new Set(turns.map((t) => t.speaker));
      console.error(`[transcribe-browser] diarized into ${turns.length} turn(s), ${speakers.size} speaker(s)`);
    }

    if (errors.length) {
      console.error(`[transcribe-browser] WARNING: ${errors.length} page console error(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }

    const md = buildMarkdown({
      audio: audioPath,
      backend: args.backend,
      quant: args.quant,
      beamWidth: args.beamWidth,
      numSpeakers: args.numSpeakers,
      diarized,
      generatedAt: new Date().toISOString(),
    }, body);
    const outPath = resolve(args.out);
    await writeFile(outPath, md, 'utf-8');
    console.error(`[transcribe-browser] wrote ${outPath} (${md.length} bytes)`);
    console.log(outPath);
  } finally {
    if (args.keepOpen) {
      console.error('[transcribe-browser] --keep-open: leaving the browser open. Ctrl-C to exit.');
    } else {
      await cleanup();
    }
  }
}

// Only run when executed directly, not when imported for the exported helpers.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`\n[transcribe-browser] error: ${e.message}`);
    process.exit(1);
  });
}
