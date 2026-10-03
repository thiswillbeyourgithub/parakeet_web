// Tier-1 end-to-end check of the Streaming Sortformer port (app/src/sortformer.js)
// with the REAL model: JS mel front end -> embed.onnx -> chunk loop + speaker
// cache -> step.onnx, against the probabilities transformers' own forward
// produced for the same audio (test/fixtures/sortformer-two-speakers-x3.bin,
// from scripts/gen-sortformer-fixtures.py). The clip is two-speakers.wav three
// times over (48 s), so the second chunk runs against a compressed cache built
// from real, overlapping speech: the case the synthetic cache test cannot reach.
//
// Needs the model repo (Olicorne/Nemotron-3-Diarization-web-onnx, symlinked
// under fallback_models/ or pointed at by PARAKEET_DIAR_MODEL_DIR) and self-skips
// without it, like the other real-model tests.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readWavMono16 } from '../../scripts/lib/wav.mjs';
import { createSortformerRunner, diarizeProbs, probsToSegments } from '../../app/src/sortformer.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const MODEL_DIR = process.env.PARAKEET_DIAR_MODEL_DIR || here('../../fallback_models/Olicorne/Nemotron-3-Diarization-web-onnx');
const STEP = join(MODEL_DIR, 'fp32/step.onnx');
const skip = existsSync(STEP) ? false : `model repo not found at ${MODEL_DIR}`;

function clip() {
  const { pcm, sampleRate } = readWavMono16(here('../fixtures/two-speakers.wav'));
  assert.equal(sampleRate, 16000);
  const gap = 8000;
  const out = new Float32Array(pcm.length * 3 + gap * 2);
  for (let k = 0; k < 3; k++) out.set(pcm, k * (pcm.length + gap));
  return out;
}

describe('sortformer port vs transformers, real model', { skip }, () => {
  test('two-speakers.wav x3: probabilities and segments', async () => {
    const ort = (await import('onnxruntime-node')).default;
    const config = JSON.parse(readFileSync(join(MODEL_DIR, 'diarization-config.json'), 'utf8'));
    const sil = readFileSync(join(MODEL_DIR, 'silence_embeds.bin'));
    const silenceEmbeds = new Float32Array(sil.buffer.slice(sil.byteOffset, sil.byteOffset + sil.length));
    const embedSession = await ort.InferenceSession.create(join(MODEL_DIR, 'embed.onnx'));
    const stepSession = await ort.InferenceSession.create(STEP);
    const runner = createSortformerRunner(ort, embedSession, stepSession, { hidden: config.hidden_size, mels: config.num_mel_bins });

    const pcm = clip();
    const got = await diarizeProbs(pcm, { config, silenceEmbeds, ...runner });

    const raw = readFileSync(here('../fixtures/sortformer-two-speakers-x3.bin'));
    const ref = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    assert.equal(got.numFrames * got.numSpeakers, ref.length);
    let maxDiff = 0;
    let agree = 0;
    for (let i = 0; i < ref.length; i++) {
      const r = ref[i] / 65535;
      maxDiff = Math.max(maxDiff, Math.abs(got.probs[i] - r));
      if ((got.probs[i] > 0.5) === (r > 0.5)) agree++;
    }
    const agreement = agree / ref.length;
    // measured 2026-10-03 on onnxruntime-node fp32: max |dp| 8e-6, of which
    // the fixture's uint16 rounding alone is up to 7.6e-6, and 100% agreement.
    // A wrong cache row or a mel mismatch is O(0.1) or more.
    assert.ok(maxDiff < 1e-4, `max |dp| ${maxDiff}`);
    assert.equal(agreement, 1, `decision agreement ${agreement}`);

    const segments = probsToSegments(got);
    const speakers = new Set(segments.map((s) => s.speaker));
    assert.deepEqual([...speakers].sort(), [0, 1]);
    // the three repeats must agree on who speaks when, i.e. the cache carried
    // the speakers' identities across the chunk boundary at 27.2 s
    const period = (pcm.length / 3 + 8000 / 3) / 16000;
    const at = (t) => segments.find((s) => s.start <= t && t < s.end)?.speaker;
    for (let t = 0.5; t < period - 0.5; t += 0.5) {
      const first = at(t);
      if (first === undefined) continue;
      assert.equal(at(t + 2 * period), first, `speaker at ${t.toFixed(1)} s vs repeat 3`);
    }
  });
});
