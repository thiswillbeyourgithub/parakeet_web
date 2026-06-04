#!/usr/bin/env node
// Generator for the JFK "moon speech" long-audio fixtures.
//
// A one-time local tool (like scripts/gen-fleurs-fixtures.mjs and
// scripts/gen-bpe-fixture.py): the committed fixtures it produces are what the
// tier-3 chunking e2e actually consumes, and this script is how they were made
// and how to regenerate them.
//
// Source: John F. Kennedy's "We choose to go to the Moon" address at Rice
// University, 12 September 1962 (~17:42). The recording is a U.S. Government
// work (public domain); we pull the Miller Center digitisation hosted on the
// Internet Archive (item jfks19620912). It replaces the stitched-FLEURS clip as
// the realistic long-audio chunking fixture: one continuous ~3 minute speech
// instead of independent sentences glued together, which is a more honest
// stress of the chunk/overlap stitcher at real sentence-spanning seams.
//
// What it does:
//   1. downloads the lossless master once into the gitignored cache
//      (test/e2e/.cache/jfk-moon/master.flac),
//   2. crops the first --crop-sec seconds and transcodes to a compact 16 kHz
//      mono mp3 -> test/fixtures/jfk-moon-3min.mp3 (committed),
//   3. transcribes that crop with the SAME int8 pipeline the web app uses on the
//      WASM backend (reusing transcribe.mjs's loadParakeetModel/decodePcm, and
//      the int8-safe ~20 s chunk window from models.js) so the golden can never
//      diverge from production behaviour -> test/fixtures/jfk-moon-3min.expected.txt,
//   4. writes test/fixtures/jfk-moon-3min.meta.json recording the source URL and
//      crop/model parameters for provenance.
//
// It also transcodes the FULL speech to a compact mp3 in the cache
// (test/e2e/.cache/jfk-moon/full.mp3); that file is NOT committed and is used by
// the manual WebGPU memory-leak harness (scripts/webgpu-memcheck.mjs), which
// imports the ensure* helpers below so the download/transcode logic lives in one
// place.
//
// Requires the int8 weights locally (default --model-dir ./fallback_models), a
// working ffmpeg (auto-detected, or pass --ffmpeg / set FFMPEG) and curl. NOT
// run in CI.
//
// Usage:
//   node scripts/gen-jfk-moon-fixtures.mjs                 # default 180 s crop
//   node scripts/gen-jfk-moon-fixtures.mjs --crop-sec=120  # shorter crop
//
// Built with Claude Code.

import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadParakeetModel, decodePcm, findFfmpeg } from './transcribe.mjs';
import { INT8_SAFE_CHUNK_DURATION_SEC } from '../app/src/models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- shared constants + helpers (also imported by webgpu-memcheck.mjs) -------

// Miller Center digitisation on the Internet Archive (public-domain US-gov work).
// The lossless FLAC is the master; we downsample/crop from it so the committed
// fixture and the cached full clip share one provenance.
export const SOURCE_URL =
  'https://archive.org/download/jfks19620912/jfk_1962_0912_spaceeffort.flac';

// Gitignored (test/e2e/.cache is in .gitignore): downloaded master + derived
// full compact clip live here, never committed.
export const CACHE_DIR = resolve(ROOT, 'test/e2e/.cache/jfk-moon');
export const MASTER_PATH = join(CACHE_DIR, 'master.flac');
export const FULL_COMPACT_PATH = join(CACHE_DIR, 'full.mp3');

