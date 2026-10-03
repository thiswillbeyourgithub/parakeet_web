#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "torch",
#     "transformers @ git+https://github.com/huggingface/transformers",
#     "numpy",
#     "soundfile",
# ]
# ///
"""Reference fixtures for the JS Streaming Sortformer port (app/src/sortformer.js).

Writes two files under test/fixtures/:

  sortformer-cache.json
      The speaker-cache bookkeeping alone, no model needed. A tiny cache config
      (so compression runs many times over a short sequence), random embeds and a
      FAKE step whose logits are a closed-form function of its input, run through
      transformers' own `Nemotron3DiarizationSpeakerCache` and the offline chunk
      loop of `Nemotron3DiarizationForAudioFrameClassification.forward`. Float64
      throughout so the JS port (float64 maths) can be held to ~1e-9.
      Checked by test/unit/sortformer-cache.test.mjs.

      TIES: the fake step keeps at most one speaker active per frame. A frame
      active for two speakers is kept once per speaker, the copies carry
      identical stored probabilities, and at the next compression their scores
      tie EXACTLY. transformers (like NeMo) picks among exact ties with
      torch.topk(sorted=False), whose order is unspecified (libstdc++
      introselect vs partial_sort, and different again on CUDA), so no port can
      reproduce it. The JS port breaks ties by lowest index, deterministically.

  sortformer-two-speakers-x3.bin
      The REAL model's probabilities (float32 transformers forward) for
      test/fixtures/two-speakers.wav repeated three times with 0.5 s of silence
      between (48 s: two chunks, so the second attends to a compressed cache),
      stored as uint16 (p * 65535, row-major [frames, 8]).
      Checked by test/unit/sortformer-model.test.mjs against the local model repo.

Usage (from the repo root):
  uv run scripts/gen-sortformer-fixtures.py

Built with Claude Code.
"""

import base64
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModelForAudioFrameClassification, AutoProcessor
from transformers.models.nemotron3_diarization.configuration_nemotron3_diarization import (
    Nemotron3DiarizationStreamingConfig,
)
from transformers.models.nemotron3_diarization.modeling_nemotron3_diarization import (
    Nemotron3DiarizationSpeakerCache,
)

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "test" / "fixtures"
MODEL_ID = "nvidia/Nemotron-3-Diarization"

# tiny cache: 8 speakers x 3 slots, so budget 2 (1 silence slot each)
CACHE = dict(speaker_cache_length=24, speaker_cache_silence_frames_per_speaker=1, prediction_score_threshold=0.25,
             latest_frames_score_boost=0.05, min_positive_scores_rate=0.5, strong_boost_rate=0.75,
             weak_boost_rate=1.5, num_speakers=8, subsampling_factor=8)
OFFLINE = dict(chunk_length=20, chunk_right_context=4, fifo_length=6, speaker_cache_update_period=17)
HIDDEN = 4
NUM_EMBEDS = 200


def fake_step(embeds):
    """[1, T, H] -> logits [1, 8T, 8]:
    x(8t+j, s) = 3 sin(0.7 (s+1) e[t, s mod H] + 0.02 j + s + 0.5 m[s]),
    m[s] = sum_r cos(r) e[r, (s+1) mod H]. The m term mixes EVERY input row by
    position, cache rows included, so a cache that keeps the wrong frames (or
    the right ones in the wrong order) changes every output, as attention would.
    logit = x for the row's argmax speaker, x - 10 for the others."""
    t = embeds.shape[1]
    s = torch.arange(8, dtype=torch.float64)
    e = embeds[0][:, (torch.arange(8) % HIDDEN)]                  # [T, 8]
    r = torch.arange(t, dtype=torch.float64)
    m = (torch.cos(r)[:, None] * embeds[0][:, ((torch.arange(8) + 1) % HIDDEN)]).sum(0)  # [8]
    j = torch.arange(8, dtype=torch.float64)[None, :, None]       # [1, 8, 1]
    x = 3 * torch.sin(0.7 * (s + 1) * e[:, None, :] + 0.02 * j + s + 0.5 * m)  # [T, 8(j), 8(s)]
    # only the top speaker of each row stays high, so a pooled frame is active
    # for at most one speaker: see TIES in the module docstring
    logits = torch.where(x == x.max(-1, keepdim=True).values, x, x - 10)
    return logits.reshape(1, t * 8, 8)


