#!/usr/bin/env node
// Generator for the FLEURS regression fixtures under test/fixtures/fleurs/.
//
// A one-time local tool (like scripts/gen-bpe-fixture.py): the committed
// fixtures it produces are what CI/tier-3 actually consume, this script is how
// they were made and how to regenerate them. For each requested language it:
//   1. randomly samples clips from the local FLEURS *validation* manifest,
//   2. transcodes each clip to a compact mp3 (so the repo stays light, like the
//      existing jfk.mp3 / sample.aac fixtures),
//   3. transcribes that mp3 with the SAME int8 pipeline the web app uses
//      (reusing scripts/transcribe.mjs's loadParakeetModel/decodePcm so the
//      golden can never diverge from production behaviour),
//   4. keeps only clips whose model transcript reproduces the human reference
//      well (overlap >= --min-overlap), so the e2e thresholds have margin,
//   5. stitches all kept clips (en first, then fr, ...) into one long mp3 with a
//      short silence between them for the realistic long-audio chunking e2e,
//   6. writes test/fixtures/fleurs/manifest.json carrying, per clip, BOTH the
//      FLEURS human reference and the model's own int8 transcript.
//
// Requires the int8 weights locally (default --model-dir ./fallback_models) and
// a working ffmpeg (auto-detected, or pass --ffmpeg / set FFMPEG). NOT run in
// CI. Re-running with a different --seed reshuffles the sample.
//
// Usage:
//   node scripts/gen-fleurs-fixtures.mjs \
//     --fleurs "~/Downloads/parakeet finetuning/NeMo/perso/downloaded_datasets_ignore-backups/fleurs" \
//     --langs en,fr --per-lang 10 --model-dir ./fallback_models --seed 1234
//
// Built with Claude Code.

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { loadParakeetModel, decodePcm, findFfmpeg } from './transcribe.mjs';
import { words, overlap } from '../test/e2e/text-overlap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- args -----------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    fleurs: '~/Downloads/parakeet finetuning/NeMo/perso/downloaded_datasets_ignore-backups/fleurs',
    langs: ['en', 'fr'],
    perLang: 10,
    modelDir: resolve(ROOT, 'fallback_models'),
    seed: 1234,
    minOverlap: 0.85, // overlap(reference, model transcript) needed to keep a clip
    minDuration: 4,   // skip very short clips (too few words to score robustly)
    maxDuration: 18,  // skip very long clips (keep the e2e runtime sane)
    gap: 0.4,         // silence (s) inserted between clips in the stitched mp3
    out: resolve(ROOT, 'test/fixtures/fleurs'),
    ffmpeg: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inline = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = () => (inline !== null ? inline : argv[++i]);
    switch (flag) {
      case '-h': case '--help': printHelp(); process.exit(0); break;
      case '--fleurs': a.fleurs = val(); break;
      case '--langs': a.langs = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--per-lang': a.perLang = parseInt(val(), 10); break;
      case '--model-dir': a.modelDir = val(); break;
      case '--seed': a.seed = parseInt(val(), 10); break;
      case '--min-overlap': a.minOverlap = Number(val()); break;
      case '--min-duration': a.minDuration = Number(val()); break;
      case '--max-duration': a.maxDuration = Number(val()); break;
      case '--gap': a.gap = Number(val()); break;
      case '--out': a.out = resolve(val()); break;
      case '--ffmpeg': a.ffmpeg = val(); break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  return a;
}

function printHelp() {
  console.log(`Generate the FLEURS regression fixtures (test/fixtures/fleurs/).

Options:
  --fleurs DIR        FLEURS root with <lang>/validation.json + <lang>/wavs_validation/
  --langs a,b         Languages to sample (default: en,fr)
  --per-lang N        Clips to keep per language (default: 10)
  --model-dir DIR     int8 weights dir (default: ./fallback_models)
  --seed N            RNG seed for the shuffle (default: 1234)
  --min-overlap F     Keep a clip only if overlap(reference, model) >= F (default: 0.85)
  --min-duration S    Skip clips shorter than S seconds (default: 4)
  --max-duration S    Skip clips longer than S seconds (default: 18)
  --gap S             Silence between stitched clips, seconds (default: 0.4)
  --out DIR           Output fixtures dir (default: test/fixtures/fleurs)
  --ffmpeg PATH       ffmpeg binary (else auto-detected; or set FFMPEG)`);
}

