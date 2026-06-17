#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "onnx-asr[cpu]",
#     "librosa",
#     "jiwer",
#     "tqdm",
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
the only way to bench them here; and because a quant that fails to load is now
FATAL (it crashes the whole bench instead of printing a FAILED row and exiting 0),
the default int8,fp16,fp32 sweep on a CPU-only box must be run with --cuda or
narrowed with --quants int8.

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
single `quantization` that selects BOTH files, so to mix them we override the
model's file map for just that one load to resolve the encoder at the swept quant
and the decoder_joint at --decoder-quant in a single pass (see load_mixed). Only
the files actually used are required: e.g. an int8 encoder with an fp32 decoder
needs encoder-model.int8.onnx + decoder_joint-model.onnx and does NOT require a
decoder_joint-model.int8.onnx to exist (previously the load crashed on that
missing file even though --decoder-quant fp32 never uses it). No second encoder is
ever loaded, so the RAM figure stays honest. The decoder is small (~70 MB fp32 vs
~18 MB int8), so fp32 there is cheap and avoids the int8 joiner's quality loss.
This model exports the decoder and joint network as one fused file, so this knob
covers both. The per-section oracle reference stays fully matched at
--reference-quant (encoder == decoder, no override), so it remains a clean reference.

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
  uv run scripts/wer-quants.py --manifest fr/validation.json --quants int8 --cuda
  uv run scripts/wer-quants.py --manifest fr/validation.json --manifest en/validation.json --cuda

FLEURS manifest mode (--manifest): instead of the long-pass/oracle analysis above,
score a whole FLEURS-style validation split (JSON-lines of {audio_filepath, text,
duration}, with the wavs in a sibling wavs_validation/) against its HUMAN labels as
one corpus WER per --quants. --manifest is REPEATABLE: pass it once per language and
every language is scored in a SINGLE model load (each labelled by its parent dir
name), with a tqdm progress bar per language on stderr. References/hypotheses are
normalised (case + punctuation folded, accents kept) so a cased/punctuated model
output is scored fairly against the lowercase labels (--no-normalize for raw WER).
This is the per-language ground-truth accuracy the oracle mode cannot give. A
machine-readable __WER_JSON__ line per language (tagged with --run-label) is printed
so a wrapper can sweep several MODELS and aggregate a model x language matrix (the
gitignored wer-fleurs-validation.sh driver does exactly this).

Or with an environment that already has the deps: python scripts/wer-quants.py
(needs onnx-asr, librosa, jiwer; for --cuda, onnxruntime-gpu instead of the CPU
onnxruntime, and CUDA 12 + cuDNN 9 reachable by the dynamic linker).

