#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["onnx>=1.16", "onnxruntime>=1.20", "onnx_ir", "numpy"]
# ///
"""End-to-end tests for quantize-nbits.py --ternary on a tiny synthetic graph:
two MatMuls, one with ternary-per-block weights and one with ordinary ones.
quantize-nbits.py is a top-level script, so each test runs it as a subprocess
and inspects the file it wrote. main() runs every T-test sequentially (no pytest
harness, matching test_wer-quants.py).

  uv run scripts/test_quantize-nbits.py

Built with Claude Code.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper

SCRIPT = Path(__file__).resolve().parent / "quantize-nbits.py"
K, N, BLOCK = 256, 64, 128
rng = np.random.default_rng(0)
W_TERN = ((rng.integers(0, 3, (K, N)) - 1) * np.repeat(rng.random((K // BLOCK, N)) + 0.1, BLOCK, 0)).astype(np.float32)
W_DENSE = rng.standard_normal((N, N)).astype(np.float32)


def build(path):
    nodes = [helper.make_node("MatMul", ["x", "wt"], ["h"], name="tern"),
             helper.make_node("MatMul", ["h", "wd"], ["y"], name="dense")]
    g = helper.make_graph(nodes, "g", [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, K])],
                          [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, N])],
                          [numpy_helper.from_array(W_TERN, "wt"), numpy_helper.from_array(W_DENSE, "wd")])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
    m.ir_version = 9
    onnx.save(m, str(path))


def quantize(tmp, bits, ternary=True):
    src, dst = tmp / "src.onnx", tmp / f"dst{bits}.onnx"
    build(src)
    cmd = [sys.executable, str(SCRIPT), str(src), str(dst), "--bits", str(bits), "--block-size", str(BLOCK)]
    r = subprocess.run(cmd + (["--ternary"] if ternary else []), capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-2000:]
    return dst, r.stdout


def dequant(model, bits):
    inits = {t.name: numpy_helper.to_array(t) for t in model.graph.initializer}
    node = next(n for n in model.graph.node if n.op_type == "MatMulNBits")
    blob, scales = inits[node.input[1]], inits[node.input[2]]
    per = 8 // bits
    codes = np.stack([(blob >> (bits * i)) & ((1 << bits) - 1) for i in range(per)], -1).reshape(N, K)
    return ((codes.astype(np.float32) - (1 << (bits - 1))) * np.repeat(scales.reshape(N, -1), BLOCK, 1)).T


def T1_ternary_is_bit_exact_at_2_and_4_bits():
    for bits in (2, 4):
        with tempfile.TemporaryDirectory() as d:
            dst, out = quantize(Path(d), bits)
            assert "verified bit-exact" in out, out
            assert np.array_equal(dequant(onnx.load(str(dst)), bits), W_TERN), bits


def T2_non_ternary_matmul_stays_fp32():
    with tempfile.TemporaryDirectory() as d:
        dst, _ = quantize(Path(d), 2)
        ops = {n.name: n.op_type for n in onnx.load(str(dst)).graph.node}
        assert ops["dense"] == "MatMul", ops
        assert list(ops.values()).count("MatMulNBits") == 1, ops


def T3_ternary_graph_runs_in_ort_and_matches():
    x = rng.standard_normal((1, K)).astype(np.float32)
    ref = x @ W_TERN @ W_DENSE
    for bits in (2, 4):
        with tempfile.TemporaryDirectory() as d:
            dst, _ = quantize(Path(d), bits)
            y = ort.InferenceSession(str(dst), providers=["CPUExecutionProvider"]).run(None, {"x": x})[0]
            # accuracy_level=4 quantizes activations to int8, so this is close, not equal.
            assert np.abs(y - ref).max() / np.abs(ref).max() < 0.03, bits


def T4_plain_rtn_is_not_exact_which_is_why_ternary_exists():
    with tempfile.TemporaryDirectory() as d:
        dst, _ = quantize(Path(d), 4, ternary=False)
        assert not np.array_equal(dequant(onnx.load(str(dst)), 4), W_TERN)


def main():
    tests = [v for k, v in globals().items() if k[:1] == "T" and k[1:2].isdigit()]
    for t in tests:
        t()
        print(f"PASS {t.__name__}", flush=True)
    print(f"all {len(tests)} passed")


if __name__ == "__main__":
    main()
