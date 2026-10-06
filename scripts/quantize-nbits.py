# /// script
# requires-python = ">=3.10"
# dependencies = ["onnx>=1.16", "onnxruntime>=1.20", "onnx_ir", "numpy"]
# ///
"""Rewrite every eligible MatMul of an encoder into MatMulNBits: block-wise
weights (--block-size, symmetric) with accuracy_level=4, so the kernel dynamically
quantizes activations to int8. At --bits 4 that is W4A8, at --bits 8 it is W8A8.
Neither needs calibration data. WebGPU dequantizes to fp16 instead, so there the
same file behaves as W4A16 / W8A16 with an unchanged download size.

Both widths ship: the 4-bit encoder is the smallest download, the 8-bit one is
this repo's `int8` and is a different recipe from the static QDQ int8 upstream
ships, which needs a calibration campaign to place its activation ranges. Here
the activation range is recomputed per run inside the kernel, so there is no
calibration set to go stale and no long-audio drift from a mismatched range.

Attention's activation-times-activation MatMuls have no constant weight and stay
fp32, as do the convolutions and LayerNorms.

--ternary is for an encoder whose weights are ALREADY ternary per block, i.e.
parakeet-redux after hf-to-nemo.py expanded it: every block of --block-size
weights along K is {-a, 0, +a}. Rounding those through the RTN quantizer is not
exact (its symmetric grid does not put +a and -a on codes), so ORT still builds
the graph but the packed weights and scales are overwritten with the exact
encoding, code = sign + default zero point, scale = a, which any width from 2
bits up represents losslessly. A MatMul whose weight is not ternary (the
subsampling projection) is left fp32 rather than rounded, and the result is
checked by dequantizing every packed tensor back against its source.

--dense-bits N (with --ternary) packs those non-ternary MatMuls too, in a second
pass at N bits and --dense-block-size, instead of leaving them fp32. Built for a
mixed encoder: parakeet-redux with the UltiMed finetune's delta added to its last
4 layers (the only ones the finetune trained), so layers 0-19 stay exact 2-bit
ternary and the dense layers 20-23 get 8 bits (2026-10-06).

Usage: quantize-nbits.py <src.onnx> <dst.onnx> [--bits {2,4,8}] [--ternary [--dense-bits {4,8}]]
Verify the result with check-nbits.py before shipping it. Written with Claude Code.
"""
import argparse
import inspect
import time
from collections import Counter
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper

try:  # ORT >= ~1.22 renamed the module and generalized the class
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer as Quantizer
except ImportError as exc:
    # Only fall back for a genuinely old ORT. That module also imports onnx_ir, so
    # without this guard a missing dependency masquerades as an old install and the
    # fallback raises a second, misleading ImportError about matmul_4bits_quantizer.
    if "matmul_nbits_quantizer" not in str(exc):
        raise
    from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer as Quantizer

# Protobuf caps a single message at 2 GB. Both widths land well under it, so the
# output collapses to one self-contained file, which is what the app's filename
# probe expects; the margin keeps a larger future encoder from silently failing.
INLINE_MAX_BYTES = 1.9e9

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("src", type=Path, help="fp32 encoder to quantize")
ap.add_argument("dst", type=Path, help="output path, e.g. encoder-model.w4a8.onnx")
ap.add_argument("--bits", type=int, default=4, choices=(2, 4, 8),
                help="weight width (default 4). ORT's MatMulNBits accepts 2, 4 or 8. Activations are "
                     "int8 at every width: accuracy_level tops out at 4 (int8), so there is no 'a4'.")
ap.add_argument("--block-size", type=int, default=32,
                help="weights per quantization block (default 32). One fp32 scale is stored per "
                     "block, so the scale payload is weights*4/block_size bytes: at 8 bits that is "
                     "72.5 MB of scales at 32 and 38.8 MB at 64, for identical packed weights. "
                     "Larger blocks shrink the file and the resident footprint at some accuracy "
                     "cost. Must be a power of two >= 16 for ORT's kernels.")
ap.add_argument("--ternary", action="store_true",
                help="pack already-ternary weights exactly instead of rounding them; non-ternary "
                     "MatMuls stay fp32 (see the module docstring)")
ap.add_argument("--dense-bits", type=int, choices=(4, 8),
                help="with --ternary: pack the non-ternary MatMuls at this width instead of leaving them fp32")
ap.add_argument("--dense-block-size", type=int, default=64,
                help="block size of the --dense-bits pass (default 64, as the shipped int8 encoders)")
args = ap.parse_args()
if args.dense_bits and not args.ternary:
    raise SystemExit("--dense-bits only makes sense with --ternary")

if args.block_size < 16 or args.block_size & (args.block_size - 1):
    raise SystemExit(f"--block-size must be a power of two >= 16, got {args.block_size}")
src, dst = args.src, args.dst
dst.parent.mkdir(parents=True, exist_ok=True)

t0 = time.time()
model = onnx.load(str(src))
before = Counter(n.op_type for n in model.graph.node)



