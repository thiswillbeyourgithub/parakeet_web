# /// script
# requires-python = ">=3.10"
# dependencies = ["onnxruntime>=1.20", "onnx>=1.16", "numpy", "librosa", "soundfile"]
# ///
"""Verification gates for a W4A8 encoder produced by quantize-w4a8.py:

 0. graph: MatMulNBits present, every node carries bits=4, block_size=32 and
    accuracy_level=4 (a silently dropped accuracy_level means fp32 activations)
 1. batch-1 with length = T-1: finite (the hop-multiple case onnx-asr produces)
 2. batch-2 mixed lengths: all NaN, i.e. the mask-free build's pad tripwire
    survived the int4 rewrite
 3. batch-2 equal lengths: finite
 4. agreement with the fp32 encoder on real speech

Gate 4 deliberately uses real audio through the shipped preprocessor rather than
random noise: white noise is far outside a mel encoder's input distribution, the
trajectory through 24 conformer layers is chaotic there, and the resulting
divergence says nothing about deployment behaviour (measured: corr 0.71 on noise
vs 0.97 on speech for the same model). Even on speech, expect correlation near
0.97 rather than 1.0; int4 weights plus int8 activations genuinely move the
encoder output, so WER on a real eval set is the acceptance criterion, and this
gate only catches gross breakage.

Usage: check-w4a8.py <w4a8.onnx> <fp32.onnx> <nemo128.onnx> <wav...>
Written with Claude Code.
"""
import sys
from collections import Counter

import librosa
import numpy as np
import onnx
import onnxruntime as ort

CORR_MIN = 0.90  # gross-breakage floor, not a quality target; see docstring

w4, ref, pre = sys.argv[1:4]
wavs = sys.argv[4:]
opts = ort.SessionOptions()
opts.log_severity_level = 3
rng = np.random.default_rng(0)
fail = 0

graph = onnx.load(w4, load_external_data=False).graph
ops = Counter(n.op_type for n in graph.node)
nbits = [n for n in graph.node if n.op_type == "MatMulNBits"]
attrs = [{a.name: a.i for a in n.attribute if a.name in ("accuracy_level", "bits", "block_size")}
         for n in nbits]
levels = {a.get("accuracy_level") for a in attrs}
bits = {a.get("bits") for a in attrs}
blocks = {a.get("block_size") for a in attrs}
ok = bool(nbits) and levels == {4} and bits == {4} and blocks == {32}
print(f"[0] MatMulNBits={len(nbits)} MatMul_left={ops.get('MatMul', 0)} "
      f"accuracy_level={levels} bits={bits} block_size={blocks}: {ok}", flush=True)
fail += not ok

load = lambda p: ort.InferenceSession(p, opts, providers=["CPUExecutionProvider"])
run = lambda s, x, lens: s.run(None, {"audio_signal": x, "length": np.asarray(lens, dtype=np.int64)})
sq = load(w4)

x = rng.standard_normal((1, 128, 729)).astype(np.float32)
finite = bool(np.isfinite(run(sq, x, [728])[0]).all())
print(f"[1] batch-1 len=T-1: finite={finite}", flush=True)
fail += not finite

x2 = rng.standard_normal((2, 128, 201)).astype(np.float32)
allnan = bool(np.isnan(run(sq, x2, [201, 100])[0]).all())
print(f"[2] batch-2 mixed lens: all-NaN={allnan}", flush=True)
fail += not allnan

finite = bool(np.isfinite(run(sq, x2, [201, 201])[0]).all())
print(f"[3] batch-2 equal lens: finite={finite}", flush=True)
fail += not finite

sp, sr = load(pre), load(ref)
pin = [i.name for i in sp.get_inputs()]
for w in wavs:
    audio = librosa.load(w, sr=16000)[0].astype(np.float32)[None, :]
    feats = sp.run(None, {pin[0]: audio, pin[1]: np.array([audio.shape[1]], dtype=np.int64)})
    x, xl = feats[0], feats[1].astype(np.int64)
    q, ql = run(sq, x, xl)
    f, fl = run(sr, x, xl)
    rel = float(np.abs(q - f).max() / (np.abs(f).max() + 1e-9))
    corr = float(np.corrcoef(q.ravel(), f.ravel())[0, 1])
    ok = bool(np.isfinite(q).all()) and corr > CORR_MIN and np.array_equal(ql, fl)
    print(f"[4] {w.split('/')[-1]} T={x.shape[2]} relMaxDiff {rel:.3f} corr {corr:.5f}: {ok}", flush=True)
    fail += not ok

print("W4A8 CHECKS", "FAILED" if fail else "ALL PASS", flush=True)
sys.exit(1 if fail else 0)