export const CROP_SEC = 180; // 3 minutes
export const FIXTURE_MP3 = resolve(ROOT, 'test/fixtures/jfk-moon-3min.mp3');
export const EXPECTED_TXT = resolve(ROOT, 'test/fixtures/jfk-moon-3min.expected.txt');
export const META_JSON = resolve(ROOT, 'test/fixtures/jfk-moon-3min.meta.json');

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`);
}

// Download the lossless master once into the cache (idempotent).
export function ensureMaster({ source = SOURCE_URL, master = MASTER_PATH } = {}) {
  mkdirSync(dirname(master), { recursive: true });
  if (existsSync(master) && statSync(master).size > 0) return master;
  console.error(`[gen-jfk-moon] downloading master from ${source} ...`);
  run('curl', ['-fSL', '-o', master, source], `download ${basename(master)}`);
  return master;
}

// Transcode (optionally cropping a [startSec, startSec+durationSec) window) the
// master to a compact 16 kHz mono mp3, matching gen-fleurs-fixtures' transcode
// settings so every committed audio fixture is encoded identically.
export function transcodeCompact(ffmpeg, src, dst, { startSec = 0, durationSec = null } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-y'];
  if (startSec > 0) args.push('-ss', String(startSec));
  if (durationSec != null) args.push('-t', String(durationSec));
  args.push('-i', src, '-ar', '16000', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', dst);
  run(ffmpeg, args, `transcode ${basename(dst)}`);
  return dst;
}

// Ensure the FULL compact clip exists in the cache (used by the WebGPU memory
// harness). Downloads the master if needed, then transcodes the whole speech.
export function ensureFullCompact(ffmpeg, { full = FULL_COMPACT_PATH } = {}) {
  if (existsSync(full) && statSync(full).size > 0) return full;
  ensureMaster();
  console.error(`[gen-jfk-moon] transcoding full speech -> ${full} ...`);
  return transcodeCompact(ffmpeg, MASTER_PATH, full);
}

// --- args --------------------------------------------------------------------
function parseArgs(argv) {
  const a = { cropSec: CROP_SEC, modelDir: resolve(ROOT, 'fallback_models'), ffmpeg: null };
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const [k, v] = eq === -1 ? [arg, null] : [arg.slice(0, eq), arg.slice(eq + 1)];
    switch (k) {
      case '--crop-sec': a.cropSec = Number(v); break;
      case '--model-dir': a.modelDir = v; break;
      case '--ffmpeg': a.ffmpeg = v; break;
      case '-h': case '--help':
        console.log(`Usage: node scripts/gen-jfk-moon-fixtures.mjs [options]
  --crop-sec N    Seconds to crop from the start for the chunk fixture (default: ${CROP_SEC})
  --model-dir D   int8 weights dir (default: ./fallback_models)
  --ffmpeg PATH   ffmpeg binary (else auto-detected; or set FFMPEG)`);
        process.exit(0);
    }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ffmpeg = findFfmpeg(args.ffmpeg);
  console.error(`[gen-jfk-moon] ffmpeg: ${ffmpeg}`);

  ensureMaster();

  // 1) committed chunk fixture: the first crop-sec of the speech.
  mkdirSync(dirname(FIXTURE_MP3), { recursive: true });
  transcodeCompact(ffmpeg, MASTER_PATH, FIXTURE_MP3, { startSec: 0, durationSec: args.cropSec });
  console.error(`[gen-jfk-moon] wrote ${FIXTURE_MP3} (${(statSync(FIXTURE_MP3).size / 1024).toFixed(0)} KB)`);

  // 2) the full compact clip for the manual WebGPU memory harness (cache only).
  ensureFullCompact(ffmpeg);

  // 3) int8 golden: the repo's own int8 pipeline transcript of the crop, decoded
  // exactly as the WASM app does (int8-safe ~20 s chunk window, greedy). The
  // chunk e2e then asserts the live app recovers this content across the seams.
  console.error(`[gen-jfk-moon] loading int8 model from ${args.modelDir} ...`);
  const { model } = await loadParakeetModel({ modelDir: args.modelDir, quant: 'int8' });
  const pcm = await decodePcm(ffmpeg, FIXTURE_MP3);
  const r = await model.transcribeChunked(pcm, 16000, {
    enableChunking: true, chunkDurationSec: INT8_SAFE_CHUNK_DURATION_SEC, overlapSec: 2,
    beamWidth: 1, temperature: 0, returnTimestamps: false, returnConfidences: false,
  });
  const expected = r.utterance_text.trim();
  if (!expected) throw new Error('int8 transcript was empty');
  writeFileSync(EXPECTED_TXT, `${expected}\n`);
  console.error(`[gen-jfk-moon] wrote ${EXPECTED_TXT} (${expected.split(/\s+/).length} words)`);

  writeFileSync(META_JSON, `${JSON.stringify({
    generatedBy: 'scripts/gen-jfk-moon-fixtures.mjs',
    note: 'JFK "We choose to go to the Moon", Rice University, 1962-09-12 (public domain US-gov work). audio = first cropSec of the speech; expected = this repo int8 pipeline transcript at the int8-safe chunk window.',
    sourceUrl: SOURCE_URL,
    cropStartSec: 0,
    cropDurationSec: args.cropSec,
    model: 'int8',
    chunkDurationSec: INT8_SAFE_CHUNK_DURATION_SEC,
  }, null, 2)}\n`);
  console.error(`[gen-jfk-moon] wrote ${META_JSON}`);
  console.error('[gen-jfk-moon] done.');
}

// Only run main() when executed directly, not when imported for the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