Built with Claude Code.
"""

import argparse
import json
import os
import re
import resource
import subprocess
import sys
import time
import unicodedata
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

# A --_child pass reports a model LOAD failure (as opposed to a later inference
# failure) by printing this sentinel + the json-encoded message, then exiting
# nonzero. The parent's spawn() turns that into a ModelLoadError, which is FATAL: a
# quant that cannot even load must crash the whole bench rather than become a
# silent FAILED table row while the run still exits 0. Inference failures stay soft.
LOAD_ERROR_SENTINEL = "__LOAD_ERROR__"


class ModelLoadError(RuntimeError):
    """Raised in the parent when a --_child pass reports its model failed to LOAD."""


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
           "--with", "tqdm",
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
    """Load the onnx-asr model with the encoder at `encoder_quant` and the fused
    decoder_joint at `decoder_quant`.

    onnx-asr's single `quantization` argument selects BOTH the encoder file AND the
    decoder_joint file, so a plain load_model(quantization=encoder_quant) REQUIRES
    the encoder-quant decoder file to exist on disk (e.g. decoder_joint-model.int8.onnx)
    even when --decoder-quant asks for fp32 and that int8 decoder is never used: it
    raises ModelFileNotFoundError before any session is built. (That was a real bug:
    --decoder-quant fp32 still crashed on a folder that only shipped an int8 encoder
    and an fp32 decoder.) To honour --decoder-quant we override the model class's
    file map for JUST this one load so it resolves the encoder at encoder_quant and
    the decoder_joint at decoder_quant in a single pass: only the files we actually
    use are required, the decoder session is built straight from the decoder-quant
    file, and no second encoder is ever loaded (so the peak-RSS figure stays honest).
    The override is restored in a finally, so it cannot leak into a later load.

    `use_cuda` selects the providers: CUDA (+CPU for op coverage) vs CPU-only.
    """
    import onnx_asr

    if use_cuda:
        preload_cuda_dlls()
    providers = CUDA_PROVIDERS if use_cuda else CPU_PROVIDERS

    if decoder_quant == encoder_quant:
        return onnx_asr.load_model(model_name, path=model_dir,
                                   quantization=QUANT_ARG[encoder_quant], providers=providers)

    from onnx_asr.loader import create_asr_resolver

    model_type = create_asr_resolver(model_name, model_dir).model_type
    # _get_model_files(quant) maps {"encoder": ..., "decoder_joint": ..., "vocab": ...}.
    # A model with no fused decoder_joint (e.g. a CTC model) cannot take this knob.
    if "decoder_joint" not in model_type._get_model_files(QUANT_ARG[encoder_quant]):
        raise RuntimeError(
            f"model {model_name!r} has no fused decoder_joint file to set independently; "
            "--decoder-quant only applies to TDT/RNN-T transducer models.",
        )
    original = model_type._get_model_files               # staticmethod -> plain function
    had_own = "_get_model_files" in model_type.__dict__  # defined here vs inherited from a base

    def mixed_model_files(quantization=None):
        files = dict(original(QUANT_ARG[encoder_quant]))
        files["decoder_joint"] = original(QUANT_ARG[decoder_quant])["decoder_joint"]
        return files

    model_type._get_model_files = staticmethod(mixed_model_files)
    try:
        return onnx_asr.load_model(model_name, path=model_dir,
                                   quantization=QUANT_ARG[encoder_quant], providers=providers)
    finally:
        if had_own:
            model_type._get_model_files = staticmethod(original)
        else:
            del model_type._get_model_files


def load_or_die(args):
    """load_mixed wrapper for the --_child passes: on a LOAD failure, emit the
    load-error sentinel and exit nonzero so the parent's spawn() raises
    ModelLoadError and the whole bench crashes (by request) instead of recording a
    silent FAILED row. This is what makes an unloadable quant (e.g. fp16/fp32 on the
    CPU EP, or a missing weight file) fatal rather than quietly skippable."""
    try:
        return load_mixed(args.model, args.model_dir, args.quant, args.decoder_quant, args.cuda)
    except Exception as e:
        print(LOAD_ERROR_SENTINEL + json.dumps(str(e)))
        sys.exit(3)


def child_full(args):
    """Single full-pass transcription with token timestamps; emit JSON result."""
    wav, sr = load_audio(args.audio, args.max_pass_sec)
    baseline_mb = peak_rss_mb()  # interpreter + libs + decoded audio, before the model

    t0 = time.perf_counter()
    model = load_or_die(args)
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
    # parent passes decoder-quant == quant for the oracle spawn, so no override here).
    model = load_or_die(args)

    sections = []
    for start, end in windows(audio_sec, args.section_sec):
        clip = wav[int(start * sr):int(end * sr)]
        sections.append({"start": start, "end": end, "text": model.recognize(clip)})
    emit({"audio_sec": audio_sec, "section_sec": args.section_sec, "sections": sections})


def manifest_label_for(mf, args):
    """Label a manifest: the explicit --manifest-label (only meaningful for a single
    manifest), else the manifest's parent directory name (the FLEURS lang code)."""
    if args.manifest_label and len(args.manifest) == 1:
        return args.manifest_label
    return Path(mf).resolve().parent.name


