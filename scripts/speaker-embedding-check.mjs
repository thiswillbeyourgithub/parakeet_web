// Validation spike for cross-recording speaker matching (session-only feature).
//
// Written when diarization ran on sherpa-onnx's WASM build, which returned only
// {start,end,speaker} segments, never embeddings (the Sortformer that replaced
// it numbers speakers per recording only, so the same need remains).
// To label the same voice with the same name across recordings we must produce
// our own CAM++ speaker embeddings. CAM++ takes 80-dim kaldi fbank features
// (input x=[N,T,80] -> embedding=[N,192], feature_normalize_type=global-mean),
// so the make-or-break risk is reproducing that fbank front-end faithfully.
//
// This script proves the approach is viable BEFORE any browser/feature code: it
// computes embeddings for several windows of test/fixtures/two-speakers.wav
// (JFK = speaker A for ~0-11s, a FLEURS English reader = speaker B for ~12-15s)
// and prints pairwise cosine similarities. A usable embedding front-end must put
// same-speaker pairs (A1,A2) clearly above cross-speaker pairs (A,B).
//
// Run (native onnxruntime-node, a faithful proxy for the browser ORT):
//   node scripts/speaker-embedding-check.mjs \
//     [--wav test/fixtures/two-speakers.wav] \
//     [--model fallback_models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx]
//
// Built with Claude Code.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ort from 'onnxruntime-node';
import { computeFbank, FBANK_NUM_BINS, FBANK_SAMPLE_RATE } from '../app/src/fbank.js';
import { readWavMono16 } from './lib/wav.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// The 80-dim kaldi fbank front-end is the shared app/src/fbank.js (also used by
// the browser embedding path), so this script and production compute identical
// features. cosine() stays local since it is only used for this report.
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

async function main() {
  const wavPath = resolve(ROOT, arg('wav', 'test/fixtures/two-speakers.wav'));
  const modelPath = resolve(ROOT, arg('model', 'fallback_models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'));

  const { pcm, sampleRate } = readWavMono16(wavPath);
  if (sampleRate !== FBANK_SAMPLE_RATE) throw new Error(`expected 16 kHz, got ${sampleRate}`);
  const dur = pcm.length / FBANK_SAMPLE_RATE;
  console.log(`wav: ${wavPath} (${dur.toFixed(2)}s, ${FBANK_SAMPLE_RATE} Hz)`);

  const session = await ort.InferenceSession.create(modelPath);

  async function embed(startSec, endSec) {
    const s = Math.max(0, Math.floor(startSec * FBANK_SAMPLE_RATE));
    const e = Math.min(pcm.length, Math.floor(endSec * FBANK_SAMPLE_RATE));
    const { feats, T } = computeFbank(pcm.subarray(s, e));
    if (T === 0) throw new Error(`window ${startSec}-${endSec}s too short`);
    const x = new ort.Tensor('float32', feats, [1, T, FBANK_NUM_BINS]);
    const out = await session.run({ x });
    const emb = out.embedding.data;
    return Float32Array.from(emb);
  }

  // Two windows of speaker A (JFK), one of speaker B (FLEURS reader).
  const windows = {
    A1: [1.0, 5.0],
    A2: [6.0, 10.0],
    B: [12.0, Math.min(15.2, dur)],
  };
  const emb = {};
  for (const [name, [a, b]] of Object.entries(windows)) {
    emb[name] = await embed(a, b);
    console.log(`embedded ${name} = [${windows[name][0]}s, ${windows[name][1].toFixed(2)}s]`);
  }

  const sameAA = cosine(emb.A1, emb.A2);
  const crossA1B = cosine(emb.A1, emb.B);
  const crossA2B = cosine(emb.A2, emb.B);
  const crossAvg = (crossA1B + crossA2B) / 2;

  console.log('\ncosine similarities:');
  console.log(`  same-speaker   A1~A2 : ${sameAA.toFixed(4)}`);
  console.log(`  cross-speaker  A1~B  : ${crossA1B.toFixed(4)}`);
  console.log(`  cross-speaker  A2~B  : ${crossA2B.toFixed(4)}`);
  console.log(`\n  gap (same - cross_avg): ${(sameAA - crossAvg).toFixed(4)}`);

  const ok = sameAA > 0.5 && sameAA - crossAvg > 0.2;
  console.log(`\nVERDICT: ${ok ? 'PASS' : 'FAIL'} - embeddings are ${ok ? 'discriminative (approach viable)' : 'NOT discriminative enough (fbank parity likely off)'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