def cache_fixture():
    rng = np.random.default_rng(1234)
    embeds = torch.from_numpy(rng.normal(size=(1, NUM_EMBEDS, HIDDEN)))
    silence = torch.from_numpy(rng.normal(size=(HIDDEN,)))
    cache = Nemotron3DiarizationSpeakerCache(
        Nemotron3DiarizationStreamingConfig(**CACHE),
        fifo_length=OFFLINE["fifo_length"], speaker_cache_update_period=OFFLINE["speaker_cache_update_period"],
    )
    chunk, rc = OFFLINE["chunk_length"], OFFLINE["chunk_right_context"]
    logits = []
    for start in range(0, NUM_EMBEDS, chunk):
        end = min(start + chunk, NUM_EMBEDS)
        chunk_embeds = embeds[:, start:min(end + rc, NUM_EMBEDS)]
        cached = cache.get_embeds(chunk_embeds)
        step_in = torch.cat([cached, chunk_embeds], dim=1)
        out = fake_step(step_in)
        cache.update(step_in, out, silence, end - start)
        logits.append(out[:, cached.shape[1] * 8:(cached.shape[1] + end - start) * 8])
    probs = torch.cat(logits, dim=1)[0].sigmoid().numpy().astype("<f8")
    assert cache.is_compressed, "fixture must exercise compression"

    config = {
        "hidden_size": HIDDEN, "subsampling_factor": 8, "num_speakers": 8,
        "offline": OFFLINE,
        "speaker_cache": {
            "length": CACHE["speaker_cache_length"],
            "silence_frames_per_speaker": CACHE["speaker_cache_silence_frames_per_speaker"],
            "prediction_score_threshold": CACHE["prediction_score_threshold"],
            "latest_frames_score_boost": CACHE["latest_frames_score_boost"],
            "min_positive_scores_rate": CACHE["min_positive_scores_rate"],
            "strong_boost_rate": CACHE["strong_boost_rate"],
            "weak_boost_rate": CACHE["weak_boost_rate"],
        },
    }
    b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    out = {
        "_about": "generated by scripts/gen-sortformer-fixtures.py; float64 little-endian base64",
        "config": config,
        "numEmbeds": NUM_EMBEDS,
        "embeds": b64(embeds.numpy().astype("<f8")),
        "silence": b64(silence.numpy().astype("<f8")),
        "probs": b64(probs),
    }
    (FIX / "sortformer-cache.json").write_text(json.dumps(out) + "\n")
    print(f"sortformer-cache.json: {probs.shape}")


def model_fixture():
    pcm, sr = sf.read(FIX / "two-speakers.wav", dtype="int16")
    assert sr == 16000 and pcm.ndim == 1
    pcm = pcm.astype(np.float32) / 32768.0
    gap = np.zeros(8000, np.float32)
    audio = np.concatenate([pcm, gap, pcm, gap, pcm])
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForAudioFrameClassification.from_pretrained(MODEL_ID, attn_implementation="eager").eval()
    features = processor(audio, sampling_rate=16000, return_tensors="pt")["input_features"]
    with torch.no_grad():
        probs = model(input_features=features).logits.sigmoid()[0].numpy()
    q = np.round(probs * 65535).astype("<u2")
    (FIX / "sortformer-two-speakers-x3.bin").write_bytes(q.tobytes())
    print(f"sortformer-two-speakers-x3.bin: {probs.shape}, {len(audio) / 16000:.1f} s, "
          f"speakers active: {int((probs > 0.5).any(0).sum())}")


if __name__ == "__main__":
    cache_fixture()
    model_fixture()