def child_manifest(args):
    """Transcribe every clip of EVERY --manifest with the model loaded ONCE, and
    emit the per-clip references + hypotheses (per manifest) for the parent to score.
    Loading once and looping all manifests is the whole point: a multi-language sweep
    pays a single model load, not one per language. Each clip is an independent single
    pass (FLEURS validation clips are short, far under the encoder's ~400 s
    positional-encoding wall). A tqdm bar per language reports progress on STDERR (the
    JSON result goes to STDOUT), so the parent can stream it live to the terminal."""
    try:
        from tqdm import tqdm  # optional: progress only, never required to score
    except Exception:
        tqdm = None

    # One audio dir override only makes sense for a single manifest; for many, each
    # manifest uses its own sibling wavs_validation/ (load_manifest's default).
    audio_dir = args.manifest_audio_dir if len(args.manifest) == 1 else None

    baseline_mb = peak_rss_mb()  # interpreter + libs, before the model
    t0 = time.perf_counter()
    model = load_or_die(args)
    t1 = time.perf_counter()

    manifests = []
    for n, mf in enumerate(args.manifest, 1):
        label = manifest_label_for(mf, args)
        items, missing = load_manifest(mf, audio_dir, args.limit)
        iterator = items
        if tqdm is not None:
            iterator = tqdm(items, desc=f"  {label} ({n}/{len(args.manifest)})",
                            unit="clip", leave=False, file=sys.stderr, dynamic_ncols=True)
        out = []
        for it in iterator:
            wav, _ = load_audio(it["audio_path"], args.max_pass_sec)
            out.append({"id": it["id"], "ref": it["text"],
                        "hyp": model.recognize(wav), "duration": it["duration"]})
        manifests.append({"label": label, "items": out, "missing": missing})
    t2 = time.perf_counter()

    emit({
        "manifests": manifests,
        "load_s": t1 - t0,
        "infer_s": t2 - t1,
        "peak_mb": peak_rss_mb(),
        "baseline_mb": baseline_mb,
    })


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
    return _parse_child_output(subprocess.run(cmd, capture_output=True, text=True))


def _parse_child_output(out):
    """Extract the __RESULT__ JSON from a finished child process, turning a
    __LOAD_ERROR__ line into a fatal ModelLoadError and a missing result into a
    RuntimeError carrying whatever output we have. Shared by spawn (full/oracle) and
    spawn_manifest so the result/error protocol lives in one place. out.stderr may be
    None when the caller let the child's stderr stream to the terminal (manifest mode,
    for live progress bars), so the error tail falls back to stdout."""
    for line in out.stdout.splitlines():
        if line.startswith(LOAD_ERROR_SENTINEL):  # the model failed to LOAD -> fatal
            raise ModelLoadError(json.loads(line[len(LOAD_ERROR_SENTINEL):]))
        if line.startswith("__RESULT__"):
            return json.loads(line[len("__RESULT__"):])
    raise RuntimeError(((out.stderr or out.stdout) or "").strip()[-500:] or "no result from child")


def spawn_manifest(args, quant):
    """Run this script as a --_child manifest pass: transcribe every clip of every
    --manifest with the model (encoder=quant, decoder=--decoder-quant) loaded ONCE,
    and return the per-manifest {label, items, missing} list. Mirrors spawn's
    process-isolation + result protocol. Unlike spawn it does NOT capture the child's
    stderr: it lets it inherit the terminal so the per-language tqdm progress bars
    stream live (the __RESULT__/__LOAD_ERROR__ protocol rides stdout, which we do
    capture). The child still reports a load failure on stdout, so it stays fatal."""
    cmd = [sys.executable, __file__, "--_child", "manifest", "--quant", quant,
           "--decoder-quant", args.decoder_quant,
           "--model", args.model, "--model-dir", args.model_dir,
           "--max-pass-sec", str(args.max_pass_sec)]
    for mf in args.manifest:
        cmd += ["--manifest", mf]
    if args.manifest_label and len(args.manifest) == 1:
        cmd += ["--manifest-label", args.manifest_label]
    if args.manifest_audio_dir and len(args.manifest) == 1:
        cmd += ["--manifest-audio-dir", args.manifest_audio_dir]
    if args.limit:
        cmd += ["--limit", str(args.limit)]
    if args.cuda:  # children run in the bootstrapped gpu env; skip the re-exec
        cmd += ["--cuda", "--_rt-ready"]
    print(f"  [manifest/{quant}] loading model once for {len(args.manifest)} language(s)...",
          file=sys.stderr, flush=True)
    # stderr=None -> inherit the terminal so tqdm shows live; stdout=PIPE for the result.
    return _parse_child_output(
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=None, text=True))


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


