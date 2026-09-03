# /// script
# requires-python = ">=3.10"
# dependencies = ["onnx>=1.16", "onnxruntime>=1.20", "onnxconverter-common>=1.14", "sympy"]
# ///
"""Cast an fp32 encoder to fp16, halving the download without touching the graph
structure. This is NOT quantisation and so lives outside quantize-nbits.py: there
are no blocks, no scales and no zero points, just a narrower float. Verify the
result with `check-nbits.py --bits 16`, which runs the same gates 1-4.

It exists for WebGPU. The GPU path already computes in fp16 internally, so storing
fp32 on disk buys nothing there and costs 2.4 GB of download; the CPU/WASM path is
the opposite, having no native fp16 arithmetic, so it would emulate and lose. Ship
this one to GPU users and leave WASM on the MatMulNBits encoders.

--keep-io (default) leaves the graph's inputs and outputs fp32 and inserts casts at
the boundary, so callers that already feed fp32 mel features keep working untouched.

Usage: convert-fp16.py <src.onnx> <dst.onnx> [--no-keep-io] [--block-ops Op,Op]
Written with Claude Code.
"""
import argparse
import time
from collections import Counter
from pathlib import Path

import onnx
from onnxconverter_common import float16

# Ops left in fp32 on purpose. The reductions and the normalisation accumulate over
# the whole feature axis, where fp16's 11-bit mantissa is the difference between a
# stable sum and a drifting one, and Range/shape arithmetic is not float work at all.
DEFAULT_BLOCK = ["Softmax", "LayerNormalization", "ReduceMean", "ReduceMax", "ReduceMin", "Range"]

INLINE_MAX_BYTES = 1.9e9

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("src", type=Path)
ap.add_argument("dst", type=Path)
ap.add_argument("--no-keep-io", action="store_true", help="also make the graph inputs/outputs fp16")
ap.add_argument("--block-ops", default=",".join(DEFAULT_BLOCK),
                help="comma-separated op types to leave in fp32")
args = ap.parse_args()
args.dst.parent.mkdir(parents=True, exist_ok=True)

def length_cone(graph):
    """Names of the nodes that compute the int64 graph outputs, to keep in fp32.

    This encoder computes `encoded_lengths` the way the conv stack shrinks time:
    cast the int64 length to float, divide by the stride, add, cast back. The
    constants in that chain are float initializers, so a blanket fp16 pass drags
    them down with the activations and leaves the Cast nodes at fp32, which is the
    "Type parameter (T) of Optype (Mul) bound to different types" load failure.

    It has to stay fp32 for a second and better reason: fp16 represents integers
    exactly only up to 2048, and these sequences reach ~25k frames, so a length
    computed in fp16 would silently come out wrong well before it failed to load.

    Walk BACKWARD from the int64 graph outputs, not forward from `length`. Forward
    is wrong: the first node that mixes a length with an activation drags its
    activation outputs into the set, and the cone swallows the whole graph
    (measurably: it blocked all 2,247 nodes and converted nothing). Backward from
    `encoded_lengths` is exactly the length arithmetic, because that output depends
    on `length` alone.
    """
    producer = {o: n for n in graph.node for o in n.output}
    want = [o.name for o in graph.output if o.type.tensor_type.elem_type == onnx.TensorProto.INT64]
    names, seen = set(), set()
    while want:
        t = want.pop()
        if t in seen:
            continue
        seen.add(t)
        n = producer.get(t)
        if n is not None:
            names.add(n.name)
            want.extend(n.input)
    return names


t0 = time.time()
model = onnx.load(str(args.src))
before = Counter(n.op_type for n in model.graph.node)
block = [s for s in args.block_ops.split(",") if s]
keep32 = sorted(length_cone(model.graph))
print(f"loaded {args.src.name} in {time.time() - t0:.0f}s, {sum(before.values())} nodes; "
      f"fp32 op types: {block or 'none'}; fp32 length-arithmetic nodes: {len(keep32)}", flush=True)

# Use ORT's converter rather than onnxconverter_common's. The latter never rewrites
# a pre-existing `Cast to=FLOAT`, and this graph has one feeding BOTH the length
# arithmetic and the padding mask. The mask then stays fp32 while the activation it
# multiplies goes fp16, and the model will not load ("Type parameter (T) of Optype
# (Mul) bound to different types" at /pre_encode/conv/Mul_3). Flipping that cast is
# not an option either, since the length side genuinely needs fp32. ORT's version
# reconciles the mixed edges by inserting casts where they are actually needed.
from onnxruntime.transformers.onnx_model import OnnxModel

om = OnnxModel(model)
om.convert_float_to_float16(keep_io_types=not args.no_keep_io,
                            op_block_list=block + [n for n in keep32])
out = om.model

# Shape inference has to stay off: this graph is over protobuf's 2 GB cap, so the
# converter cannot re-run it and the value_info entries it leaves behind still
# claim fp32 for tensors that are now fp16. ORT then refuses the model outright
# ("Type (tensor(float16)) ... does not match expected type (tensor(float))").
# These annotations are optional for intermediates, so drop them and let ORT infer
# the types at load. Inputs and outputs keep their own declarations, which is what
# --keep-io is about.
del out.graph.value_info[:]

# Name the sidecar ourselves: without `location` onnx picks a uuid1 name, which the
# cleanup below never matched (each run leaked one weight-sized blob). onnx also
# appends to an existing sidecar instead of replacing it, so start from a clean file.
data = args.dst.parent / (args.dst.name + ".data")
data.unlink(missing_ok=True)
onnx.save(out, str(args.dst), save_as_external_data=True, location=data.name)
if args.dst.stat().st_size + (data.stat().st_size if data.exists() else 0) < INLINE_MAX_BYTES:
    onnx.save(onnx.load(str(args.dst)), str(args.dst), save_as_external_data=False)
    data.unlink(missing_ok=True)

after = Counter(n.op_type for n in onnx.load(str(args.dst), load_external_data=False).graph.node)
mb = lambda p: p.stat().st_size / 1e6
print(f"nodes {sum(before.values())} -> {sum(after.values())} (Cast {before.get('Cast', 0)} -> "
      f"{after.get('Cast', 0)})", flush=True)
print(f"size: {mb(args.dst):.1f}MB" + (f" graph + {mb(data):.1f}MB data" if data.exists() else " single file"),
      flush=True)
print(f"FP16 CONVERT DONE in {time.time() - t0:.0f}s", flush=True)