def ternary_blocks(w, block):
    """[K, N] weight -> (signs int8 [N, K], scale [N, K/block]) when every block of
    `block` rows in every column is {-a, 0, +a}; None otherwise."""
    k, n = w.shape
    if k % block:
        return None
    b = w.T.reshape(n, k // block, block)
    scale = np.abs(b).max(axis=2)
    if not np.array_equal(np.abs(b), (b != 0) * scale[..., None]):
        return None
    return np.sign(b).astype(np.int8).reshape(n, k), scale.astype(np.float32)


def pack(signs, bits, block):
    """Signs [N, K] -> MatMulNBits B [N, K/block, block*bits/8], element i of a
    block in bits (i % per) of byte (i // per), lowest first, around the default
    zero point 2^(bits-1) that a symmetric node without zero_points implies."""
    n, k = signs.shape
    per = 8 // bits
    q = (signs.astype(np.int16) + (1 << (bits - 1))).astype(np.uint8).reshape(n, k // block, block // per, per)
    out = np.zeros(q.shape[:3], np.uint8)
    for i in range(per):
        out |= q[..., i] << (bits * i)
    return out


ternary, exclude = {}, []
if args.ternary:
    inits = {t.name: t for t in model.graph.initializer}
    for node in model.graph.node:
        if node.op_type != "MatMul" or node.input[1] not in inits:
            continue
        w = numpy_helper.to_array(inits[node.input[1]])
        hit = ternary_blocks(w, args.block_size) if w.ndim == 2 else None
        if hit is None:
            exclude.append(node.name)
        else:
            ternary[node.input[1]] = hit
    print(f"ternary: {len(ternary)} MatMul weights pack exactly, {len(exclude)} stay fp32: {exclude}", flush=True)

kwargs = dict(block_size=args.block_size, is_symmetric=True, accuracy_level=4)
if "bits" in inspect.signature(Quantizer.__init__).parameters:
    kwargs["bits"] = args.bits
elif args.bits != 4:
    raise SystemExit(f"{Quantizer.__name__} in this onnxruntime is 4-bit only; --bits {args.bits} unavailable")
print(f"using {Quantizer.__name__} kwargs={kwargs}", flush=True)
if exclude:
    kwargs["nodes_to_exclude"] = exclude
q = Quantizer(model, **kwargs)
q.process()
if ternary:
    done = 0
    for init in q.model.model.graph.initializer:
        for suffix, is_b in ((f"_Q{args.bits}", True), ("_scales", False)):
            src = init.name[: -len(suffix)] if init.name.endswith(suffix) else None
            if src not in ternary:
                continue
            signs, scale = ternary[src]
            new = pack(signs, args.bits, args.block_size) if is_b else scale.reshape(numpy_helper.to_array(init).shape)
            old = numpy_helper.to_array(init)
            assert old.shape == new.shape and old.dtype == new.dtype, (init.name, old.shape, new.shape)
            init.CopyFrom(numpy_helper.from_array(new, init.name))
            done += is_b
    if done != len(ternary):
        raise SystemExit(f"ternary: rewrote {done} packed weights, expected {len(ternary)}")
    # Decode what was written, independently of how it was written, and compare
    # to the source weights: exactness is the whole point of this mode.
    got = {t.name: numpy_helper.to_array(t) for t in q.model.model.graph.initializer}
    per, zp = 8 // args.bits, 1 << (args.bits - 1)
    for src, (signs, scale) in ternary.items():
        blob = got[f"{src}_Q{args.bits}"]
        codes = np.stack([(blob >> (args.bits * i)) & ((1 << args.bits) - 1) for i in range(per)], -1)
        dq = (codes.reshape(signs.shape).astype(np.float32) - zp) * np.repeat(got[f"{src}_scales"].reshape(scale.shape), args.block_size, 1)
        ref = np.sign(signs) * np.repeat(scale, args.block_size, 1)
        if not np.array_equal(dq, ref):
            raise SystemExit(f"ternary: {src} does not decode back exactly")
    print(f"ternary: {done} weights packed and verified bit-exact", flush=True)
if args.dense_bits and exclude:
    # The ternary pass turned its MatMuls into MatMulNBits, so the only MatMuls with a
    # constant weight left are the excluded dense ones.
    dk = dict(kwargs, bits=args.dense_bits, block_size=args.dense_block_size)
    dk.pop("nodes_to_exclude", None)
    q = Quantizer(q.model.model, **dk)
    q.process()
    print(f"dense: {len(exclude)} non-ternary MatMuls packed at {args.dense_bits} bits, block {args.dense_block_size}", flush=True)
q.model.save_model_to_file(str(dst), use_external_data_format=True)

data = dst.parent / (dst.name + ".data")
if dst.stat().st_size + (data.stat().st_size if data.exists() else 0) < INLINE_MAX_BYTES:
    onnx.save(onnx.load(str(dst)), str(dst), save_as_external_data=False)
    data.unlink(missing_ok=True)

after = Counter(n.op_type for n in onnx.load(str(dst), load_external_data=False).graph.node)
print(f"MatMul {before['MatMul']} -> {after.get('MatMul', 0)}; MatMulNBits {after.get('MatMulNBits', 0)}", flush=True)
mb = lambda p: p.stat().st_size / 1e6
print(f"size: {mb(dst):.1f}MB" + (f" graph + {mb(data):.1f}MB data" if data.exists() else " single file"), flush=True)
print(f"W{args.bits}A8 QUANTIZE DONE in {time.time() - t0:.0f}s", flush=True)
