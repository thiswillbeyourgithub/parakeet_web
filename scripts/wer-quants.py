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
     never hits this because it chunks; here we deliberately do not). The table
     ends with a 'worst chunk' row: the MAXIMUM per-section WER per quant, so a
     single catastrophic window is reported exactly even when two quants share a
     near-identical overall WER (the overall figure would average that away).

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
absolute (whole process) and as the delta over the pre-load baseline (the
model's own footprint). NOTE: this is host RAM, NOT a VRAM figure, on BOTH
backends. By default onnx-asr uses the CPU execution provider here; pass --cuda
to run the encoder/decoder on an NVIDIA GPU (CUDA EP, see below). Even under
--cuda the RAM column is still host RSS, not VRAM, so watch nvidia-smi for the
GPU memory (encoder sizes per CLAUDE.md: int8 ~600 MB, fp16 ~1.2 GB, fp32
~2.4 GB). The CPU EP cannot load fp16/fp32 at all, so for those quants --cuda is
the only way to bench them here.

GPU (--cuda): the inline deps pin onnx-asr[cpu] (the CPU onnxruntime wheel, which
has no CUDA EP), so --cuda RE-LAUNCHES the script once through uv with the gpu
extra (onnx-asr[gpu] -> onnxruntime-gpu) and the local NVIDIA CUDA-12 / cuDNN-9
wheel libs put on LD_LIBRARY_PATH, then requests CUDAExecutionProvider (with a
CPU provider after it for op coverage). It needs `uv` on PATH plus a working
NVIDIA GPU + CUDA 12 + cuDNN 9 (onnxruntime-gpu 1.26's requirement); if the CUDA
EP can't initialise the run fails rather than silently using CPU.

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

Encoder vs decoder quant: --quants sweeps the ENCODER quant (that is what this
bench measures), while --decoder-quant (default fp32) holds the fused
decoder_joint at a fixed precision for every swept encoder. onnx-asr exposes a
single `quantization` that selects both files, so when the decoder quant differs
from the encoder quant we load the model normally for the encoder and then swap
its decoder_joint InferenceSession for one built from the decoder-quant file
(resolving only that one path via onnx-asr's own resolver, so no second encoder
is loaded and the RAM figure stays honest). The decoder is small (~70 MB fp32 vs
~18 MB int8), so fp32 there is cheap and avoids the int8 joiner's quality loss.
This model exports the decoder and joint network as one fused file, so this knob
covers both. The per-section oracle reference stays fully matched at
--reference-quant (no decoder swap), so it remains a clean reference.

--audio accepts a single file OR a FOLDER. A folder is expanded to every audio
file inside it and each is analysed in turn (its own two tables), then a final
cross-file overall-WER summary is printed. Point it at the model repo's
calibration_audio/ folder of long French/English speeches to get the long-pass
degradation numbers across a whole set in one run instead of one clip at a time.
A folder sweep uses the per-section oracle per file, so --reference (one overall
text) only applies to a single --audio file.

Usage (deps are declared inline via PEP 723, so uv installs them on first run):
  uv run scripts/wer-quants.py
  uv run scripts/wer-quants.py --section-sec 90
  uv run scripts/wer-quants.py --audio clip.mp3 --reference @ref.txt
  uv run scripts/wer-quants.py --audio fallback_models/.../calibration_audio   # sweep a folder
  uv run scripts/wer-quants.py --quants int8,fp16 --reference-quant fp32
  uv run scripts/wer-quants.py --quants int8,fp16,fp32 --decoder-quant fp32
  uv run scripts/wer-quants.py --cuda                 # run on the NVIDIA GPU

Or with an environment that already has the deps: python scripts/wer-quants.py
(needs onnx-asr, librosa, jiwer; for --cuda, onnxruntime-gpu instead of the CPU
onnxruntime, and CUDA 12 + cuDNN 9 reachable by the dynamic linker).

Built with Claude Code.
"""

import argparse
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# quant label -> onnx-asr `quantization` argument (None == fp32, the plain files)
QUANT_ARG = {"int8": "int8", "fp16": "fp16", "fp32": None}

DEFAULT_AUDIO = ROOT / "test/e2e/.cache/jfk-moon/full.mp3"

# Audio extensions recognised when --audio points at a FOLDER (e.g. the model
# repo's calibration_audio/ of long speeches), so the bench can sweep a whole set
# of clips in one run instead of one --audio at a time.
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"}

# The encoder's exported positional-encoding table caps at 5000 frames @ 12.5
# frames/s = 400.0 s; a single pass past that aborts in the first attention
# layer. Default the cap just under it. (Empirically: 400 s OK, 410 s fails.)
DEFAULT_MAX_PASS_SEC = 390.0

# onnxruntime CUDA EP providers (CUDA first; CPU after it ONLY for ops the CUDA
# EP doesn't implement, it does NOT rescue a failed CUDA-library load).
CUDA_PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
CPU_PROVIDERS = ["CPUExecutionProvider"]


# --- GPU (--cuda) runtime bootstrap -----------------------------------------

def cuda_lib_dirs():
    """Discover local NVIDIA CUDA-12 / cuDNN-9 shared-library dirs to put on the
    re-exec's LD_LIBRARY_PATH. onnxruntime-gpu 1.26 needs CUDA 12 + cuDNN 9; on a
    box whose default toolkit is a different CUDA major (e.g. CUDA 13) the libs
    typically live in the pip `nvidia-*-cu12` wheels or a side-by-side cuda-12.x
    toolkit, neither on the default loader path. Glob the usual spots and keep the
    dirs that exist (deduped, order-preserving). Empty is fine: the linker then
    falls back to the system path and onnxruntime reports the real load error."""
    import glob
    patterns = [
        "/usr/local/lib/python*/dist-packages/nvidia/*/lib",
        "/usr/lib/python*/dist-packages/nvidia/*/lib",
        os.path.expanduser("~/.local/lib/python*/site-packages/nvidia/*/lib"),
        os.path.join(sys.prefix, "lib", "python*", "site-packages", "nvidia", "*", "lib"),
        "/usr/local/cuda-12*/targets/*/lib",
    ]
    seen, out = set(), []
    for pat in patterns:
        for d in sorted(glob.glob(pat)):
            if os.path.isdir(d) and d not in seen:
                seen.add(d)
                out.append(d)
    return out


def preload_cuda_dlls():
    """Best-effort: ask onnxruntime to preload the CUDA/cuDNN DLLs from installed
    nvidia-*-cu12 wheels (onnxruntime >= 1.21). Harmless if unavailable or already
    loaded; LD_LIBRARY_PATH (set by the re-exec) is the primary mechanism."""
    try:
        import onnxruntime as rt
        if hasattr(rt, "preload_dlls"):
            rt.preload_dlls()
    except Exception:
        pass


def ensure_cuda_runtime(argv, args):
    """For --cuda: guarantee an onnxruntime build with the CUDA EP is active.

    The inline PEP 723 deps pin onnx-asr[cpu] (CPU onnxruntime, no CUDA EP), so
    when the CUDA EP isn't present we RE-EXEC the whole command once through uv
    with the gpu extra and the local CUDA-12 libs on LD_LIBRARY_PATH. We invoke
    `python <script>` (not `uv run <script>`) so uv does NOT read this script's
    [cpu] inline block, which would otherwise drag the CPU onnxruntime wheel in
    alongside onnxruntime-gpu and clash. A --_rt-ready sentinel caps it at one
    re-exec; spawned children always carry it (they inherit the gpu env), so they
    skip straight through. No-op unless --cuda."""
    import onnxruntime as rt
    if "CUDAExecutionProvider" in rt.get_available_providers():
        return  # gpu runtime already active (re-exec'd, or user supplied it)
    if args.rt_ready:
        sys.exit("--cuda: onnxruntime-gpu loaded but CUDAExecutionProvider is still "
                 f"unavailable (have {rt.get_available_providers()}). Check nvidia-smi "
                 "and that CUDA 12 + cuDNN 9 are installed.")
    import shutil
    uv = shutil.which("uv")
    if not uv:
        sys.exit("--cuda needs onnxruntime-gpu but `uv` is not on PATH to install it. "
                 "Install uv, or run under an environment that already has onnxruntime-gpu.")
    env = os.environ.copy()
    libs = cuda_lib_dirs()
    if libs:
        prev = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = ":".join(libs + ([prev] if prev else []))
    cmd = [uv, "run", "--with", "onnx-asr[gpu]", "--with", "librosa", "--with", "jiwer",
           "python", str(Path(__file__).resolve()), *argv, "--_rt-ready"]
    print("[wer-quants] --cuda: re-launching under onnxruntime-gpu via uv "
          f"({len(libs)} CUDA lib dir(s) on LD_LIBRARY_PATH)...", file=sys.stderr, flush=True)
    os.execvpe(uv, cmd, env)


def collect_audio_files(audio_arg):
    """Resolve --audio to a list of audio files. A directory is expanded to every
    audio file (by extension) directly inside it, sorted by name, so you can point
    --audio at a folder of clips (e.g. the calibration speeches) and get one
    per-file analysis each plus a cross-file summary. A single file is returned
    as a one-element list. Exits with guidance when nothing usable is found."""
    p = Path(audio_arg)
    if p.is_dir():
        files = sorted(c for c in p.iterdir()
                       if c.is_file() and c.suffix.lower() in AUDIO_EXTS)
        if not files:
            sys.exit(f"--audio folder {p} has no audio files "
                     f"(looked for {', '.join(sorted(AUDIO_EXTS))}).")
        return files
    if not p.exists():
        sys.exit(f"audio not found: {audio_arg}\n"
                 "Generate the full moon-speech cache first:\n"
                 "  node scripts/gen-jfk-moon-fixtures.mjs\n"
                 "or pass --audio <file-or-folder>.")
    return [p]


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

def load_mixed(model_name, model_dir, encoder_quant, decoder_quant, use_cuda=False):
    """Load the onnx-asr model with `encoder_quant`, then (if it differs) swap in
    a decoder_joint session built from `decoder_quant`.

    onnx-asr's `quantization` argument selects BOTH the encoder and the decoder
    file, so to mix them we load normally for the encoder and replace only the
    decoder_joint InferenceSession. We resolve the decoder path through onnx-asr's
    OWN resolver (paths only, no sessions), so no second encoder is ever loaded
    and the peak-RSS figure keeps reflecting just `encoder_quant` + `decoder_quant`.

    `use_cuda` selects the providers: CUDA (+CPU for op coverage) vs CPU-only. The
    providers are stored on the model's runtime_config, so the decoder swap below
    inherits the same EP without any extra wiring.
    """
    import onnx_asr

    if use_cuda:
        preload_cuda_dlls()
    providers = CUDA_PROVIDERS if use_cuda else CPU_PROVIDERS
    model = onnx_asr.load_model(model_name, path=model_dir,
                                quantization=QUANT_ARG[encoder_quant], providers=providers)
    if decoder_quant != encoder_quant:
        import onnxruntime as rt
        from onnx_asr.loader import create_asr_resolver

        asr = model.asr  # underlying NemoConformerTdt (the adapter wraps it as .asr)
        if not hasattr(asr, "_decoder_joint"):
            raise RuntimeError(
                f"model {model_name!r} has no fused decoder_joint session to swap; "
                "--decoder-quant only applies to TDT/RNN-T transducer models.",
            )
        files = create_asr_resolver(model_name, model_dir).resolve_model(quantization=QUANT_ARG[decoder_quant])
        # Same session options onnx-asr used for the original decoder (providers etc.).
        asr._decoder_joint = rt.InferenceSession(str(files["decoder_joint"]), **asr.runtime_config)
    return model


def child_full(args):
    """Single full-pass transcription with token timestamps; emit JSON result."""
    wav, sr = load_audio(args.audio, args.max_pass_sec)
    baseline_mb = peak_rss_mb()  # interpreter + libs + decoded audio, before the model

    t0 = time.perf_counter()
    model = load_mixed(args.model, args.model_dir, args.quant, args.decoder_quant, args.cuda)
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
    wav, sr = load_audio(args.audio, args.max_pass_sec)
    audio_sec = len(wav) / sr
    # The oracle is the clean reference; it stays fully matched at its quant (the
    # parent passes decoder-quant == quant for the oracle spawn, so no swap here).
    model = load_mixed(args.model, args.model_dir, args.quant, args.decoder_quant, args.cuda)

    sections = []
    for start, end in windows(audio_sec, args.section_sec):
        clip = wav[int(start * sr):int(end * sr)]
        sections.append({"start": start, "end": end, "text": model.recognize(clip)})
    emit({"audio_sec": audio_sec, "section_sec": args.section_sec, "sections": sections})


def emit(obj):
    print("__RESULT__" + json.dumps(obj))


def spawn(args, audio, mode, quant, decoder_quant):
    """Run this script as a child on `audio` in the given mode/quant; parse its JSON.

    `audio` is the single file this child transcribes (the parent passes each file
    of a folder sweep in turn). `decoder_quant` is the decoder_joint quant for this
    child: the swept encoder quant pairs with --decoder-quant for the measured
    passes, while the oracle pass is given decoder_quant == quant so it stays a
    fully-matched reference.
    """
    cmd = [sys.executable, __file__, "--_child", mode, "--quant", quant, "--decoder-quant", decoder_quant,
           "--audio", str(audio), "--model", args.model, "--model-dir", args.model_dir,
           "--section-sec", str(args.section_sec), "--max-pass-sec", str(args.max_pass_sec)]
    if args.cuda:
        # Children run in the already-bootstrapped gpu env (sys.executable +
        # inherited LD_LIBRARY_PATH); --_rt-ready makes them skip the re-exec.
        cmd += ["--cuda", "--_rt-ready"]
    label = quant if decoder_quant == quant else f"{quant}+dec:{decoder_quant}"
    print(f"  [{mode}/{label}] running...", file=sys.stderr, flush=True)
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
        help="quant used to build the per-section oracle reference (default fp32; "
             "fully matched encoder+decoder, no swap).",
    )
    p.add_argument(
        "--decoder-quant", default="fp32", choices=list(QUANT_ARG),
        help="decoder_joint quant held fixed across the swept encoder --quants "
             "(default fp32). The fused decoder is small, so full precision is "
             "cheap and avoids the int8 joiner's quality loss. Only affects the "
             "measured passes; the oracle reference stays matched at --reference-quant.",
    )
    p.add_argument("--section-sec", type=float, default=60.0, help="section window length (s).")
    p.add_argument(
        "--max-pass-sec", type=float, default=DEFAULT_MAX_PASS_SEC,
        help=f"cap the single pass to this many seconds (default {DEFAULT_MAX_PASS_SEC:g}; "
             "the encoder aborts past ~400 s / 5000 frames).",
    )
    p.add_argument("--quants", default="int8,fp16,fp32")
    p.add_argument(
        "--cuda", action="store_true",
        help="run the encoder/decoder on an NVIDIA GPU (CUDA EP) instead of CPU. "
             "Re-launches once under onnxruntime-gpu via uv (needs uv + a working "
             "GPU/CUDA 12/cuDNN 9); fails loudly if the CUDA EP can't init. Default: CPU.",
    )
    p.add_argument("--model", default="nemo-parakeet-tdt-0.6b-v3")
    p.add_argument("--model-dir", default=str(ROOT / "fallback_models"))
    p.add_argument(
        "--log-file", default="wer-quants.log",
        help="fixed log file, APPENDED to across runs: stdout+stderr (both tables and "
             "progress) are mirrored into it, and each run is delimited by a RUN START "
             "banner with the command line and every resolved argument. Output still "
             "prints to the console. Default: ./wer-quants.log (parent process only; the "
             "per-pass --_child subprocesses do not write to it).",
    )
    # internal: child dispatch
    p.add_argument("--_child", dest="child", choices=["full", "oracle"], help=argparse.SUPPRESS)
    p.add_argument("--quant", help=argparse.SUPPRESS)
    # internal: set on the --cuda re-exec (and on spawned children) so the gpu
    # runtime bootstrap re-execs at most once.
    p.add_argument("--_rt-ready", dest="rt_ready", action="store_true", help=argparse.SUPPRESS)
    return p.parse_args(argv)


def analyze_one(args, audio_path, quants):
    """Run the full-pass + per-section analysis for ONE audio file: print the
    overall and per-section tables, and return {quant: overall_wer} (None for a
    failed quant) so a folder sweep can build a cross-file summary."""
    from jiwer import wer

    print(f"\naudio: {audio_path}")

    # Single full pass per quant first, in canonical int8 -> fp16 -> fp32 order so
    # the cheapest/fastest result lands first.
    results = {}
    for q in quants:
        try:
            results[q] = spawn(args, audio_path, "full", q, args.decoder_quant)
        except Exception as e:  # one bad quant should not kill the others
            results[q] = {"error": str(e)}

    # Then the per-section oracle reference: independent short-clip transcription
    # per window (order does not affect results; tables are built below). The
    # oracle stays fully matched at reference_quant (decoder == encoder, no swap).
    oracle = spawn(args, audio_path, "oracle", args.reference_quant, args.reference_quant)
    sections = oracle["sections"]
    audio_sec = oracle["audio_sec"]

    # ---- Table 1: overall WER + time + RAM ----
    if args.reference is not None:
        overall_ref = resolve_text(args.reference)
        ref_label = args.reference if not args.reference.startswith("@") else Path(args.reference[1:]).name
    else:
        overall_ref = " ".join(s["text"] for s in sections)
        ref_label = f"{args.reference_quant} oracle (independent {args.section_sec:g}s clips, concatenated)"

    print(f"reference (overall): {ref_label}")
    print(f"transcribed: {audio_sec:.1f}s ({audio_sec / 60:.1f} min) of the single pass "
          f"(capped at {args.max_pass_sec:g}s)\n")
    print("== Overall (full single pass) ==")
    print("quant   WER       load     infer     RTF     peak RAM   model RAM   words")
    print("-----   -------   ------   -------   -----   --------   ---------   -----")
    summary = {}
    for q in quants:
        r = results[q]
        if "error" in r:
            print(f"{q:<6}  FAILED: {r['error']}")
            summary[q] = None
            continue
        w = wer(overall_ref, r["text"])
        summary[q] = w
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
    # Track each quant's WORST (highest) per-section WER and the window it hit, so a
    # single catastrophic chunk is reported exactly even when the overall WER barely
    # moves (two quants can agree on every other chunk while one tanks just one).
    worst = {q: None for q in ok}  # q -> (wer, window-label)
    for i, sec in enumerate(sections):
        ref_i = sec["text"]
        label = f"{sec['start']:6.0f}-{sec['end']:<6.0f}s"
        ref_n = len(ref_i.split())
        cells = []
        for q in ok:
            r = results[q]
            hyp_i = slice_tokens(r["tokens"], r["timestamps"], sec["start"], sec["end"])
            w = None if not ref_i.strip() else wer(ref_i, hyp_i)
            if w is not None and (worst[q] is None or w > worst[q][0]):
                worst[q] = (w, label.strip())
            cells.append(fmt_pct(w))
        print(f"{label}      {ref_n:5d}     " + "  ".join(f"{c:>6}" for c in cells))
    # Worst-chunk row: the MAXIMUM per-section WER per quant (its single worst
    # window). Aligned under the data columns (data cells start at column 30).
    print("-" * len(header))
    worst_cells = [fmt_pct(worst[q][0] if worst[q] else None) for q in ok]
    print(f"{'worst chunk':<30}" + "  ".join(f"{c:>6}" for c in worst_cells))
    where = ", ".join(f"{q} @ {worst[q][1]}" for q in ok if worst[q]) or "n/a"
    print(f"worst chunk window: {where}")

    print("\nLower WER is better. Per-section WER measures the single long pass against an "
          "independent short-clip transcription of the same window; a trend of rising WER "
          "down the table is the long-pass degradation you suspected. The 'worst chunk' row "
          "is the maximum per-section WER for each quant, surfacing a single bad window the "
          "overall WER would otherwise average away. "
          "RAM is host memory, not VRAM (see the module docstring).")
    return {q: {"overall": summary[q], "worst": (worst[q][0] if worst.get(q) else None)}
            for q in quants}


def print_cross_file_summary(summaries, quants):
    """Cross-file tables after a folder sweep: one row per audio file, one column
    per encoder quant. Two tables (each with a mean row over the files each quant
    transcribed):
      1. overall WER  -- the headline 'does int8 degrade vs fp16/fp32 across many
         long speeches' answer at a glance.
      2. worst-chunk WER -- each file's single worst per-section window, so a
         one-chunk collapse the overall mean would otherwise hide still shows up.
    Each file's full per-section trend is in its own table above."""
    name_w = max(len("mean"), max(len(Path(p).name) for p, _ in summaries))

    def table(title, key):
        print(f"\n== Cross-file {title} (encoder quant) ==")
        header = f"{'file':<{name_w}}  " + "  ".join(f"{q:>7}" for q in quants)
        print(header)
        print("-" * len(header))
        for path, summary in summaries:
            cells = "  ".join(f"{fmt_pct(summary[q][key]):>7}" for q in quants)
            print(f"{Path(path).name:<{name_w}}  {cells}")
        print("-" * len(header))
        means = []
        for q in quants:
            vals = [summary[q][key] for _, summary in summaries if summary[q][key] is not None]
            means.append(sum(vals) / len(vals) if vals else None)
        print(f"{'mean':<{name_w}}  " + "  ".join(f"{fmt_pct(m):>7}" for m in means))

    table("overall WER", "overall")
    table("worst-chunk WER", "worst")
    print("\nLower WER is better. 'overall WER' is the whole single pass; 'worst-chunk WER' "
          "is each file's single worst per-section window (a one-chunk collapse the overall "
          "mean would otherwise hide). The mean is over the files each quant transcribed; a "
          "per-file per-section breakdown is in that file's table above.")


class _Tee:
    """Mirror a stream (stdout/stderr) into the run-log file so the whole run is
    captured without touching every print site. Anything else (encoding, isatty,
    fileno, colour handling) delegates to the real stream so the console keeps
    behaving normally."""

    def __init__(self, stream, logfh):
        self._stream = stream
        self._logfh = logfh

    def write(self, data):
        self._stream.write(data)
        self._logfh.write(data)
        return len(data)

    def flush(self):
        self._stream.flush()
        self._logfh.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)


def open_run_log(args, argv):
    """Open the fixed log in APPEND mode and tee stdout+stderr into it, then write a
    run-start banner: a separator, the timestamp, the exact command line and every
    resolved argument. Like quantize-int8-smoothquant.py's log, one fixed file
    accumulates every run, so the banner is what makes each run in the file
    self-describing (which clip / quants / section settings it used). Parent process
    only: the --_child passes return before main() reaches here, so a child never
    writes to the log. (The banner is a deliberate small duplicate of the quantize
    script's, which lives in a separate repo, so it cannot be a shared import.)"""
    import shlex
    from datetime import datetime

    logfh = open(args.log_file, "a", encoding="utf-8", buffering=1)
    sys.stdout = _Tee(sys.stdout, logfh)
    sys.stderr = _Tee(sys.stderr, logfh)
    bar = "=" * 78
    cmd = " ".join(shlex.quote(a) for a in (Path(sys.argv[0]).name, *argv))
    print(bar)
    print(f"=== RUN START {datetime.now():%Y-%m-%d %H:%M:%S} ===")
    print(f"command: {cmd}")
    print(f"log file (appended): {args.log_file}")
    print("arguments:")
    for key, value in sorted(vars(args).items()):
        if key in ("child", "quant", "rt_ready"):  # internal dispatch flags, not user args
            continue
        print(f"  {key} = {value!r}")
    print(bar, flush=True)


def main(argv):
    args = parse_args(argv)
    # For --cuda: make sure a CUDA-capable onnxruntime is active before anything
    # imports/loads a model (re-execs once via uv when needed; no-op otherwise).
    # Runs for children too, where it's a fast no-op (they carry --_rt-ready).
    if args.cuda:
        ensure_cuda_runtime(argv, args)
    if args.child == "full":
        return child_full(args)
    if args.child == "oracle":
        return child_oracle(args)

    open_run_log(args, argv)

    requested = [q.strip() for q in args.quants.split(",") if q.strip()]
    for q in requested:
        if q not in QUANT_ARG:
            sys.exit(f"unknown quant {q!r} (choose from {list(QUANT_ARG)})")
    # Always process in the canonical order int8 -> fp16 -> fp32, whatever the
    # order they were given in.
    quants = [q for q in QUANT_ARG if q in requested]

    audio_files = collect_audio_files(args.audio)
    # A single overall --reference text cannot be matched to many clips; the
    # per-section oracle is the right reference for a folder sweep.
    if args.reference is not None and len(audio_files) > 1:
        sys.exit("--reference is one overall reference text and cannot apply to a folder "
                 "of clips; pass a single --audio file, or drop --reference so each clip "
                 "uses its own per-section oracle.")

    print(f"single pass, NO chunking; backend = {'cuda (GPU)' if args.cuda else 'cpu'}; "
          f"encoder quants = {', '.join(quants)}; "
          f"decoder = {args.decoder_quant}; sections = {args.section_sec:g}s; "
          f"oracle = {args.reference_quant}; capped at {args.max_pass_sec:g}s "
          f"(encoder pos-encoding wall is ~400s / 5000 frames; a longer pass aborts)")
    if len(audio_files) > 1:
        print(f"sweeping {len(audio_files)} audio file(s):")
        for f in audio_files:
            print(f"  - {f}")
    print("\ntranscribing (each pass in its own process):", file=sys.stderr)

    summaries = []
    for audio_path in audio_files:
        summaries.append((audio_path, analyze_one(args, audio_path, quants)))

    if len(audio_files) > 1:
        print_cross_file_summary(summaries, quants)


if __name__ == "__main__":
    main(sys.argv[1:])
