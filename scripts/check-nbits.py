# /// script
# requires-python = ">=3.10"
# dependencies = ["onnxruntime>=1.20", "onnx>=1.16", "numpy", "librosa", "soundfile"]
# ///
"""Verification gates for a MatMulNBits encoder produced by quantize-nbits.py,
at either width (--bits 4 for the w4a8 build, --bits 8 for the int8 one):

 0. graph: MatMulNBits present, every node carries the requested bits, plus
    block_size=32 and accuracy_level=4 (a silently dropped accuracy_level means
    fp32 activations)
 1. batch-1 with length = T-1: finite (the hop-multiple case onnx-asr produces)
 2. batch-2 mixed lengths: all NaN, i.e. the mask-free build's pad tripwire
    survived the rewrite
 3. batch-2 equal lengths: finite
 4. agreement with the fp32 encoder on real speech

Gate 4 deliberately uses real audio through the shipped preprocessor rather than
random noise: white noise is far outside a mel encoder's input distribution, the
trajectory through 24 conformer layers is chaotic there, and the resulting
divergence says nothing about deployment behaviour (measured: corr 0.71 on noise
vs 0.97 on speech for the same model). Even on speech, expect correlation near
0.97 at 4 bits and nearer 1.0 at 8; quantized weights plus int8 activations
genuinely move the encoder output, so WER on a real eval set is the acceptance
criterion, and this gate only catches gross breakage.

Usage: check-nbits.py <quant.onnx> <fp32.onnx> <nemo128.onnx> <wav...> [--bits {4,8}]
Written with Claude Code.
"""
import argparse
import sys
from collections import Counter

import librosa
import numpy as np
import onnx
import onnxruntime as ort

CORR_MIN = 0.90  # gross-breakage floor, not a quality target; see docstring

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("quant", help="the MatMulNBits encoder under test")
ap.add_argument("ref", help="the fp32 encoder it was built from")
ap.add_argument("pre", help="nemo128.onnx preprocessor")
ap.add_argument("wavs", nargs="+", help="real speech for gate 4")
ap.add_argument("--bits", type=int, default=4, choices=(2, 4, 8, 16),
                help="width the graph should carry (default 4). 2/4/8 expect MatMulNBits from "
                     "quantize-nbits.py; 16 expects an fp16 cast from convert-fp16.py, which is a "
                     "different transformation but earns the same gates 1-4.")
args = ap.parse_args()

opts = ort.SessionOptions()
opts.log_severity_level = 3
rng = np.random.default_rng(0)
fail = 0

model = onnx.load(args.quant, load_external_data=False)
graph = model.graph
ops = Counter(n.op_type for n in graph.node)
if args.bits == 16:
    # fp16 carries no MatMulNBits. Some fp32 initializers are EXPECTED to survive:
    # the ops on the block list (LayerNormalization, the reductions) keep their fp32
    # parameters on purpose. So gate on the share of float weight BYTES that moved,
    # not on the absence of fp32, and check the fp32 entry points are still fp32
    # since the app feeds fp32 mel features either way.
    import math
    share = {}
    for i in graph.initializer:
        nm = onnx.TensorProto.DataType.Name(i.data_type)
        if nm in ("FLOAT", "FLOAT16"):
            size = math.prod(i.dims) * (4 if nm == "FLOAT" else 2)
            share[nm] = share.get(nm, 0) + size
    tot = sum(share.values()) or 1
    frac16 = share.get("FLOAT16", 0) / tot
    io = {onnx.TensorProto.DataType.Name(v.type.tensor_type.elem_type)
          for v in list(graph.input) + list(graph.output)}
    ok = frac16 > 0.80 and not ops.get("MatMulNBits") and io <= {"FLOAT", "INT64"}
    print(f"[0] fp16 share of float weight bytes {frac16:.1%} "
          f"(fp32 left {share.get('FLOAT', 0) / 1e6:.1f}MB) io={sorted(io)} "
          f"MatMulNBits={ops.get('MatMulNBits', 0)}: {ok}", flush=True)
else:
    nbits = [n for n in graph.node if n.op_type == "MatMulNBits"]
    attrs = [{a.name: a.i for a in n.attribute if a.name in ("accuracy_level", "bits", "block_size")}
             for n in nbits]
    levels = {a.get("accuracy_level") for a in attrs}
    bits = {a.get("bits") for a in attrs}
    blocks = {a.get("block_size") for a in attrs}
    ok = bool(nbits) and levels == {4} and bits == {args.bits} and blocks == {32}
    print(f"[0] MatMulNBits={len(nbits)} MatMul_left={ops.get('MatMul', 0)} "
          f"accuracy_level={levels} bits={bits} block_size={blocks}: {ok}", flush=True)
fail += not ok

load = lambda p: ort.InferenceSession(p, opts, providers=["CPUExecutionProvider"])
run = lambda s, x, lens: s.run(None, {"audio_signal": x, "length": np.asarray(lens, dtype=np.int64)})
sq = load(args.quant)

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

sp, sr = load(args.pre), load(args.ref)
pin = [i.name for i in sp.get_inputs()]
for w in args.wavs:
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

label = "FP16" if args.bits == 16 else f"W{args.bits}A8"
print(f"{label} CHECKS", "FAILED" if fail else "ALL PASS", flush=True)
sys.exit(1 if fail else 0)
