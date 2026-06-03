#!/usr/bin/env node
// WER bench for comparing encoder quantisations at different chunk windows,
// built to answer one question: does fp16 hold up on a long (>20 s) chunk where
// the int8 encoder silently drops content?
//
// Background: the int8 encoder loses long-range information past
// ~INT8_SAFE_CHUNK_DURATION_SEC within a single chunk, so the web app caps the
// int8/WASM default chunk window there. fp32 does not have this problem. fp16 is
// the candidate middle ground (~1.2 GB, near-lossless), but it cannot load on
// the WASM backend (the CPU/WASM EP upcasts fp16->fp32 and overflows the 32-bit
// heap), so this bench runs on the NATIVE onnxruntime-node backend (--ort node),
// which loads fp16/fp32 fine and is a faithful proxy for fp16 *quality*.
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

import { readFileSync } from 'node:fs';
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
    overlap: 2,
    // (quant, chunkDurationSec). The default matrix isolates the >20 s effect:
    // int8 at its safe window vs int8/fp16/fp32 at a 60 s window.
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
      case '--overlap': a.overlap = Number(next()); break;
      case '--configs':
        a.configs = next().split(',').map((s) => {
          const [q, c] = s.split('@');
          return [q.trim(), Number(c)];
        });
        break;
      case '-h': case '--help':
        console.log('Usage: node scripts/wer-bench.mjs [--audio f] [--reference t|@file] [--configs int8@20,fp16@60] [--ort node|wasm] [--model-dir d]');
        process.exit(0);
        break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
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
  console.log(`       ${audioSec.toFixed(1)}s, reference ${refWords.length} words, ort=${args.ortBackend}\n`);

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
        modelDir: args.modelDir, quant, ortBackend: args.ortBackend,
      }));
    } catch (e) {
      for (const c of chunks) rows.push({ quant, chunk: c, error: e.message });
      continue;
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
  console.log('quant  chunk   WER(ref) WER(int8gold)  coverage  hyp.words   time');
  console.log('-----  -----   -------- -------------  --------  ---------   ----');
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.quant.padEnd(5)}  ${String(r.chunk).padStart(3)}s   FAILED: ${r.error}`);
      continue;
    }
    console.log(
      `${r.quant.padEnd(5)}  ${String(r.chunk).padStart(3)}s   ${pct(r.wer)}   ${pct(r.werExp)}        ${pct(r.cov)}  ${String(r.hypWords).padStart(7)}   ${r.sec.toFixed(1)}s`,
    );
  }
  console.log('\nLower WER is better. WER(ref) = vs FLEURS human label; WER(int8gold) = vs this repo\'s int8 transcript.');
}

main().catch((e) => { console.error(`[wer-bench] error: ${e.message}`); process.exit(1); });