const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// Deterministic RNG so a given --seed reproduces the same sample.
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readManifest(path) {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function ffmpegOrThrow(ffmpeg, args, what) {
  const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg ${what} failed (exit ${r.status})`);
}

function transcode(ffmpeg, srcWav, dstMp3) {
  ffmpegOrThrow(ffmpeg, [
    '-hide_banner', '-v', 'error', '-y', '-i', srcWav,
    '-ar', '16000', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', dstMp3,
  ], `transcode ${basename(srcWav)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fleursDir = expandHome(args.fleurs);
  if (!existsSync(fleursDir)) throw new Error(`--fleurs dir not found: ${fleursDir}`);

  const ffmpeg = findFfmpeg(args.ffmpeg);
  console.error(`[gen-fleurs] ffmpeg: ${ffmpeg}`);
  console.error(`[gen-fleurs] loading int8 model from ${args.modelDir} ...`);
  const { model } = await loadParakeetModel({ modelDir: args.modelDir, quant: 'int8' });

  // Same single-pass greedy decode transcribe.mjs uses by default, so these
  // goldens match the ones the existing jfk/sample fixtures were made with. The
  // clips are all < chunkDurationSec, so this is a single pass (no chunking).
  const transcribe = async (pcm) => {
    const r = await model.transcribeChunked(pcm, 16000, {
      enableChunking: true, chunkDurationSec: 60, overlapSec: 2,
      beamWidth: 1, temperature: 0, returnTimestamps: false, returnConfidences: false,
    });
    return r.utterance_text.trim();
  };

  mkdirSync(args.out, { recursive: true });
  const rng = mulberry32(args.seed);
  const kept = [];

  for (const lang of args.langs) {
    const manifestPath = join(fleursDir, lang, 'validation.json');
    if (!existsSync(manifestPath)) throw new Error(`no validation.json for ${lang}: ${manifestPath}`);
    mkdirSync(join(args.out, lang), { recursive: true });

    const entries = shuffled(readManifest(manifestPath), rng);
    const langKept = [];
    let tried = 0;
    for (const e of entries) {
      if (langKept.length >= args.perLang) break;
      if (typeof e.duration === 'number' && (e.duration < args.minDuration || e.duration > args.maxDuration)) continue;
      const id = basename(e.audio_filepath).replace(/\.wav$/, '');
      const srcWav = join(fleursDir, lang, 'wavs_validation', `${id}.wav`);
      if (!existsSync(srcWav)) continue;
      tried += 1;

      const dstMp3 = join(args.out, lang, `${id}.mp3`);
      transcode(ffmpeg, srcWav, dstMp3);
      const pcm = await decodePcm(ffmpeg, dstMp3);
      const expected = await transcribe(pcm);
      const refOverlap = overlap(words(e.text), words(expected));
      if (refOverlap < args.minOverlap || !expected) {
        rmSync(dstMp3, { force: true });
        console.error(`[gen-fleurs] ${lang}/${id} rejected (overlap ${refOverlap.toFixed(2)})`);
        continue;
      }
      langKept.push({
        id, lang,
        audio: `${lang}/${id}.mp3`,
        srcWav,
        duration: e.duration,
        reference: e.text,
        expected,
        refOverlap: +refOverlap.toFixed(3),
      });
      console.error(`[gen-fleurs] ${lang}/${id} kept (${langKept.length}/${args.perLang}, overlap ${refOverlap.toFixed(2)})`);
    }
    if (langKept.length < args.perLang) {
      throw new Error(`only kept ${langKept.length}/${args.perLang} for ${lang} after ${tried} tries; lower --min-overlap or widen the duration window`);
    }
    kept.push(...langKept);
  }

  // --- stitch all kept clips into one long mp3 with a small silence between ---
  const silence = join(args.out, '_silence.wav');
  ffmpegOrThrow(ffmpeg, [
    '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'anullsrc=r=16000:cl=mono', '-t', String(args.gap),
    '-ar', '16000', '-ac', '1', silence,
  ], 'silence gen');
  const listPath = join(args.out, '_concat.txt');
  const listLines = [];
  kept.forEach((c, i) => {
    if (i > 0) listLines.push(`file '${silence}'`);
    listLines.push(`file '${c.srcWav}'`);
  });
  writeFileSync(listPath, `${listLines.join('\n')}\n`);
  const stitchedMp3 = join(args.out, 'stitched.mp3');
  ffmpegOrThrow(ffmpeg, [
    '-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', listPath, '-ar', '16000', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', stitchedMp3,
  ], 'stitch');
  rmSync(silence, { force: true });
  rmSync(listPath, { force: true });

  // The stitched golden is the in-order concatenation of the per-clip goldens:
  // each clip is an independent sentence, so this is the clean transcript the
  // chunked/stitched run must recover at the seams.
  const stitched = {
    audio: 'stitched.mp3',
    gapSec: args.gap,
    order: kept.map((c) => c.id),
    reference: kept.map((c) => c.reference).join(' '),
    expected: kept.map((c) => c.expected).join(' '),
  };

  const manifest = {
    generatedBy: 'scripts/gen-fleurs-fixtures.mjs',
    note: 'FLEURS validation clips (en+fr). expected = this repo int8 pipeline transcript; reference = FLEURS human label. See scripts/gen-fleurs-fixtures.mjs.',
    model: 'parakeet-tdt-0.6b-v3 (int8, greedy)',
    seed: args.seed,
    minOverlap: args.minOverlap,
    clips: kept.map(({ srcWav, ...rest }) => rest),
    stitched,
  };
  writeFileSync(join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  model.dispose();
  const total = kept.length;
  const durs = kept.reduce((s, c) => s + (c.duration || 0), 0) + (total - 1) * args.gap;
  console.error(`[gen-fleurs] wrote ${total} clips + stitched.mp3 (~${durs.toFixed(0)}s) to ${args.out}`);
}

main().catch((e) => {
  console.error(`\n[gen-fleurs] error: ${e.message}`);
  process.exit(1);
});
