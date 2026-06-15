#!/usr/bin/env node
// WER bench for comparing encoder quantisations at different chunk windows. It
// was built to answer one question: does fp16 hold up on a long (>20 s) chunk
// where the STOCK int8 encoder silently dropped content? (The SmoothQuant int8
// this app now ships no longer shows that drop; this bench still lets you A/B any
// encoder across chunk windows.)
//
// fp16 is the candidate middle ground (~1.2 GB, near-lossless), but it cannot load
// on the WASM backend (the CPU/WASM EP upcasts fp16->fp32 and overflows the 32-bit
// heap), so this bench runs on the NATIVE onnxruntime-node backend (--ort node),
// which loads fp16/fp32 fine and is a faithful proxy for fp16 *quality*. By default
// it runs on the CPU; pass --cuda (or --ort cuda) to run on an NVIDIA GPU via the
// onnxruntime-node CUDA EP (needs CUDA 12 + cuDNN 9 on the loader path; the load
// fails loudly if the CUDA library can't load, it does not silently use CPU).
//
// A quant that FAILS TO LOAD is fatal: the bench throws and exits nonzero rather
// than printing a FAILED row and continuing, so a missing or unloadable encoder is
// never silently skipped. (A per-chunk transcribe failure still degrades to a
// FAILED row, marked per config.)
//
// It reuses the real pipeline verbatim (loadParakeetModel + transcribeChunked
// from transcribe.mjs, the same chunking/TDT decode the web app uses) and the
// shared WER/word helpers (test/e2e/text-overlap.mjs), so nothing here
// reimplements decoding or scoring.
//
// Default subject is the committed stitched FLEURS fixture (~200 s, 20 clips),
// whose reference transcript lives in test/fixtures/fleurs/manifest.json. A run
// transcribes it under each (quant, chunk-window) config and prints WER vs the
// human reference and vs this repo's int8 golden ("expected").
//
// Usage:
//   FFMPEG=/usr/bin/ffmpeg node scripts/wer-bench.mjs
//   node scripts/wer-bench.mjs --audio clip.wav --reference ref.txt --ort node
//   node scripts/wer-bench.mjs --configs int8@20,int8@60,fp16@60,fp32@60
//
// Built with Claude Code.

import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadParakeetModel, decodePcm, findFfmpeg } from './transcribe.mjs';
import { words, wer, overlap } from '../test/e2e/text-overlap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const a = {
    audio: resolve(ROOT, 'test/fixtures/fleurs/stitched.mp3'),
    reference: null,        // text or @file; default pulled from the fleurs manifest
    expected: null,         // optional second golden (int8 repo transcript)
    modelDir: resolve(ROOT, 'fallback_models'),
    ortBackend: 'node',
    decoderQuant: 'int8',   // decoder_joint quant, independent of each config's encoder quant (int8 matches fp32 quality here, faster)
    overlap: 2,
    // (quant, chunkDurationSec). The quant here is the ENCODER quant; the fused
    // decoder_joint quant is the separate --decoder-quant (default int8), applied
    // to every config. The default matrix sweeps chunk windows per encoder quant:
    // int8 at 20 s and 60 s vs fp16/fp32 at a 60 s window.
    configs: [
      ['int8', 20], ['int8', 60], ['fp16', 60], ['fp32', 60],
    ],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const next = () => (eq > 0 ? arg.slice(eq + 1) : argv[++i]);
    switch (flag) {
      case '--audio': a.audio = next(); break;
      case '--reference': a.reference = next(); break;
      case '--expected': a.expected = next(); break;
      case '--model-dir': a.modelDir = next(); break;
      case '--ort': a.ortBackend = next(); break;
      // Sugar for --ort cuda: run on the NVIDIA GPU (native onnxruntime-node
      // CUDA EP). Default stays CPU (--ort node).
      case '--cuda': a.ortBackend = 'cuda'; break;
      case '--decoder-quant': a.decoderQuant = next().trim().toLowerCase(); break;
      case '--overlap': a.overlap = Number(next()); break;
      case '--configs':
        a.configs = next().split(',').map((s) => {
          const [q, c] = s.split('@');
          return [q.trim(), Number(c)];
        });
        break;
      case '-h': case '--help':
        console.log('Usage: node scripts/wer-bench.mjs [--audio f] [--reference t|@file] [--configs int8@20,fp16@60] [--ort node|wasm|cuda] [--cuda] [--decoder-quant int8|fp16|fp32] [--model-dir d]\n  --configs quant is the ENCODER quant per chunk window; --decoder-quant (default int8) sets the fused decoder_joint quant for every config.\n  --ort selects the runtime: node (native CPU, default), wasm, or cuda (NVIDIA GPU via onnxruntime-node CUDA EP; needs CUDA 12 + cuDNN 9 on the loader path). --cuda is sugar for --ort cuda.');
        process.exit(0);
        break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (a.decoderQuant !== 'int8' && a.decoderQuant !== 'fp16' && a.decoderQuant !== 'fp32') {
    throw new Error(`--decoder-quant must be int8, fp16 or fp32 (got ${a.decoderQuant})`);
  }
  return a;
}