# --- FLEURS manifest (per-language ground-truth WER) helpers -----------------
# These three are pure (no model, no onnxruntime) so they are unit-testable on
# their own; child_manifest below feeds their references/hypotheses from a single
# model load. Used by the --manifest mode that scores a whole FLEURS validation
# split per language against the human labels (vs the oracle mode above, which
# scores the long single pass against the model's own short-clip transcription).

# Keep letters/digits/underscore + whitespace; drop everything else (punctuation).
_PUNCT_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)


def normalize_for_wer(text, enabled=True):
    """Normalise a transcript for ground-truth WER: NFC, lowercase, strip
    punctuation, collapse whitespace. Diacritics are KEPT (they are meaningful in
    the FLEURS languages); only case and punctuation are folded, applied identically
    to reference and hypothesis, so a cased/punctuated model output is scored fairly
    against the lowercase, unpunctuated FLEURS labels. enabled=False only trims and
    collapses whitespace (raw WER), folding nothing."""
    text = unicodedata.normalize("NFC", text)
    if not enabled:
        return " ".join(text.split())
    text = _PUNCT_RE.sub(" ", text.lower())
    return " ".join(text.split())


def load_manifest(manifest_path, audio_dir=None, limit=None):
    """Parse a FLEURS-style validation manifest into resolvable clip entries.

    The manifest is JSON-lines, one object per clip: {audio_filepath, text,
    duration}. The wav is resolved as <audio_dir>/<basename(audio_filepath)>, where
    audio_dir defaults to the manifest's sibling wavs_validation/ folder (the FLEURS
    layout <lang>/validation.json + <lang>/wavs_validation/<id>.wav), so the
    in-manifest audio_filepath prefix is ignored and only its filename is used.
    Entries whose wav is missing on disk are skipped and counted. limit keeps only
    the first N resolvable entries. Returns (items, missing) where each item is
    {id, audio_path, text, duration}."""
    manifest_path = Path(manifest_path)
    audio_dir = Path(audio_dir) if audio_dir else manifest_path.parent / "wavs_validation"
    items, missing = [], 0
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        name = Path(entry["audio_filepath"]).name
        wav = audio_dir / name
        if not wav.exists():
            missing += 1
            continue
        items.append({
            "id": Path(name).stem,
            "audio_path": str(wav),
            "text": entry.get("text", ""),
            "duration": entry.get("duration"),
        })
        if limit and len(items) >= limit:
            break
    return items, missing


