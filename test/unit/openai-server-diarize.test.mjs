// Tier-1 test for the API server's diarizer (scripts/openai-like-server/lib/
// diarize.mjs): where it looks for the Sortformer repo and how it fails when
// files are missing (model-free, over temp trees), then a real run of the int8
// step on the server's default wasm backend that must split two-speakers.wav
// into two speakers and honour the num_speakers cap. The real run needs the
// model repo (fallback_models/ symlink or PARAKEET_DIAR_MODEL_DIR) and
// self-skips without it.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWavMono16 } from '../../scripts/lib/wav.mjs';
import {
  resolveDiarizationModel, createDiarizer, DIARIZATION_REPO_DIR,
} from '../../scripts/openai-like-server/lib/diarize.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const CONFIG = {
  hidden_size: 2, num_mel_bins: 128, num_speakers: 4, subsampling_factor: 8, offline: {}, speaker_cache: {},
};

// A fake repo: the four files resolveDiarizationModel checks, with tiny bytes.
function fakeRepo(dir, { step = 'int8/step.int8.onnx' } = {}) {
  mkdirSync(join(dir, dirname(step)), { recursive: true });
  writeFileSync(join(dir, 'diarization-config.json'), JSON.stringify(CONFIG));
  writeFileSync(join(dir, 'silence_embeds.bin'), Buffer.alloc(CONFIG.hidden_size * 4));
  writeFileSync(join(dir, 'embed.onnx'), 'x');
  writeFileSync(join(dir, step), 'x');
}

describe('resolveDiarizationModel', () => {
  const withTree = (fn) => {
    const root = mkdtempSync(join(tmpdir(), 'diar-resolve-'));
    try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
  };

  test('prefers the repo folder inside the model dir', () => withTree((root) => {
    const asr = join(root, 'asr');
    fakeRepo(join(asr, DIARIZATION_REPO_DIR));
    fakeRepo(asr); // a flat copy too: the nested one must still win
    const m = resolveDiarizationModel({ modelDir: asr, precision: 'int8' });
    assert.equal(m.dir, join(asr, DIARIZATION_REPO_DIR));
    assert.equal(m.stepPath, join(asr, DIARIZATION_REPO_DIR, 'int8/step.int8.onnx'));
  }));

  test('falls back to a flat model dir, then a sibling checkout', () => withTree((root) => {
    const flat = join(root, 'flat');
    fakeRepo(flat);
    assert.equal(resolveDiarizationModel({ modelDir: flat, precision: 'int8' }).dir, flat);
    const asr = join(root, 'asr');
    mkdirSync(asr);
    fakeRepo(join(root, DIARIZATION_REPO_DIR));
    assert.equal(resolveDiarizationModel({ modelDir: asr, precision: 'int8' }).dir, join(root, DIARIZATION_REPO_DIR));
  }));

  test('an explicit dir is the only place looked', () => withTree((root) => {
    const asr = join(root, 'asr');
    fakeRepo(join(asr, DIARIZATION_REPO_DIR));
    assert.throws(() => resolveDiarizationModel({ dir: join(root, 'nope'), modelDir: asr, precision: 'int8' }),
      /no diarization-config\.json was found in .*nope/);
  }));

  test('a missing step names the precision', () => withTree((root) => {
    fakeRepo(root);
    assert.throws(() => resolveDiarizationModel({ modelDir: root, precision: 'fp32' }),
      /lacks fp32\/step\.onnx \(the fp32 step; see --diarize-precision\)/);
  }));

  test('an unknown precision throws', () => {
    assert.throws(() => resolveDiarizationModel({ modelDir: '/x', precision: 'int4' }), /unknown diarization precision/);
  });
});

const REAL_ASR_DIR = here('../../fallback_models/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx');
const REAL_DIAR_DIR = process.env.PARAKEET_DIAR_MODEL_DIR || here(`../../fallback_models/Olicorne/${DIARIZATION_REPO_DIR}`);
const skip = existsSync(join(REAL_DIAR_DIR, 'int8/step.int8.onnx')) ? false : `model repo not found at ${REAL_DIAR_DIR}`;

describe('server diarizer, real int8 model on wasm', { skip }, () => {
  test('two-speakers.wav: two speakers, and a cap of 1 folds them', async () => {
    const model = resolveDiarizationModel({ dir: REAL_DIAR_DIR, modelDir: REAL_ASR_DIR, precision: 'int8' });
    const diarizer = createDiarizer({ model, ort: 'wasm' });
    try {
      const { pcm } = readWavMono16(here('../fixtures/two-speakers.wav'));
      const segs = await diarizer.run(pcm);
      const speakers = new Set(segs.map((s) => s.speaker));
      assert.equal(speakers.size, 2, JSON.stringify(segs));
      // JFK first (~11 s), the FLEURS reader last: different labels
      assert.notEqual(segs[0].speaker, segs[segs.length - 1].speaker);
      const capped = await diarizer.run(pcm, { maxSpeakers: 1 });
      assert.deepEqual([...new Set(capped.map((s) => s.speaker))], [0]);
    } finally {
      await diarizer.dispose();
    }
  });
});
