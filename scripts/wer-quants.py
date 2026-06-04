#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "onnx-asr[cpu]",
#     "librosa",
#     "jiwer",
# ]
# ///
"""Mini WER + timing + RAM bench across encoder quantisations (int8/fp16/fp32).

Unlike scripts/wer-bench.mjs (which drives the repo's own JS pipeline and its
chunked TDT decode), this is a deliberately small Python harness built on the
UPSTREAM onnx-asr library: the same library this whole web app is a port of. It
loads the exact ONNX pieces in ./fallback_models, lets onnx-asr do the TDT
decode (no decoder logic is duplicated here), and reports WER, wall-clock time,
and peak RAM for each quant in one table.

Each quant runs in its OWN subprocess so peak RAM is isolated and attributable;
loading all three in one process would just pile their memory together. RAM is
measured as peak process RSS (resource.ru_maxrss), reported both absolute (the
whole CPU-EP process) and as the delta over the pre-load baseline (the model's
own footprint). NOTE: this is host RAM because onnx-asr here uses the CPU
execution provider; it is NOT a VRAM figure. On WebGPU the weights live in GPU
memory instead (encoder sizes per CLAUDE.md: int8 ~600 MB, fp16 ~1.2 GB, fp32
~2.4 GB), and the CPU/WASM EP cannot even load fp16/fp32, so those WebGPU/VRAM
numbers can only be observed on a real GPU, not here.

The default subject is the committed 3-minute JFK "We choose to go to the Moon"
fixture, whose reference is this repo's int8 golden transcript. Caveats:
  - onnx-asr transcribes the whole file in one pass (no 20 s chunk window), so
    int8 here shows the long-chunk degradation the web app avoids by capping the
    int8 window. That is exactly the effect worth seeing.
  - the default reference is the int8 *golden* transcript, so treat the absolute
    int8 WER as a baseline, not as truth. Pass --reference @file (or
    --reference-quant fp32 to score everyone against the fp32 output) instead.

Quantisation -> files in the model dir:
  int8 -> encoder-model.int8.onnx + decoder_joint-model.int8.onnx
  fp16 -> encoder-model.fp16.onnx + decoder_joint-model.fp16.onnx
  fp32 -> encoder-model.onnx (+ .data)  + decoder_joint-model.onnx

Usage (deps are declared inline via PEP 723, so uv installs them on first run):
  uv run scripts/wer-quants.py
  uv run scripts/wer-quants.py --audio clip.mp3 --reference @ref.txt
  uv run scripts/wer-quants.py --quants int8,fp16,fp32 --reference-quant fp32

Or with an environment that already has the deps: python scripts/wer-quants.py
(needs onnx-asr, librosa, jiwer).

Built with Claude Code.
"""

import argparse
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# quant label -> onnx-asr `quantization` argument (None == fp32, the plain files)
QUANT_ARG = {"int8": "int8", "fp16": "fp16", "fp32": None}


def peak_rss_mb():
    # ru_maxrss is KiB on Linux, bytes on macOS.
    kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return (kb if sys.platform == "darwin" else kb * 1024) / (1024 * 1024)


def run_one_quant(args):
    """Child mode: transcribe `audio` under one quant, emit a JSON result line.

    Runs in its own process so peak RSS reflects only this quant.
    """
    import librosa
    import onnx_asr

    wav, sr = librosa.load(args.audio, sr=16000, mono=True)
    baseline_mb = peak_rss_mb()  # interpreter + libs + decoded audio, before the model

    t0 = time.perf_counter()
    model = onnx_asr.load_model(args.model, path=args.model_dir, quantization=QUANT_ARG[args.quant])
    t1 = time.perf_counter()
    text = model.recognize(wav)
    t2 = time.perf_counter()

    print("__RESULT__" + json.dumps({
        "text": text,
        "load_s": t1 - t0,
        "infer_s": t2 - t1,
        "audio_sec": len(wav) / sr,
        "peak_mb": peak_rss_mb(),
        "baseline_mb": baseline_mb,
    }))


