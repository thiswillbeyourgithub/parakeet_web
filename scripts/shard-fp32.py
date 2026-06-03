#!/usr/bin/env python
"""Shard the fp32 Parakeet encoder's external weights into <2 GB pieces so the
fp32 encoder can load on the WASM backend / in-browser.

Why (see CLAUDE.md for the full reasoning): the fp32 encoder is ~2.4 GB held in
ONE encoder-model.onnx.data sidecar. That single file trips two *ingest* walls
that block WASM, and neither is a total-memory limit:
  1. a 32-bit WASM ArrayBuffer caps at ~2 GB (2^31-1), and
  2. Chromium's blob-URL fetch caps near 2 GB.
The wasm32 heap ceiling itself is ~4 GB, and fp32 (unlike fp16, which the CPU/WASM
EP upcasts to fp32 at session build) stays ~2.4 GB resident, so it *should* fit
once no single buffer exceeds 2 GB. This script rewrites the encoder's per-tensor
external_data locations to spread the initializers across N shard files, each under
a configurable byte budget (default 1.5 GB), producing:

  encoder-model.onnx              (graph; tensors now point at the shards)
  encoder-model.onnx.data.000
  encoder-model.onnx.data.001
  ...

onnxruntime-node (native) resolves these from disk by the graph's location fields;
the WASM / browser loader mounts each shard as a separate externalData entry (each
< 2 GB), sidestepping both caps. No weights are altered: this is a pure repack, so
WER must be identical to the single-file fp32. That equality is the whole point of
the experiment (does fp32 hold up on a long chunk where int8 drops content), so the
script never touches tensor values, only where their bytes live.

Usage:
  python scripts/shard-fp32.py                                  # ./fallback_models -> ./fallback_models/sharded
  python scripts/shard-fp32.py --model-dir DIR --out-dir DIR
  python scripts/shard-fp32.py --max-shard-bytes 1000000000     # smaller shards (lower transient load peak)
  python scripts/shard-fp32.py --encoder encoder-model.onnx     # non-default encoder name

Requires: onnx.

Built with Claude Code.
"""

import argparse
import os
import sys

import onnx
from onnx import TensorProto
from onnx.external_data_helper import set_external_data

# Default shard budget. 1.5 GB leaves comfortable headroom under the 2 GB
# ArrayBuffer / blob caps even after a tensor that would straddle a boundary is
# pushed whole into the next shard. Smaller shards lower the transient load peak
# (ORT holds a shard's bytes in the heap while deserialising it), at the cost of
# more files; 1.5 GB is a sane default for a ~2.4 GB encoder (-> 2 shards).
DEFAULT_MAX_SHARD_BYTES = 1_500_000_000

# Tensors below this many bytes stay inline in the graph proto (mirrors onnx's
# own default size_threshold): sharding tiny scalars/biases is pointless and just
# inflates the file count.
INLINE_THRESHOLD_BYTES = 1024


def human(n):
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def tensor_nbytes(t):
    # After load_external_data the bytes live in raw_data; that is the only field
    # the fp32 encoder's big initializers use. Non-raw tensors are left inline.
    return len(t.raw_data) if t.HasField("raw_data") else 0