def corpus_wer(refs, hyps, normalize=True):
    """Aggregate (corpus) WER over parallel reference/hypothesis lists: total word
    edits / total reference words, computed by jiwer over the whole list (NOT a mean
    of per-clip WERs). Both sides are run through normalize_for_wer first. Pairs
    whose reference is empty AFTER normalisation are dropped (jiwer rejects empty
    references and they carry no scorable words). Returns (wer_or_None, scored_pairs,
    dropped); wer is None when nothing is scorable."""
    from jiwer import wer

    norm_refs, norm_hyps, dropped = [], [], 0
    for ref, hyp in zip(refs, hyps):
        ref_n = normalize_for_wer(ref, normalize)
        if not ref_n:
            dropped += 1
            continue
        norm_refs.append(ref_n)
        norm_hyps.append(normalize_for_wer(hyp, normalize))
    if not norm_refs:
        return None, 0, dropped
    return wer(norm_refs, norm_hyps), len(norm_refs), dropped


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
    # FLEURS manifest (per-language ground-truth WER) mode. When --manifest is
    # given the script scores a whole validation split against its human labels and
    # the audio/oracle/section machinery above is bypassed (no --audio, no oracle).
    p.add_argument(
        "--manifest", action="append", default=None,
        help="score a FLEURS-style validation manifest (JSON-lines of "
             "{audio_filepath, text, duration}) as one corpus WER per requested "
             "--quants, model loaded once. Bypasses --audio/--reference/oracle. "
             "Repeatable: pass --manifest once per language to score every language "
             "in a SINGLE model load (each labelled by its parent dir name).",
    )
    p.add_argument(
        "--run-label", default=None,
        help="tag every __WER_JSON__ line with this model label (used by the shell "
             "driver to build a model x language matrix across several models).",
    )
    p.add_argument(
        "--manifest-audio-dir", default=None,
        help="folder holding the manifest's wavs (default: the manifest's sibling "
             "wavs_validation/). Only the basename of each audio_filepath is used.",
    )
    p.add_argument(
        "--manifest-label", default=None,
        help="label for the manifest in the table and __WER_JSON__ line "
             "(default: the manifest's parent dir name, e.g. the language code).",
    )
    p.add_argument(
        "--limit", type=int, default=None,
        help="score only the first N resolvable clips of the manifest (smoke test).",
    )
    p.add_argument(
        "--no-normalize", dest="normalize", action="store_false",
        help="score raw (whitespace-only) WER instead of folding case + punctuation. "
             "Default: normalised (fair against the lowercase/unpunctuated FLEURS labels).",
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
    p.add_argument("--_child", dest="child", choices=["full", "oracle", "manifest"], help=argparse.SUPPRESS)
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
        except ModelLoadError:
            # A quant that fails to LOAD crashes the whole bench (by request): an
            # unloadable encoder must not be reported as a silent FAILED row while
            # the run still exits 0. Only a later inference failure stays soft below.
            raise
        except Exception as e:  # a non-load failure should not kill the other quants
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
    print("quant   WER       load     infer     proc_t/dur_t   peak RAM   model RAM   words")
    print("-----   -------   ------   -------   ------------   --------   ---------   -----")
    summary = {}
    for q in quants:
        r = results[q]
        if "error" in r:
            print(f"{q:<6}  FAILED: {r['error']}")
            summary[q] = None
            continue
        w = wer(overall_ref, r["text"])
        summary[q] = w
        proc_per_dur = r["infer_s"] / r["audio_sec"]
        model_mb = r["peak_mb"] - r["baseline_mb"]
        n = len(r["text"].split())
        print(
            f"{q:<6}  {100 * w:6.2f}%   {r['load_s']:5.1f}s   {r['infer_s']:6.1f}s   "
            f"{proc_per_dur:>12.3f}   {r['peak_mb']:6.0f} MB   {model_mb:6.0f} MB   {n:5d}"
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


def score_manifest_result(res, normalize):
    """Turn one spawn_manifest result (its per-manifest items) into a per-language
    map {lang: {wer, clips, scored, dropped, missing, ref_words}} via corpus_wer."""
    langs = {}
    for m in res["manifests"]:
        refs = [i["ref"] for i in m["items"]]
        hyps = [i["hyp"] for i in m["items"]]
        wer_val, scored, dropped = corpus_wer(refs, hyps, normalize)
        ref_words = sum(len(normalize_for_wer(r, normalize).split()) for r in refs)
        langs[m["label"]] = {
            "wer": wer_val, "clips": len(m["items"]), "scored": scored,
            "dropped": dropped, "missing": m["missing"], "ref_words": ref_words,
        }
    return langs


def analyze_manifest(args, quants):
    """FLEURS manifest mode: corpus WER of a whole validation split against the human
    labels, for EVERY --manifest (language), for each requested encoder quant, with
    the model loaded ONCE per quant (all languages share that single load). Prints a
    per-language table (rows = language, columns = quant) plus, for each language, a
    machine-readable __WER_JSON__ line tagged with --run-label, so a shell driver can
    sweep several MODELS and aggregate a model x language matrix. No oracle / no
    per-section table: reference = FLEURS label, hypothesis = single-pass transcript,
    scored as one corpus WER (total edits / total ref words)."""
    print(f"\n== FLEURS manifest WER"
          + (f" [{args.run_label}]" if args.run_label else "") + " ==")
    print(f"languages: {len(args.manifest)}   "
          f"normalisation: {'case+punctuation folded, accents kept' if args.normalize else 'raw (whitespace only)'}")

    # quant -> {lang -> rowdict}; lang order taken from the manifests as scored.
    scored = {}
    lang_order = []
    timing = {}
    for q in quants:
        try:
            res = spawn_manifest(args, q)
        except ModelLoadError:
            raise  # an unloadable encoder is fatal (see load_or_die), as in audio mode
        except Exception as e:  # an inference failure stays soft: report and move on
            print(f"{q:<6}  FAILED: {e}")
            scored[q] = None
            continue
        scored[q] = score_manifest_result(res, args.normalize)
        timing[q] = (res["load_s"], res["infer_s"])
        if not lang_order:
            lang_order = [m["label"] for m in res["manifests"]]

    # ---- per-language table (rows = language, one WER column per quant) ----
    name_w = max([len("language")] + [len(l) for l in lang_order])
    header = f"{'language':<{name_w}}  {'clips':>6}  {'words':>7}   " + "   ".join(f"{q:>7}" for q in quants)
    print()
    print(header)
    print("-" * len(header))
    for lang in lang_order:
        first = next((scored[q][lang] for q in quants if scored.get(q)), {})
        clips, words = first.get("clips", "?"), first.get("ref_words", "?")
        cells = "   ".join(
            f"{fmt_pct((scored[q] or {}).get(lang, {}).get('wer')):>7}" for q in quants)
        print(f"{lang:<{name_w}}  {clips:>6}  {words:>7}   {cells}")
    print("-" * len(header))
    # MICRO (corpus) average per quant: total edits / total ref words across languages.
    micro = []
    for q in quants:
        if not scored.get(q):
            micro.append(None); continue
        num = sum((r["wer"] or 0) * r["ref_words"] for r in scored[q].values() if r["wer"] is not None)
        den = sum(r["ref_words"] for r in scored[q].values() if r["wer"] is not None)
        micro.append(num / den if den else None)
    print(f"{'MICRO':<{name_w}}  {'':>6}  {'':>7}   " + "   ".join(f"{fmt_pct(m):>7}" for m in micro))
    for q in quants:
        if q in timing:
            print(f"  [{q}] model load {timing[q][0]:.1f}s, inference {timing[q][1]:.1f}s")

    # ---- machine-readable per-language lines for the shell driver ----
    for lang in lang_order:
        emit_obj = {
            "lang": lang,
            "normalize": bool(args.normalize),
            "quants": {q: ((scored[q] or {}).get(lang) if scored.get(q) else None) for q in quants},
        }
        if args.run_label:
            emit_obj["model"] = args.run_label
        print("__WER_JSON__" + json.dumps(emit_obj))
    print("\nLower WER is better. Corpus WER = total word edits / total reference words per language "
          "(not a mean of per-clip WERs); MICRO is the same aggregate across all languages.")


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
    if args.child == "manifest":
        return child_manifest(args)

    open_run_log(args, argv)

    requested = [q.strip() for q in args.quants.split(",") if q.strip()]
    for q in requested:
        if q not in QUANT_ARG:
            sys.exit(f"unknown quant {q!r} (choose from {list(QUANT_ARG)})")
    # Always process in the canonical order int8 -> fp16 -> fp32, whatever the
    # order they were given in.
    quants = [q for q in QUANT_ARG if q in requested]

    # FLEURS manifest mode: corpus WER of a whole validation split against its human
    # labels. Self-contained (no --audio, no oracle, no per-section table), so it
    # branches out before the audio machinery below.
    if args.manifest:
        print(f"FLEURS manifest mode; backend = {'cuda (GPU)' if args.cuda else 'cpu'}; "
              f"encoder quants = {', '.join(quants)}; decoder = {args.decoder_quant}; "
              f"normalise = {args.normalize}; languages = {len(args.manifest)}"
              + (f"; run-label = {args.run_label}" if args.run_label else "")
              + (f"; limit = {args.limit}" if args.limit else ""))
        print(f"\ntranscribing {len(args.manifest)} language(s) "
              "(model loaded once per quant, all languages share it):", file=sys.stderr)
        analyze_manifest(args, quants)
        return

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