// Resolve a "text or @file" value to a string.
function resolveText(v) {
  if (!v) return null;
  return v.startsWith('@') ? readFileSync(v.slice(1), 'utf-8') : v;
}

// Pull reference/expected for the stitched fixture from the fleurs manifest, so
// the default run needs no extra arguments.
function manifestStitched() {
  try {
    const m = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/fleurs/manifest.json'), 'utf-8'));
    return m.stitched || null;
  } catch { return null; }
}

async function transcribeOnce(model, pcm, chunkSec, overlapSec) {
  const t0 = Date.now();
  const result = await model.transcribeChunked(pcm, 16000, {
    enableChunking: true,
    chunkDurationSec: chunkSec,
    overlapSec,
    beamWidth: 1,        // greedy, matching the web UI default
    temperature: 0,
  });
  return { text: result.utterance_text, ms: Date.now() - t0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const stitched = manifestStitched();
  const refText = resolveText(args.reference) || stitched?.reference;
  const expText = resolveText(args.expected) || stitched?.expected;
  if (!refText) throw new Error('No reference text (pass --reference t|@file).');
  const refWords = words(refText);
  const expWords = expText ? words(expText) : null;

  const ffmpeg = findFfmpeg(process.env.FFMPEG);
  const pcm = await decodePcm(ffmpeg, args.audio);
  const audioSec = pcm.length / 16000;
  console.log(`audio: ${args.audio}`);
  console.log(`       ${audioSec.toFixed(1)}s, reference ${refWords.length} words, ort=${args.ortBackend}, decoder=${args.decoderQuant}\n`);

  // Group configs by quant so each model is loaded once.
  const byQuant = new Map();
  for (const [q, c] of args.configs) {
    if (!byQuant.has(q)) byQuant.set(q, []);
    byQuant.get(q).push(c);
  }

  const rows = [];
  for (const [quant, chunks] of byQuant) {
    let model;
    try {
      ({ model } = await loadParakeetModel({
        modelDir: args.modelDir, quant, decoderQuant: args.decoderQuant, ortBackend: args.ortBackend,
      }));
    } catch (e) {
      // A quant that fails to LOAD crashes the whole bench (by request): an
      // unloadable encoder must not become a silent FAILED row while the run still
      // exits 0. (A per-chunk transcribe failure below stays soft, marked per row.)
      throw new Error(`failed to load ${quant} encoder (decoder ${args.decoderQuant}, ort ${args.ortBackend}): ${e.message}`);
    }
    for (const chunk of chunks) {
      try {
        const { text, ms } = await transcribeOnce(model, pcm, chunk, args.overlap);
        const hyp = words(text);
        rows.push({
          quant, chunk,
          wer: wer(refWords, hyp),
          werExp: expWords ? wer(expWords, hyp) : null,
          cov: overlap(refWords, hyp),
          hypWords: hyp.length,
          sec: ms / 1000,
        });
      } catch (e) {
        rows.push({ quant, chunk, error: e.message });
      }
    }
    model.dispose();
  }

  const pct = (x) => (x == null ? '   -  ' : `${(100 * x).toFixed(1)}%`.padStart(6));

  // Collect the table into a buffer so the same text goes to stdout and to the
  // appended bench_wer.md report.
  const out = [];
  out.push('quant  chunk   WER(ref) WER(int8gold)  coverage  hyp.words   time');
  out.push('-----  -----   -------- -------------  --------  ---------   ----');
  for (const r of rows) {
    if (r.error) {
      out.push(`${r.quant.padEnd(5)}  ${String(r.chunk).padStart(3)}s   FAILED: ${r.error}`);
      continue;
    }
    out.push(
      `${r.quant.padEnd(5)}  ${String(r.chunk).padStart(3)}s   ${pct(r.wer)}   ${pct(r.werExp)}        ${pct(r.cov)}  ${String(r.hypWords).padStart(7)}   ${r.sec.toFixed(1)}s`,
    );
  }
  out.push('\nLower WER is better. WER(ref) = vs FLEURS human label; WER(int8gold) = vs this repo\'s int8 transcript.');

  const table = out.join('\n');
  console.log(table);

  // Append (never overwrite) a timestamped run to bench_wer.md so the file
  // accumulates a history of every bench invocation.
  const reportPath = resolve(ROOT, 'bench_wer.md');
  const header = [
    `## ${new Date().toISOString()}`,
    '',
    `- audio: \`${args.audio}\` (${audioSec.toFixed(1)}s, reference ${refWords.length} words)`,
    `- ort backend: ${args.ortBackend}, decoder quant ${args.decoderQuant}, overlap ${args.overlap}s`,
    '',
  ].join('\n');
  appendFileSync(reportPath, `${header}\n\`\`\`\n${table}\n\`\`\`\n\n`);
  console.log(`\nAppended to ${reportPath}`);
}

main().catch((e) => { console.error(`[wer-bench] error: ${e.message}`); process.exit(1); });
