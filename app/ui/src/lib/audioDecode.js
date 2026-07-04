// Audio decode helpers for the file-upload path (App.jsx processAudioFile).
//
// Two decoders, both taking a File/Blob and returning 16 kHz mono float32 PCM:
//
//  - decodeToPcm16kFfmpeg: vendored ffmpeg.wasm. Reproduces the CLI's
//    `ffmpeg -i <file> -ac 1 -ar 16000 -f f32le -` (scripts/transcribe.mjs
//    decodePcm) byte-for-byte, including the AAC encoder-delay / priming trim
//    and the exact swresample pass that the browser's decodeAudioData does NOT
//    do. This is what makes an uploaded venlaf.aac transcribe identically in the
//    WebUI and the CLI. The ~31 MB core wasm is fetched only on first use, then
//    cached by the browser.
//
//  - decodeToPcm16kWebAudio: the fallback. decodeAudioData straight into a
//    16 kHz OfflineAudioContext, i.e. a single high-quality resample pass with
//    no realtime-device-rate intermediate. Used when ffmpeg.wasm cannot load
//    (CSP, memory) or a decode throws, so uploads never hard-break.
//
// The caller (processAudioFile) tries ffmpeg first and falls back to Web Audio.

import { FFmpeg } from '@ffmpeg/ffmpeg';

const TARGET_SR = 16000;

// ── ffmpeg.wasm path (CLI parity) ──────────────────────────────────────────

// Same-origin URLs for the vendored core, mirrored into app/ui/public/ffmpeg/
// and served by Caddy/Vite at /ffmpeg/. Passed straight to FFmpeg.load: the
// module worker imports the ESM core via `import(coreURL)` (allowed by
// script-src 'self') and the emscripten glue fetches the wasm from wasmURL
// (allowed by connect-src 'self'). No blob: URL and no CDN, so this loads under
// the app's strict CSP + COEP require-corp exactly like the vendored ORT wasm.
const CORE_URL = '/ffmpeg/ffmpeg-core.js';
const WASM_URL = '/ffmpeg/ffmpeg-core.wasm';

let loadPromise = null;
// Ring buffer of the most recent ffmpeg log lines, attached to thrown errors so
// a failed decode reports ffmpeg's own diagnostics instead of a bare code.
const recentLog = [];

// Load (or reuse) a single FFmpeg instance. It holds the ~31 MB wasm in memory,
// so exactly one is kept for the tab's lifetime. On load failure the promise is
// cleared so a later upload can retry from scratch.
function getFFmpeg() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => {
        recentLog.push(message);
        if (recentLog.length > 40) recentLog.shift();
      });
      await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      return ff;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

// Decode an uploaded File/Blob/ArrayBuffer/Uint8Array to 16 kHz mono float32
// PCM, identical to the CLI decodePcm. Throws on any load/exec/read failure (or
// an empty decode) so the caller can fall back to the Web Audio path.
export async function decodeToPcm16kFfmpeg(input) {
  const ff = await getFFmpeg();
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());

  // Fixed FS names. ffmpeg selects the demuxer from content, not extension, so a
  // bare "input" matches the CLI feeding the raw file. Decodes are serialized
  // through the single worker, so there is no cross-call name collision.
  const IN = 'input';
  const OUT = 'output.f32le';
  // writeFile TRANSFERS bytes.buffer to the worker (detaching it here); that is
  // fine because we derived it from the File, which stays re-readable for the
  // fallback path.
  await ff.writeFile(IN, bytes);
  try {
    // Byte-for-byte the CLI pipeline: any-format -> mono, 16 kHz, float32 raw.
    // -nostdin/-y only govern I/O (never prompt, always overwrite OUT) and do
    // not affect the samples, so parity with the CLI holds. -hide_banner /
    // -loglevel from the CLI only change logging and are omitted.
    const rc = await ff.exec(['-nostdin', '-y', '-i', IN, '-ac', '1', '-ar', String(TARGET_SR), '-f', 'f32le', OUT]);
    if (rc !== 0) {
      throw new Error(`ffmpeg exited ${rc}${recentLog.length ? `: ${recentLog.slice(-3).join(' | ')}` : ''}`);
    }
    const out = await ff.readFile(OUT); // Uint8Array view into the wasm heap
    // Copy into a fresh, 4-byte-aligned buffer before viewing as float32 (the
    // heap view may be offset, and slice() detaches from the wasm heap so the
    // PCM survives the FS cleanup below).
    const usable = out.byteLength - (out.byteLength % 4);
    const copy = out.slice(0, usable);
    const pcm = new Float32Array(copy.buffer, copy.byteOffset, usable / 4);
    if (!pcm.length) throw new Error('ffmpeg produced 0 samples');
    return pcm;
  } finally {
    // Free the emscripten FS entries so repeated uploads do not grow heap memory.
    try { await ff.deleteFile(IN); } catch { /* already gone */ }
    try { await ff.deleteFile(OUT); } catch { /* never written */ }
  }
}

// ── Web Audio single-pass path (fallback) ──────────────────────────────────

// Decode + resample to 16 kHz mono float32 in one pass: decodeAudioData on an
// OfflineAudioContext already at 16 kHz resamples straight from the source rate
// to 16 kHz (no realtime-device-rate intermediate). This is a strict quality
// improvement over the old decode-at-48-kHz-then-resample path, but unlike
// ffmpeg it does NOT trim AAC encoder-delay/priming, so it is the fallback only.
export async function decodeToPcm16kWebAudio(input) {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  // length must be >= 1; the decoded buffer's length is independent of it.
  const decodeCtx = new OfflineAudioContext(1, 1, TARGET_SR);
  let decoded = await decodeCtx.decodeAudioData(buf);

  let pcm;
  if (decoded.sampleRate === TARGET_SR && decoded.numberOfChannels === 1) {
    // Already mono at 16 kHz: pcm is a view onto decoded's only channel;
    // dropping the wrapper below keeps the storage alive through pcm.
    pcm = decoded.getChannelData(0);
  } else {
    // Downmix to mono (spec average of the channels) in one render at 16 kHz.
    // On any browser that ignored the offline decode rate, this render also
    // resamples to 16 kHz (the old two-pass path as a rare fallback).
    const mixCtx = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * TARGET_SR),
      TARGET_SR,
    );
    const source = mixCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(mixCtx.destination);
    source.start();
    let mixed = await mixCtx.startRendering();
    pcm = mixed.getChannelData(0);
    mixed = null;
  }
  decoded = null;
  return pcm;
}
