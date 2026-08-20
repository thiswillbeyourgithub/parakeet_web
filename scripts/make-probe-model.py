#!/usr/bin/env -S uv run --quiet --with onnx --with onnxruntime --with numpy --python 3.12
"""Generate the tiny ONNX artifacts used by the first-load performance probe.

The probe (app/ui/src/lib/perfProbe.js + probe.worker.js) answers ONE question
on the visitor's own machine: is the WebGPU path meaningfully faster here than
the plain WASM path? A capability check cannot answer it (every WebGPU adapter
"supports" the ops; the historical 15x-slower verdict came from a real GPU),
so the only honest answer is to run the same shape of work through both
execution providers and time it.

Why a synthetic graph instead of the real encoder: the real encoder is
600 MB (int8) to 2.4 GB (fp32), which is precisely the download the probe
exists to decide about. These artifacts are ~5 MB together (about 0.8% of the
smallest real download), so they can be prefetched in the background of a
normal page load.

Fidelity choices, and why each matters for the verdict:
  - ONE weight tensor is shared by every MatMul node. The nodes are CHAINED
    (each consumes the previous output), so nothing can be folded or
    common-subexpression-eliminated; it just keeps the file ~N times smaller
    than the work it does.
  - The op mix mirrors a conformer block's hot path: MatMul, bias Add, SiLU
    (Sigmoid+Mul, what the real encoder uses) and LayerNormalization. GEMM
    dominates real encoder time, and it is also what separates a GPU from a
    CPU, so it dominates here too.
  - The CPU arm is INT8 and the GPU arm is FP32, because that is what each
    backend actually runs (WASM loads the int8 encoder, WebGPU loads fp16/
    fp32). Timing both arms in fp32 would flatter the GPU by the 2-3x that
    int8 buys the CPU, and picking the GPU wrongly is the expensive mistake:
    it costs the user a 1.2-2.4 GB download instead of ~600 MB. Where the two
    precisions cannot be matched exactly the bias is deliberately toward the
    CPU (fp32 on an f16-capable GPU under-reports the GPU).

Usage (writes app/ui/public/probe/, run from the repo root):
    uv run scripts/make-probe-model.py

Written with the help of Claude Code.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization import QuantType, quantize_dynamic

# Probe geometry, CALIBRATED rather than guessed (2026-08-20, see the sweep
# recorded in PERF_PLAN #13). These are the real encoder's shapes: DIM=1024 is
# the model's d_model, and SEQ=768 is about what a 60 s chunk becomes after the
# 8x subsampling (750 frames), so every MatMul here is the size of a MatMul
# there. That matters more than it sounds: an earlier 256x512 probe reported
# only 2.8x on a box whose true end-to-end gap is 5.4x, because GPU per-node
# JSEP overhead (~0.5 ms) swamped the tiny GEMMs, and a 1024x1024x2 variant
# reported 1.8x. At these shapes the same box reads 4.45x against 5.4x truth,
# i.e. it under-reports the GPU slightly, which is the direction that keeps a
# wrong answer cheap. BLOCKS=4 is the smallest count that keeps a run long
# enough to time (about 100 ms on CPU) without making a weak laptop wait.
SEQ = 768
DIM = 1024
BLOCKS = 4
SEED = 20260820  # fixed so rebuilds are byte-reproducible


def build_fp32(path: Path, seq: int = SEQ, dim: int = DIM, blocks: int = BLOCKS) -> None:
    rng = np.random.default_rng(SEED)
    # Small init keeps activations in a sane range through the chained blocks,
    # so the int8 arm quantizes to something representative instead of
    # saturating (a saturated graph would measure the same speed but is a
    # worse stand-in for the real encoder's numerics).
    scale = 1.0 / np.sqrt(dim)
    weight = (rng.standard_normal((dim, dim)) * scale).astype(np.float32)
    bias = np.zeros((dim,), dtype=np.float32)
    ln_scale = np.ones((dim,), dtype=np.float32)
    ln_bias = np.zeros((dim,), dtype=np.float32)

    initializers = [
        numpy_helper.from_array(weight, "W"),
        numpy_helper.from_array(bias, "B"),
        numpy_helper.from_array(ln_scale, "LN_scale"),
        numpy_helper.from_array(ln_bias, "LN_bias"),
    ]

    nodes = []
    cur = "input"
    for i in range(blocks):
        mm, add, sig, mul, ln = (f"mm_{i}", f"add_{i}", f"sig_{i}", f"mul_{i}", f"ln_{i}")
        # Every block reuses W/B/LN_*: same bytes on disk, fresh work at runtime.
        nodes.append(helper.make_node("MatMul", [cur, "W"], [mm], name=f"MatMul_{i}"))
        nodes.append(helper.make_node("Add", [mm, "B"], [add], name=f"Add_{i}"))
        # SiLU / swish, the conformer activation: x * sigmoid(x).
        nodes.append(helper.make_node("Sigmoid", [add], [sig], name=f"Sigmoid_{i}"))
        nodes.append(helper.make_node("Mul", [add, sig], [mul], name=f"Mul_{i}"))
        out = "output" if i == blocks - 1 else ln
        nodes.append(
            helper.make_node(
                "LayerNormalization",
                [mul, "LN_scale", "LN_bias"],
                [out],
                name=f"LayerNorm_{i}",
                axis=-1,
                epsilon=1e-5,
            )
        )
        cur = out

    graph = helper.make_graph(
        nodes,
        "parakeet-perf-probe",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, seq, dim])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, seq, dim])],
        initializer=initializers,
    )
    # Opset 17 is the floor for LayerNormalization as a single op; ORT-web's
    # WASM and WebGPU EPs both implement it there.
    model = helper.make_model(
        graph,
        opset_imports=[helper.make_operatorsetid("", 17)],
        producer_name="parakeet-web/make-probe-model.py",
    )
    model.ir_version = 9  # ORT-web 1.2x rejects newer IR versions
    onnx.checker.check_model(model)
    path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(path))


def build_int8(fp32_path: Path, int8_path: Path) -> None:
    # Dynamic quantization is what the shipped encoder uses for its MatMuls
    # (activations quantized per run, weights int8), so the CPU arm measures
    # the same MatMulInteger kernels the real WASM path leans on.
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
        extra_options={"MatMulConstBOnly": True},
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parents[1] / "app" / "ui" / "public" / "probe"),
        help="directory to write probe-encoder.fp32.onnx and probe-encoder.int8.onnx into",
    )
    ap.add_argument("--seq", type=int, default=SEQ, help=f"sequence length (default {SEQ})")
    ap.add_argument("--dim", type=int, default=DIM, help=f"model width (default {DIM})")
    ap.add_argument("--blocks", type=int, default=BLOCKS, help=f"chained blocks (default {BLOCKS})")
    ap.add_argument("--tag", default="", help="filename suffix, for calibration sweeps")
    args = ap.parse_args()

    out = Path(args.out_dir)
    fp32_path = out / f"probe-encoder{args.tag}.fp32.onnx"
    int8_path = out / f"probe-encoder{args.tag}.int8.onnx"

    build_fp32(fp32_path, seq=args.seq, dim=args.dim, blocks=args.blocks)
    build_int8(fp32_path, int8_path)

    for p in (fp32_path, int8_path):
        print(f"{p.relative_to(Path.cwd()) if p.is_relative_to(Path.cwd()) else p}: {p.stat().st_size / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
