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
decode (no decoder logic is duplicated here), and transcribes the audio in ONE
single pass with NO chunking. It prints two tables:

  1. OVERALL: WER, wall-clock time and peak RAM for each quant.
  2. PER SECTION: WER of each quant in successive time windows, to expose whether
     accuracy decays as the single uninterrupted pass gets longer (the web app
     never hits this because it chunks; here we deliberately do not).

How the per-section reference is built (the honest part): the model is reliable
on SHORT audio, so for each time window we transcribe that window *independently*
as its own short clip and treat that as the section's reference. The section
HYPOTHESIS is the slice of the single full-pass output whose token timestamps
fall in the window (onnx-asr's with_timestamps() gives per-token times). So each
row asks: "did this stretch of speech come out worse as part of one long pass
than it does on its own?" Rising WER down the table = long-pass degradation.

Each quant (and the reference pass) runs in its OWN subprocess so peak RAM is
isolated and attributable; loading several models in one process would just pile
their memory together. RAM is peak process RSS (resource.ru_maxrss), reported
absolute (whole CPU-EP process) and as the delta over the pre-load baseline (the
model's own footprint). NOTE: this is host RAM because onnx-asr here uses the
CPU execution provider; it is NOT a VRAM figure. On WebGPU the weights live in
GPU memory instead (encoder sizes per CLAUDE.md: int8 ~600 MB, fp16 ~1.2 GB,
fp32 ~2.4 GB), and the CPU/WASM EP cannot even load fp16/fp32, so those
WebGPU/VRAM numbers can only be observed on a real GPU, not here.

Default subject: the FULL JFK "We choose to go to the Moon" speech (~17.7 min),
the gitignored cache produced by scripts/gen-jfk-moon-fixtures.mjs at
test/e2e/.cache/jfk-moon/full.mp3. If that file is missing, run that generator
first (it downloads + transcodes the public-domain master), or pass --audio.

HARD LIMIT (why there is a --max-pass-sec cap): this Parakeet encoder's exported
relative positional-encoding table tops out at 5000 frames. At the encoder's
12.5 frames/s that is exactly 400.0 s (6.67 min) of audio; a single pass longer
than that aborts in the first attention layer with an ONNX broadcast error
("axis ... was false ... N by N+5000"). So a true no-chunking pass over the
whole 17.7 min speech is IMPOSSIBLE with this model, regardless of quant (the
graph, hence the cap, is identical for int8/fp16/fp32). We therefore cap the
single pass at --max-pass-sec (default 390 s, safely under the 400 s wall) and
measure the per-section trend within that feasible window. The production web
app never hits this because it chunks far below 400 s.

Quantisation -> files in the model dir:
  int8 -> encoder-model.int8.onnx + decoder_joint-model.int8.onnx
  fp16 -> encoder-model.fp16.onnx + decoder_joint-model.fp16.onnx
  fp32 -> encoder-model.onnx (+ .data)  + decoder_joint-model.onnx

Usage (deps are declared inline via PEP 723, so uv installs them on first run):
  uv run scripts/wer-quants.py
  uv run scripts/wer-quants.py --section-sec 90
  uv run scripts/wer-quants.py --audio clip.mp3 --reference @ref.txt
  uv run scripts/wer-quants.py --quants int8,fp16 --reference-quant fp32

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

DEFAULT_AUDIO = ROOT / "test/e2e/.cache/jfk-moon/full.mp3"

# The encoder's exported positional-encoding table caps at 5000 frames @ 12.5
# frames/s = 400.0 s; a single pass past that aborts in the first attention
# layer. Default the cap just under it. (Empirically: 400 s OK, 410 s fails.)
DEFAULT_MAX_PASS_SEC = 390.0


def peak_rss_mb():
    # ru_maxrss is KiB on Linux, bytes on macOS.
    kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return (kb if sys.platform == "darwin" else kb * 1024) / (1024 * 1024)


def load_audio(path, max_sec=None):
    """Load mono 16 kHz audio, truncated to max_sec (the single-pass ceiling)."""
    import librosa

    wav, sr = librosa.load(path, sr=16000, mono=True)
    if max_sec and len(wav) > int(max_sec * sr):
        wav = wav[:int(max_sec * sr)]
    return wav, sr


def windows(audio_sec, section_sec):
    """Yield (start, end) time windows covering [0, audio_sec)."""
    start = 0.0
    while start < audio_sec:
        yield start, min(start + section_sec, audio_sec)
        start += section_sec


# --- child modes (each runs in its own process for clean RAM accounting) ----

def child_full(args):
    """Single full-pass transcription with token timestamps; emit JSON result."""
    import onnx_asr

    wav, sr = load_audio(args.audio, args.max_pass_sec)
    baseline_mb = peak_rss_mb()  # interpreter + libs + decoded audio, before the model

    t0 = time.perf_counter()
    model = onnx_asr.load_model(args.model, path=args.model_dir, quantization=QUANT_ARG[args.quant])
    t1 = time.perf_counter()
    res = model.with_timestamps().recognize(wav)
    t2 = time.perf_counter()

    emit({
        "text": res.text,
        "tokens": res.tokens,
        "timestamps": res.timestamps,
        "load_s": t1 - t0,
        "infer_s": t2 - t1,
        "audio_sec": len(wav) / sr,
        "peak_mb": peak_rss_mb(),
        "baseline_mb": baseline_mb,
    })


def child_oracle(args):
    """Transcribe each time window independently; emit the per-window reference."""
    import onnx_asr

    wav, sr = load_audio(args.audio, args.max_pass_sec)
    audio_sec = len(wav) / sr
    model = onnx_asr.load_model(args.model, path=args.model_dir, quantization=QUANT_ARG[args.quant])

    sections = []
    for start, end in windows(audio_sec, args.section_sec):
        clip = wav[int(start * sr):int(end * sr)]
        sections.append({"start": start, "end": end, "text": model.recognize(clip)})
    emit({"audio_sec": audio_sec, "section_sec": args.section_sec, "sections": sections})


def emit(obj):
    print("__RESULT__" + json.dumps(obj))


def spawn(args, mode, quant):
    """Run this script as a child in the given mode/quant; parse its JSON result."""
    cmd = [sys.executable, __file__, "--_child", mode, "--quant", quant,
           "--audio", args.audio, "--model", args.model, "--model-dir", args.model_dir,
           "--section-sec", str(args.section_sec), "--max-pass-sec", str(args.max_pass_sec)]
    print(f"  [{mode}/{quant}] running...", file=sys.stderr, flush=True)
    out = subprocess.run(cmd, capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if line.startswith("__RESULT__"):
            return json.loads(line[len("__RESULT__"):])
    raise RuntimeError((out.stderr or out.stdout).strip()[-500:] or "no result from child")


# --- parent helpers ---------------------------------------------------------

def resolve_text(value):
    if value.startswith("@"):
        return Path(value[1:]).read_text(encoding="utf-8")
    return value


def slice_tokens(tokens, timestamps, start, end):
    """Reconstruct the full-pass text for a time window from its tokens.

    onnx-asr tokens carry their own leading-space markers, so ''.join rebuilds
    natural text. A token is assigned to the window containing its start time.
    """
    return "".join(t for t, ts in zip(tokens, timestamps) if start <= ts < end)


def fmt_pct(x):
    return "   -  " if x is None else f"{100 * x:5.1f}%"


def parse_args(argv):
    p = argparse.ArgumentParser(description="WER + timing + RAM + per-section WER across int8/fp16/fp32.")
    p.add_argument("--audio", default=str(DEFAULT_AUDIO))
    p.add_argument(
        "--reference", default=None,
        help="overall-table reference text, or @file. Default: the per-section "
             "oracle (independent short-clip transcription) concatenated.",
    )
    p.add_argument(
        "--reference-quant", default="fp32", choices=list(QUANT_ARG),
        help="quant used to build the per-section oracle reference (default fp32).",
    )
    p.add_argument("--section-sec", type=float, default=60.0, help="section window length (s).")
    p.add_argument(
        "--max-pass-sec", type=float, default=DEFAULT_MAX_PASS_SEC,
        help=f"cap the single pass to this many seconds (default {DEFAULT_MAX_PASS_SEC:g}; "
             "the encoder aborts past ~400 s / 5000 frames).",
    )
    p.add_argument("--quants", default="int8,fp16,fp32")
    p.add_argument("--model", default="nemo-parakeet-tdt-0.6b-v3")
    p.add_argument("--model-dir", default=str(ROOT / "fallback_models"))
    # internal: child dispatch
    p.add_argument("--_child", dest="child", choices=["full", "oracle"], help=argparse.SUPPRESS)
    p.add_argument("--quant", help=argparse.SUPPRESS)
    return p.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    if args.child == "full":
        return child_full(args)
    if args.child == "oracle":
        return child_oracle(args)

    from jiwer import wer

    if not Path(args.audio).exists():
        sys.exit(f"audio not found: {args.audio}\n"
                 "Generate the full moon-speech cache first:\n"
                 "  node scripts/gen-jfk-moon-fixtures.mjs\n"
                 "or pass --audio <file>.")

    requested = [q.strip() for q in args.quants.split(",") if q.strip()]
    for q in requested:
        if q not in QUANT_ARG:
            sys.exit(f"unknown quant {q!r} (choose from {list(QUANT_ARG)})")
    # Always process in the canonical order int8 -> fp16 -> fp32, whatever the
    # order they were given in.
    quants = [q for q in QUANT_ARG if q in requested]

    print(f"audio: {args.audio}")
    print(f"       single pass, NO chunking; quants = {', '.join(quants)}; "
          f"sections = {args.section_sec:g}s; oracle = {args.reference_quant}")
    print(f"       single pass capped at {args.max_pass_sec:g}s (encoder pos-encoding wall "
          f"is ~400s / 5000 frames; a longer pass aborts)\n")
    print("transcribing (each pass in its own process):", file=sys.stderr)

    # Single full pass per quant first, in canonical int8 -> fp16 -> fp32 order so
    # the cheapest/fastest result lands first.
    results = {}
    for q in quants:
        try:
            results[q] = spawn(args, "full", q)
        except Exception as e:  # one bad quant should not kill the others
            results[q] = {"error": str(e)}

    # Then the per-section oracle reference: independent short-clip transcription
    # per window (order does not affect results; tables are built below).
    oracle = spawn(args, "oracle", args.reference_quant)
    sections = oracle["sections"]
    audio_sec = oracle["audio_sec"]

    # ---- Table 1: overall WER + time + RAM ----
    if args.reference is not None:
        overall_ref = resolve_text(args.reference)
        ref_label = args.reference if not args.reference.startswith("@") else Path(args.reference[1:]).name
    else:
        overall_ref = " ".join(s["text"] for s in sections)
        ref_label = f"{args.reference_quant} oracle (independent {args.section_sec:g}s clips, concatenated)"

    print(f"\nreference (overall): {ref_label}")
    print(f"transcribed: {audio_sec:.1f}s ({audio_sec / 60:.1f} min) of the single pass "
          f"(capped at {args.max_pass_sec:g}s)\n")
    print("== Overall (full single pass) ==")
    print("quant   WER       load     infer     RTF     peak RAM   model RAM   words")
    print("-----   -------   ------   -------   -----   --------   ---------   -----")
    for q in quants:
        r = results[q]
        if "error" in r:
            print(f"{q:<6}  FAILED: {r['error']}")
            continue
        w = wer(overall_ref, r["text"])
        rtf = r["infer_s"] / r["audio_sec"]
        model_mb = r["peak_mb"] - r["baseline_mb"]
        n = len(r["text"].split())
        print(
            f"{q:<6}  {100 * w:6.2f}%   {r['load_s']:5.1f}s   {r['infer_s']:6.1f}s   "
            f"{rtf:5.3f}   {r['peak_mb']:6.0f} MB   {model_mb:6.0f} MB   {n:5d}"
        )

    # ---- Table 2: per-section WER ----
    ok = [q for q in quants if "error" not in results[q]]
    print(f"\n== Per-section WER (hypothesis = full-pass slice; reference = {args.reference_quant} short clip) ==")
    header = "section          ref words  " + "  ".join(f"{q:>6}" for q in ok)
    print(header)
    print("-" * len(header))
    for i, sec in enumerate(sections):
        ref_i = sec["text"]
        label = f"{sec['start']:6.0f}-{sec['end']:<6.0f}s"
        ref_n = len(ref_i.split())
        cells = []
        for q in ok:
            r = results[q]
            hyp_i = slice_tokens(r["tokens"], r["timestamps"], sec["start"], sec["end"])
            w = None if not ref_i.strip() else wer(ref_i, hyp_i)
            cells.append(fmt_pct(w))
        print(f"{label}      {ref_n:5d}     " + "  ".join(f"{c:>6}" for c in cells))

    print("\nLower WER is better. Per-section WER measures the single long pass against an "
          "independent short-clip transcription of the same window; a trend of rising WER "
          "down the table is the long-pass degradation you suspected. "
          "RAM is host memory, not VRAM (see the module docstring).")


if __name__ == "__main__":
    main(sys.argv[1:])
