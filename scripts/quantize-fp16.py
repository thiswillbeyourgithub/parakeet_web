#!/usr/bin/env python
"""Convert the fp32 Parakeet ONNX pieces to float16, to land under the WASM /
Chromium ~2 GB blob limits without the heavy accuracy loss of int8.

Why fp16 (see CLAUDE.md for the full reasoning): the fp32 encoder is ~2.44 GB
of external weights, which cannot load on the WASM backend (32-bit WASM caps a
single ArrayBuffer at ~2 GB and Chromium's blob-URL fetch caps around 2 GB
too). int8 (~600 MB) fits but degrades quality. fp16 halves the fp32 weights to
~1.2 GB: under both caps, and near-lossless versus fp32. This script produces
that fp16 variant from locally-supplied fp32 files so it can be benchmarked
(scripts/wer-bench.mjs) before deciding whether to ship it.

It converts the two pieces that matter:
  - encoder-model.onnx (+ encoder-model.onnx.data)  -> encoder-model.fp16.onnx
  - decoder_joint-model.onnx                         -> decoder_joint-model.fp16.onnx
nemo128.onnx (the ONNX preprocessor) is intentionally skipped: the web app and
scripts/transcribe.mjs use the pure-JS mel preprocessor (mel.js), so the ONNX
preprocessor is never loaded.

keep_io_types=True is deliberate and load-bearing: the encoder/decoder graphs
take and return float32 tensors (audio_signal, outputs, encoder_outputs, and
the decoder's LSTM input_states_*/output_states_*). Keeping the I/O boundary at
float32 means the JS pipeline (parakeet.js) feeds and reads exactly the same
dtypes as for the fp32/int8 models, so NOTHING in the JS side needs to change;
only the weights and internal compute become fp16.

Usage:
  python scripts/quantize-fp16.py                       # ./fallback_models in place
  python scripts/quantize-fp16.py --model-dir DIR --out-dir DIR
  python scripts/quantize-fp16.py --external-data       # force .onnx.data sidecar

Requires: onnx, onnxruntime (provides onnxruntime.transformers.float16).

Built with Claude Code.
"""

import argparse
import os
import sys
import time

import onnx
from onnxruntime.transformers.float16 import convert_float_to_float16
from onnxruntime.transformers.onnx_model import OnnxModel

# (input fp32 file, output fp16 file). Only the encoder carries external weights.
PIECES = [
    ("encoder-model.onnx", "encoder-model.fp16.onnx"),
    ("decoder_joint-model.onnx", "decoder_joint-model.fp16.onnx"),
]

# Single-protobuf serialisation hard-caps at 2 GB. The fp16 encoder is ~1.2 GB
# so an inline save normally fits, but we keep a margin and fall back to an
# external-data sidecar (which scripts/transcribe.mjs createSession() already
# resolves via the "<model>.data" probe) if we get close.
TWO_GB = 2 * 1024 ** 3


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024


def file_size(path):
    total = os.path.getsize(path)
    data = path + ".data"
    if os.path.exists(data):
        total += os.path.getsize(data)
    return total


def convert_one(in_path, out_path, force_external, op_block_list):
    if not os.path.exists(in_path):
        raise FileNotFoundError(f"missing input model: {in_path}")

    in_size = file_size(in_path)
    print(f"[fp16] {os.path.basename(in_path)} ({human(in_size)}) -> "
          f"{os.path.basename(out_path)}")

    # load_external_data=True (default) pulls the sibling .onnx.data into memory
    # so the converter sees real tensors. This needs ~the fp32 model's size in
    # RAM for the encoder (~2.4 GB); that is the price of an in-memory convert.
    t0 = time.time()
    model = onnx.load(in_path, load_external_data=True)

    # disable_shape_infer=True: onnx shape inference serialises the model to run,
    # which would hit the 2 GB protobuf limit on the fp32 encoder. keep_io_types
    # pins the float32 boundary so the converter still inserts the right casts.
    fp16_model = convert_float_to_float16(
        model,
        keep_io_types=True,
        disable_shape_infer=True,
        op_block_list=op_block_list if op_block_list else None,
    )

    # keep_io_types=True prepends graph_input_cast_* / appends graph_output_cast_*
    # nodes but does NOT re-sort the graph, leaving it not topologically sorted.
    # onnx.checker rejects that and ORT-web fails to build the session (it
    # surfaced as a std::bad_alloc). A topological sort fixes the node order.
    OnnxModel(fp16_model).topological_sort()
    convert_s = time.time() - t0

    # Estimate serialized size to choose inline vs external. ByteSize() is exact
    # but can itself overflow near 2 GB, so guard it.
    try:
        approx = fp16_model.ByteSize()
        big = approx >= TWO_GB - (64 * 1024 ** 2)  # 64 MB safety margin
    except (ValueError, OverflowError):
        big = True

    use_external = force_external or big

    # A stale sidecar from a previous run would be silently reused by ORT, so
    # clear it when we are NOT writing external data this time.
    sidecar = out_path + ".data"
    if not use_external and os.path.exists(sidecar):
        os.remove(sidecar)

    if use_external:
        onnx.save(
            fp16_model, out_path,
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location=os.path.basename(sidecar),
            convert_attribute=False,
        )
    else:
        onnx.save(fp16_model, out_path)

    out_size = file_size(out_path)
    print(f"       converted in {convert_s:.1f}s, "
          f"{'external' if use_external else 'inline'} -> {human(out_size)} "
          f"({100 * out_size / in_size:.0f}% of fp32)")
    return in_size, out_size


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-dir", default="fallback_models",
                    help="directory holding the fp32 .onnx files (default: fallback_models)")
    ap.add_argument("--out-dir", default=None,
                    help="output directory (default: same as --model-dir)")
    ap.add_argument("--external-data", action="store_true",
                    help="always write weights to a .onnx.data sidecar (default: inline when it fits under 2 GB)")
    ap.add_argument("--op-block-list", default="",
                    help="comma-separated ONNX op types to keep in fp32 (default: the converter's built-in list)")
    args = ap.parse_args()

    model_dir = args.model_dir
    out_dir = args.out_dir or model_dir
    os.makedirs(out_dir, exist_ok=True)
    op_block_list = [s.strip() for s in args.op_block_list.split(",") if s.strip()]

    total_in = total_out = 0
    for in_name, out_name in PIECES:
        in_size, out_size = convert_one(
            os.path.join(model_dir, in_name),
            os.path.join(out_dir, out_name),
            args.external_data,
            op_block_list,
        )
        total_in += in_size
        total_out += out_size

    print(f"[fp16] done: {human(total_in)} fp32 -> {human(total_out)} fp16 "
          f"({100 * total_out / total_in:.0f}%). vocab.txt is reused as-is.")
    enc_out = file_size(os.path.join(out_dir, "encoder-model.fp16.onnx"))
    if enc_out >= TWO_GB:
        print(f"[fp16] WARNING: fp16 encoder is {human(enc_out)}, still >= 2 GB; "
              f"it will NOT load on the WASM backend.", file=sys.stderr)


if __name__ == "__main__":
    main()
