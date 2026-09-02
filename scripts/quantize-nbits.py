# /// script
# requires-python = ">=3.10"
# dependencies = ["onnx>=1.16", "onnxruntime>=1.20", "onnx_ir"]
# ///
"""Rewrite every eligible MatMul of an encoder into MatMulNBits: block-wise
weights (block 32, symmetric) with accuracy_level=4, so the kernel dynamically
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

Usage: quantize-nbits.py <src.onnx> <dst.onnx> [--bits {4,8}]
Verify the result with check-nbits.py before shipping it. Written with Claude Code.
"""
import argparse
import inspect
import time
from collections import Counter
from pathlib import Path

import onnx

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
args = ap.parse_args()
src, dst = args.src, args.dst
dst.parent.mkdir(parents=True, exist_ok=True)

t0 = time.time()
model = onnx.load(str(src))
before = Counter(n.op_type for n in model.graph.node)

kwargs = dict(block_size=32, is_symmetric=True, accuracy_level=4)
if "bits" in inspect.signature(Quantizer.__init__).parameters:
    kwargs["bits"] = args.bits
elif args.bits != 4:
    raise SystemExit(f"{Quantizer.__name__} in this onnxruntime is 4-bit only; --bits {args.bits} unavailable")
print(f"using {Quantizer.__name__} kwargs={kwargs}", flush=True)
q = Quantizer(model, **kwargs)
q.process()
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
