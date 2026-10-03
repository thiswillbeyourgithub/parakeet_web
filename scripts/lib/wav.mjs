// Minimal WAV reader shared by the Node scripts and tests that need raw PCM
// without an ffmpeg dependency (speaker-embedding-check.mjs, the sortformer
// diarization tests).
//
// Built with Claude Code.

import { readFileSync } from 'node:fs';

/** WAV (pcm_s16le mono) -> Float32 [-1,1] at its sample rate. */
export function readWavMono16(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = size;
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error(`${path}: missing fmt/data chunk`);
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 1) {
    throw new Error(`${path}: expected mono pcm_s16le, got fmt=${JSON.stringify(fmt)}`);
  }
  const n = Math.floor(dataLen / 2);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { pcm, sampleRate: fmt.sampleRate };
}