def shard_model(in_path, out_path, max_shard_bytes):
    if not os.path.exists(in_path):
        raise FileNotFoundError(f"missing input model: {in_path}")

    # Pull the sibling .onnx.data into raw_data so we see real bytes to repack.
    # Needs ~the encoder's size in RAM (~2.4 GB); cheap given the repack savings.
    print(f"[shard] loading {in_path} (+ external data) ...")
    model = onnx.load(in_path, load_external_data=True)

    out_dir = os.path.dirname(out_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.basename(out_path)  # e.g. encoder-model.onnx

    # Greedy bin-pack: walk initializers, open a new shard whenever adding the
    # next tensor whole would exceed the budget. A single tensor larger than the
    # budget gets its own shard (we never split a tensor across files, so each
    # tensor's external_data stays a simple (location, offset, length)).
    shard_idx = 0
    shard_offset = 0
    shard_file = None
    shard_paths = []
    inline_count = 0
    externalised = 0

    def shard_location(idx):
        return f"{base}.data.{idx:03d}"

    def open_shard(idx):
        loc = shard_location(idx)
        path = os.path.join(out_dir, loc)
        f = open(path, "wb")
        shard_paths.append(path)
        return f, loc

    shard_file, shard_loc = open_shard(shard_idx)

    try:
        for t in model.graph.initializer:
            nbytes = tensor_nbytes(t)
            if nbytes < INLINE_THRESHOLD_BYTES:
                inline_count += 1
                continue  # leave small tensors inline in the graph

            # Roll to the next shard if this tensor would push us over budget,
            # unless the current shard is still empty (a tensor bigger than the
            # whole budget then lands alone in its own shard).
            if shard_offset > 0 and shard_offset + nbytes > max_shard_bytes:
                shard_file.close()
                shard_idx += 1
                shard_offset = 0
                shard_file, shard_loc = open_shard(shard_idx)

            data = t.raw_data
            shard_file.write(data)
            set_external_data(t, location=shard_loc, offset=shard_offset, length=nbytes)
            t.ClearField("raw_data")
            t.data_location = TensorProto.EXTERNAL
            shard_offset += nbytes
            externalised += 1
    finally:
        if shard_file:
            shard_file.close()

    # The initializers now reference the shard files; save the graph as-is (the
    # external_data is already set, so save_as_external_data=False is correct and
    # must stay False or onnx would try to re-pack into a single file).
    onnx.save(model, out_path, save_as_external_data=False)

    sizes = [os.path.getsize(p) for p in shard_paths]
    print(f"[shard] wrote {os.path.basename(out_path)} + {len(shard_paths)} shard(s) "
          f"({externalised} external tensors, {inline_count} kept inline):")
    for p, s in zip(shard_paths, sizes):
        flag = "  <-- OVER 2 GB!" if s >= 2 ** 31 else ""
        print(f"         {os.path.basename(p)}  {human(s)}{flag}")
    total = sum(sizes)
    over = [p for p, s in zip(shard_paths, sizes) if s >= 2 ** 31]
    print(f"[shard] total external: {human(total)} across {len(shard_paths)} shard(s)")
    if over:
        print(f"[shard] WARNING: {len(over)} shard(s) still exceed 2 GB; lower --max-shard-bytes",
              file=sys.stderr)
    return shard_paths


def link_sibling(src_dir, out_dir, name):
    """Make `name` available in out_dir (symlink, falling back to copy) so the
    output is a complete model dir for wer-bench/transcribe without duplicating
    multi-hundred-MB files. Skips silently when src and out are the same dir or
    the source is absent."""
    src = os.path.join(src_dir, name)
    dst = os.path.join(out_dir, name)
    if not os.path.exists(src) or os.path.abspath(src) == os.path.abspath(dst):
        return
    if os.path.lexists(dst):
        os.remove(dst)
    try:
        os.symlink(os.path.relpath(src, out_dir), dst)
    except OSError:
        import shutil
        shutil.copy2(src, dst)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-dir", default="./fallback_models",
                    help="dir holding encoder-model.onnx (+ .onnx.data). Default ./fallback_models")
    ap.add_argument("--out-dir", default=None,
                    help="where to write the sharded encoder + a complete model dir "
                         "(default: <model-dir>/sharded). Pass the same value as --model-dir to shard in place.")
    ap.add_argument("--encoder", default="encoder-model.onnx",
                    help="encoder graph filename within --model-dir (default encoder-model.onnx)")
    ap.add_argument("--max-shard-bytes", type=int, default=DEFAULT_MAX_SHARD_BYTES,
                    help=f"max bytes per shard (default {DEFAULT_MAX_SHARD_BYTES}, i.e. 1.5 GB)")
    args = ap.parse_args()

    out_dir = args.out_dir or os.path.join(args.model_dir, "sharded")
    in_path = os.path.join(args.model_dir, args.encoder)
    out_path = os.path.join(out_dir, args.encoder)

    if args.max_shard_bytes >= 2 ** 31:
        print("[shard] WARNING: --max-shard-bytes >= 2 GB defeats the purpose "
              "(shards must stay under the WASM/blob 2 GB cap)", file=sys.stderr)

    shard_model(in_path, out_path, args.max_shard_bytes)

    # Round out the output into a self-contained model dir so wer-bench can point
    # --model-dir straight at it. The fp32 decoder/vocab/preproc are reused as-is.
    if os.path.abspath(out_dir) != os.path.abspath(args.model_dir):
        for name in ("decoder_joint-model.onnx", "vocab.txt", "nemo128.onnx", "config.json"):
            link_sibling(args.model_dir, out_dir, name)
        print(f"[shard] linked decoder/vocab/preproc into {out_dir}")

    print(f"[shard] done. Use: node scripts/wer-bench.mjs --model-dir {out_dir} --configs fp32@60 --ort wasm")


if __name__ == "__main__":
    main()
