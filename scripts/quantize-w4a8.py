# /// script
# requires-python = ">=3.10"
# dependencies = ["onnx>=1.16", "onnxruntime>=1.20"]
# ///
"""Rewrite every eligible MatMul of an encoder into MatMulNBits: block-wise int4
weights (block 32, symmetric) with accuracy_level=4, so the kernel dynamically
quantizes activations to int8. That is W4A8 on the CPU/WASM path and needs no
calibration data; WebGPU dequantizes to fp16 instead, so there it behaves as
W4A16 with the same download size.

Attention's activation-times-activation MatMuls have no constant weight and stay
fp32, as do the convolutions and LayerNorms.

Usage: quantize-w4a8.py <src.onnx> <dst.onnx>
Verify the result with check-w4a8.py before shipping it. Written with Claude Code.
"""
import inspect
import sys
from collections import Counter
from pathlib import Path

import onnx

try:  # ORT >= ~1.22 renamed the module and generalized the class
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer as Quantizer
except ImportError:
    from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer as Quantizer

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.parent.mkdir(parents=True, exist_ok=True)

model = onnx.load(str(src))
before = Counter(n.op_type for n in model.graph.node)

kwargs = dict(block_size=32, is_symmetric=True, accuracy_level=4)
if "bits" in inspect.signature(Quantizer.__init__).parameters:
    kwargs["bits"] = 4
print(f"using {Quantizer.__name__} kwargs={kwargs}", flush=True)
q = Quantizer(model, **kwargs)
q.process()
q.model.save_model_to_file(str(dst), use_external_data_format=True)

after = Counter(n.op_type for n in onnx.load(str(dst), load_external_data=False).graph.node)
print(f"MatMul {before['MatMul']} -> {after.get('MatMul', 0)}; MatMulNBits {after.get('MatMulNBits', 0)}", flush=True)
mb = lambda p: p.stat().st_size / 1e6
print(f"sizes: graph {mb(dst):.1f}MB, data {mb(dst.parent / (dst.name + '.data')):.1f}MB", flush=True)
print("W4A8 QUANTIZE DONE", flush=True)