def spawn_quant(args, quant):
    """Parent mode: run this script as a child for one quant, parse its result."""
    cmd = [sys.executable, __file__, "--_child", "--quant", quant,
           "--audio", args.audio, "--model", args.model, "--model-dir", args.model_dir]
    out = subprocess.run(cmd, capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if line.startswith("__RESULT__"):
            return json.loads(line[len("__RESULT__"):])
    raise RuntimeError((out.stderr or out.stdout).strip()[-400:] or "no result from child")


def resolve_text(value):
    if value.startswith("@"):
        return Path(value[1:]).read_text(encoding="utf-8")
    return value


def parse_args(argv):
    p = argparse.ArgumentParser(description="WER + timing + RAM across int8/fp16/fp32.")
    p.add_argument("--audio", default=str(ROOT / "test/fixtures/jfk-moon-3min.mp3"))
    p.add_argument(
        "--reference",
        default="@" + str(ROOT / "test/fixtures/jfk-moon-3min.expected.txt"),
        help="reference text, or @path to a file (default: the moon int8 golden).",
    )
    p.add_argument(
        "--reference-quant",
        choices=list(QUANT_ARG),
        help="score every quant against this quant's own output instead of --reference.",
    )
    p.add_argument("--quants", default="int8,fp16,fp32")
    p.add_argument("--model", default="nemo-parakeet-tdt-0.6b-v2")
    p.add_argument("--model-dir", default=str(ROOT / "fallback_models"))
    # internal: run a single quant in a child process
    p.add_argument("--_child", dest="child", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--quant", help=argparse.SUPPRESS)
    return p.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    if args.child:
        return run_one_quant(args)

    from jiwer import wer

    quants = [q.strip() for q in args.quants.split(",") if q.strip()]
    for q in quants:
        if q not in QUANT_ARG:
            sys.exit(f"unknown quant {q!r} (choose from {list(QUANT_ARG)})")

    print(f"audio: {args.audio}")
    print(f"       quants = {', '.join(quants)} (each in its own process)\n")

    results = {}
    for q in quants:
        try:
            results[q] = spawn_quant(args, q)
        except Exception as e:  # one bad quant should not kill the others
            results[q] = {"error": str(e)}

    if args.reference_quant:
        ref = results.get(args.reference_quant, {}).get("text")
        if ref is None:
            sys.exit(f"--reference-quant {args.reference_quant} produced no text")
        ref_label = f"{args.reference_quant} output"
    else:
        ref = resolve_text(args.reference)
        ref_label = args.reference if not args.reference.startswith("@") else Path(args.reference[1:]).name

    audio_sec = next((r["audio_sec"] for r in results.values() if "audio_sec" in r), 0)
    print(f"reference: {ref_label}")
    if audio_sec:
        print(f"audio length: {audio_sec:.1f}s\n")

    print("quant   WER       load     infer    RTF     peak RAM   model RAM   words")
    print("-----   -------   ------   ------   -----   --------   ---------   -----")
    for q in quants:
        r = results[q]
        if "error" in r:
            print(f"{q:<6}  FAILED: {r['error']}")
            continue
        w = wer(ref, r["text"])
        rtf = r["infer_s"] / r["audio_sec"]
        model_mb = r["peak_mb"] - r["baseline_mb"]
        n = len(r["text"].split())
        print(
            f"{q:<6}  {100 * w:6.2f}%   {r['load_s']:5.1f}s   {r['infer_s']:5.1f}s   "
            f"{rtf:5.3f}   {r['peak_mb']:6.0f} MB   {model_mb:6.0f} MB   {n:5d}"
        )
    print("\nWER vs the reference above (lower is better). RTF = infer / audio length. "
          "peak RAM = whole CPU-EP process; model RAM = peak minus pre-load baseline. "
          "RAM is host memory, not VRAM (see the module docstring).")


if __name__ == "__main__":
    main(sys.argv[1:])
