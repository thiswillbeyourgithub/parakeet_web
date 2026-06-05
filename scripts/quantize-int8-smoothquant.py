#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "onnx",
#     "onnxruntime",
#     "onnx-neural-compressor",
#     "numpy",
#     "sympy",
#     "prettytable",
#     "psutil",
#     "scipy",
# ]
# ///
"""Export a *better* int8 Parakeet encoder using SmoothQuant static quantization.

Why this exists (see CLAUDE.md / ARCHITECTURE.md for the full story): the int8
encoder we currently ship (istupakov's) silently loses long-range information
past ~20 s within a single chunk, so the WASM backend is pinned to a 20 s chunk
window while fp16/fp32 happily run 60 s. Crucially the model architecture is NOT
the problem (fp16 holds flat at long windows); it is an int8 *numerics* problem:
a single per-tensor activation scale copes badly once a longer sequence widens
the activation distribution. That is exactly the regime SmoothQuant targets: it
migrates the per-channel activation outliers into the weights (a folded Mul),
then static-quantizes activations + per-channel weights. The bet is that a
SmoothQuant + per-channel int8 encoder degrades far less over a long chunk,
which would let WASM use the full 60 s window.

This produces ONLY the encoder int8 (`encoder-model.int8.smoothquant.onnx`). The
decoder is tiny and is not where the long-range loss lives, so we deliberately
reuse istupakov's existing `decoder_joint-model.int8.onnx`; that isolates the
comparison to the encoder change.

Calibration data, with ZERO digging required: SmoothQuant needs representative
*activations*, not labels, so any speech works. We auto-discover whatever audio
is already in the tree (the committed FLEURS fixture is always present) and slice
it into deliberately LONG windows (default 30 s) so the smoothing scales are
computed over the very long-range distribution we are trying to fix. The encoder
takes mel features, not raw audio, so each window is first run through the
committed `nemo128.onnx` preprocessor (raw waveform -> 128-bin mel features) and
those features are fed to the encoder, exactly as the real pipeline does.

After export, compare against fp16 with the existing per-section harness:

    # the NEW SmoothQuant int8 (served from the symlinked candidate dir):
    uv run scripts/wer-quants.py --model-dir fallback_models_sq --quants int8
    # the OLD istupakov int8 + the fp16 reference, for the baseline:
    uv run scripts/wer-quants.py --model-dir fallback_models   --quants int8,fp16

Both use the same fp32 oracle reference, so a per-section WER that rises less
steeply for the new int8 (closer to fp16) is the win we are after. This script
prints those two commands at the end and, unless --no-candidate is passed, builds
the `fallback_models_sq` symlink farm they need.

By default only MatMul ops are quantized (the conv subsampling front-end stays
fp32: it is quant-fragile and collapsed the encoder when quantized) and
activations are calibrated with the Percentile method (MinMax let a single
long-tail outlier crush the scale). A post-export fidelity check compares the new
encoder's output to the fp32 encoder by cosine similarity and warns loudly on a
likely collapse, instead of only checking output shape.

Usage:
  uv run scripts/quantize-int8-smoothquant.py                  # auto everything
  uv run scripts/quantize-int8-smoothquant.py --alpha 0.6      # more weight-side migration
  uv run scripts/quantize-int8-smoothquant.py --num-windows 32 --window-sec 30
  uv run scripts/quantize-int8-smoothquant.py --audio a.mp3 --audio b.wav
  uv run scripts/quantize-int8-smoothquant.py --op-types MatMul,Conv   # also quantize convs
  uv run scripts/quantize-int8-smoothquant.py --calibrate-method entropy
  uv run scripts/quantize-int8-smoothquant.py --quant-format qdq

Built with Claude Code.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnxruntime.quantization import CalibrationMethod, QuantFormat, QuantType
from onnx_neural_compressor import data_reader
from onnx_neural_compressor.quantization import config, quantize
from onnx_neural_compressor.algorithms.smoother import core as _sq_core

ROOT = Path(__file__).resolve().parent.parent


# --- FastConformer compatibility shim for onnx-neural-compressor's SmoothQuant -
# The library's smoother hard-assumes a 3D activation is (batch, seq, in_channel)
# with the in-channel LAST (there is a literal TODO admitting this in
# Calibrator._get_max_per_channel). That holds for BERT-style graphs but NOT for
# a few FastConformer MatMuls (the relative-position attention projections, where
# the weight is the first operand and the activation contracts over the sequence
# axis). For those, the per-channel activation max is taken over the wrong axis
# and no longer matches the weight's in-channel length, so _get_smooth_scale dies
# broadcasting e.g. (101,) against (2048,).
#
# These two wrappers make the smoother SKIP exactly those unresolvable nodes
# (return None -> stripped before any Mul is inserted) instead of crashing. All
# the well-behaved linears (FFN, standard projections, the bulk of the weights)
# are still smoothed; the skipped handful simply fall through to plain static
# int8. _insert_smooth_mul_op iterates scales.keys() and _adjust_weights guards
# with `if key not in scales`, so omitting a node is safe. NOTE: this monkeypatch
# reaches into library internals and may need revisiting on a neural-compressor
# upgrade; it is contained to this experimental export script.
_SKIPPED = {"count": 0}
_orig_get_smooth_scale = _sq_core.Smoother._get_smooth_scale
_orig_get_smooth_scales = _sq_core.Smoother._get_smooth_scales


def _safe_get_smooth_scale(self, weights, specific_alpha, tensor):
    weights_max = np.amax(np.abs(weights.reshape(weights.shape[0], -1)), axis=-1)
    if self.max_vals_per_channel[tensor].shape != weights_max.shape:
        _SKIPPED["count"] += 1
        return None  # layout the per-channel logic can't resolve: don't smooth it
    return _orig_get_smooth_scale(self, weights, specific_alpha, tensor)


def _safe_get_smooth_scales(self, alpha, target_list=[]):
    scales = _orig_get_smooth_scales(self, alpha, target_list)
    return {k: v for k, v in scales.items() if v is not None}


_sq_core.Smoother._get_smooth_scale = _safe_get_smooth_scale
_sq_core.Smoother._get_smooth_scales = _safe_get_smooth_scales

# Audio we can use for calibration with no user input. The first entry is the
# committed FLEURS fixture (always present); the others are picked up only if
# they happen to exist locally (the gitignored moon-speech cache is a long,
# single-speaker bonus that strengthens the long-range calibration).
DEFAULT_CALIB_AUDIO = [
    ROOT / "test/fixtures/fleurs/stitched.mp3",
    ROOT / "test/e2e/.cache/jfk-moon/full.mp3",
    ROOT / "venlaf.aac",
]

SAMPLE_RATE = 16000


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024


def find_ffmpeg(explicit=None):
    cand = explicit or os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not cand or not shutil.which(cand) and not os.path.exists(cand):
        sys.exit("ffmpeg not found (set $FFMPEG or pass --ffmpeg).")
    return cand


def decode_pcm(ffmpeg, path):
    """Decode any audio file to mono 16 kHz float32 PCM via ffmpeg."""
    cmd = [ffmpeg, "-v", "error", "-i", str(path),
           "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"]
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on {path}: {out.stderr.decode()[-300:]}")
    return np.frombuffer(out.stdout, dtype=np.float32)


def collect_windows(ffmpeg, audio_paths, window_sec, num_windows):
    """Slice every available clip into non-overlapping FULL-length windows, then
    evenly subsample down to num_windows so calibration stays quick but diverse.

    All windows are exactly `win` samples long on purpose: SmoothQuant's
    calibrator np.stacks the per-op activations across calibration samples, so a
    variable-length tail window (different T -> different activation shape) makes
    it raise 'all input arrays must have the same shape'. We therefore drop any
    partial tail rather than pad it."""
    win = int(window_sec * SAMPLE_RATE)
    windows = []
    for p in audio_paths:
        if not Path(p).exists():
            continue
        pcm = decode_pcm(ffmpeg, p)
        n = len(pcm)
        count = 0
        start = 0
        while start + win <= n:
            windows.append(pcm[start:start + win])
            start += win
            count += 1
        print(f"  [calib] {Path(p).name}: {n / SAMPLE_RATE:.0f}s -> {count} full window(s)")
    if not windows:
        sys.exit(f"No calibration audio yielded a full {window_sec:g}s window. "
                 "Pass --audio <file> or lower --window-sec.")
    if len(windows) > num_windows:
        # Even stride across the whole pool for speaker/content diversity.
        idx = np.linspace(0, len(windows) - 1, num_windows).round().astype(int)
        windows = [windows[i] for i in dict.fromkeys(idx)]
    return windows


def build_features(pre_path, windows):
    """Run each raw-audio window through nemo128.onnx -> encoder mel features.

    Precomputed once into memory so the calibration reader can rewind cheaply
    (SmoothQuant + the static min/max + calibration passes each re-read it)."""
    sess = ort.InferenceSession(str(pre_path), providers=["CPUExecutionProvider"])
    feats = []
    for w in windows:
        wav = w.astype(np.float32)[None, :]
        lens = np.array([wav.shape[1]], dtype=np.int64)
        features, features_lens = sess.run(None, {"waveforms": wav, "waveforms_lens": lens})
        feats.append({
            "audio_signal": features.astype(np.float32),
            "length": features_lens.astype(np.int64),
        })
    return feats


class FeatureReader(data_reader.CalibrationDataReader):
    """Feeds the encoder its real (audio_signal, length) inputs for calibration."""

    def __init__(self, feats):
        self.feats = feats
        self.i = 0

    def get_next(self):
        if self.i >= len(self.feats):
            return None
        item = self.feats[self.i]
        self.i += 1
        return item

    def rewind(self):
        self.i = 0


def build_candidate_dir(model_dir, new_encoder, candidate_dir):
    """Symlink-farm a model dir where encoder-model.int8.onnx IS the new encoder,
    so wer-quants.py (which loads int8 by that canonical name via onnx-asr) serves
    the SmoothQuant encoder while reusing every other unchanged file."""
    model_dir = Path(model_dir).resolve()
    candidate_dir = Path(candidate_dir).resolve()
    candidate_dir.mkdir(parents=True, exist_ok=True)
    for f in model_dir.iterdir():
        if f.is_dir():
            continue
        link = candidate_dir / f.name
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(f.resolve())
    # Override the int8 encoder to point at the freshly exported SmoothQuant file.
    enc_link = candidate_dir / "encoder-model.int8.onnx"
    if enc_link.is_symlink() or enc_link.exists():
        enc_link.unlink()
    enc_link.symlink_to(Path(new_encoder).resolve())
    return candidate_dir


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-dir", default=str(ROOT / "fallback_models"),
                    help="dir holding encoder-model.onnx (+.data) and nemo128.onnx")
    ap.add_argument("--out-name", default="encoder-model.int8.smoothquant.onnx",
                    help="output filename (written into --model-dir)")
    ap.add_argument("--candidate-dir", default=str(ROOT / "fallback_models_sq"),
                    help="symlink-farm dir wer-quants.py points at for the new int8")
    ap.add_argument("--no-candidate", action="store_true",
                    help="skip building the wer-quants candidate symlink dir")
    ap.add_argument("--alpha", type=float, default=0.5,
                    help="SmoothQuant alpha (0..1): higher migrates more difficulty "
                         "to the weights, better for big activation outliers")
    ap.add_argument("--num-windows", type=int, default=24,
                    help="max calibration windows (evenly sampled across all audio)")
    ap.add_argument("--window-sec", type=float, default=30.0,
                    help="calibration window length; long on purpose (the bug is long-range)")
    ap.add_argument("--audio", action="append", default=None,
                    help="calibration audio file(s); repeatable. Default: auto-discover.")
    ap.add_argument("--quant-format", choices=["qoperator", "qdq"], default="qoperator",
                    help="QOperator (QLinear* ops, matches the shipped int8) or QDQ")
    ap.add_argument("--op-types", default="MatMul",
                    help="comma-separated op types to quantize. Default MatMul ONLY: the "
                         "conv subsampling front-end is quant-fragile and is the prime suspect "
                         "for a collapsed encoder, so convs stay fp32. Pass 'MatMul,Conv' to "
                         "also quantize convs (matches istupakov's scope).")
    ap.add_argument("--calibrate-method", choices=["minmax", "entropy", "percentile"],
                    default="percentile",
                    help="static activation calibration. MinMax (the library default) lets a "
                         "single long-tail outlier crush the scale and can collapse the encoder; "
                         "percentile/entropy clip the tail and are far more robust here.")
    ap.add_argument("--fidelity-warn", type=float, default=0.90,
                    help="cosine-similarity floor (vs the fp32 encoder, one window) below which "
                         "the export is flagged as a likely collapse before any WER run. This is "
                         "a COLLAPSE detector, not a quality score: a healthy MatMul-only export "
                         "measured ~0.96 cosine yet tracked fp16 WER (10.9%% vs 10.2%%), so the "
                         "floor sits well below that. A true collapse lands far lower.")
    ap.add_argument("--ffmpeg", default=None, help="ffmpeg binary (else $FFMPEG / PATH)")
    args = ap.parse_args()

    model_dir = Path(args.model_dir)
    in_encoder = model_dir / "encoder-model.onnx"
    pre_path = model_dir / "nemo128.onnx"
    out_encoder = model_dir / args.out_name
    for p in (in_encoder, pre_path):
        if not p.exists():
            sys.exit(f"missing required file: {p}")

    ffmpeg = find_ffmpeg(args.ffmpeg)
    audio = [Path(a) for a in args.audio] if args.audio else DEFAULT_CALIB_AUDIO

    print(f"[sq] calibration: up to {args.num_windows} x {args.window_sec:g}s windows")
    windows = collect_windows(ffmpeg, audio, args.window_sec, args.num_windows)
    print(f"[sq] using {len(windows)} calibration window(s); extracting mel features...")
    feats = build_features(pre_path, windows)

    fmt = QuantFormat.QOperator if args.quant_format == "qoperator" else QuantFormat.QDQ
    calib = {"minmax": CalibrationMethod.MinMax,
             "entropy": CalibrationMethod.Entropy,
             "percentile": CalibrationMethod.Percentile}[args.calibrate_method]
    op_types = [t.strip() for t in args.op_types.split(",") if t.strip()]
    cfg = config.StaticQuantConfig(
        calibration_data_reader=FeatureReader(feats),
        quant_format=fmt,
        calibrate_method=calib,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        # Which weight-bearing ops to quantize. Default is MatMul ONLY: the conv
        # subsampling front-end (pre_encode.*) sees the raw mel features with a
        # wide dynamic range and is notoriously quant-fragile; statically
        # quantizing it can produce garbage that propagates and empties the
        # transcript, so we leave all convs fp32 (the user is fine trading the
        # extra size for safety). MatMul-only also dodges the static quantizer's
        # Pad handler, which trips on FastConformer's optional/empty Pad inputs
        # ("Quantization parameters are not specified for param .").
        op_types_to_quantize=op_types,
        per_channel=True,        # the other half of the fix: per-channel weights
        reduce_range=True,       # recommended on non-VNNI CPUs (the WASM target)
        use_external_data_format=False,  # int8 encoder ~600 MB, fits a single file
        calibration_sampling_size=len(feats),
        execution_provider="CPUExecutionProvider",
        extra_options={
            "SmoothQuant": True,
            "SmoothQuantAlpha": args.alpha,
            "SmoothQuantFolding": True,
        },
    )

    print(f"[sq] SmoothQuant(alpha={args.alpha}) static int8, per-channel, "
          f"calib={args.calibrate_method}, ops={op_types}, format={args.quant_format} ...")
    print(f"[sq]   {human(os.path.getsize(in_encoder) + os.path.getsize(str(in_encoder) + '.data'))} fp32 encoder")
    t0 = time.time()
    # ORT_DISABLE_ALL skips neural-compressor's pre-optimization InferenceSession
    # (which has a `provides=` kwarg typo that crashes on this version) and avoids
    # re-serializing the 2.4 GB fp32 graph.
    quantize(str(in_encoder), str(out_encoder), cfg,
             optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL)
    dt = time.time() - t0
    if _SKIPPED["count"]:
        print(f"[sq] note: {_SKIPPED['count']} node(s) had a layout SmoothQuant could not "
              f"resolve and were left as plain static int8 (everything else was smoothed)")

    # neural-compressor always writes the quantized weights to an external
    # `<name>_data` sidecar for a model this size, ignoring use_external_data_format.
    # The int8 weights are ~620 MB, well under the 2 GB single-protobuf cap, so
    # fold them back into ONE self-contained .onnx (matching the shipped
    # single-file int8 and keeping the candidate symlink dir trivial).
    sidecar = str(out_encoder) + "_data"
    if os.path.exists(sidecar):
        merged = onnx.load(str(out_encoder), load_external_data=True)
        onnx.save(merged, str(out_encoder), save_as_external_data=False)
        os.remove(sidecar)

    out_size = os.path.getsize(out_encoder)
    baseline = model_dir / "encoder-model.int8.onnx"
    base_note = f" (istupakov int8 is {human(os.path.getsize(baseline))})" if baseline.exists() else ""
    print(f"[sq] done in {dt:.0f}s -> {out_encoder.name} {human(out_size)}{base_note}")

    # Fidelity smoke test (NOT just shape): run one calibration window through both
    # the fp32 reference and the new int8 encoder and compare the encoder outputs by
    # cosine similarity. A shape-only check let a fully collapsed encoder (empty
    # transcript everywhere) pass silently once; this catches that in ~30 s instead
    # of after a multi-minute WER run. A healthy int8 sits well above ~0.99.
    try:
        inp = {"audio_signal": feats[0]["audio_signal"], "length": feats[0]["length"]}
        s_q = ort.InferenceSession(str(out_encoder), providers=["CPUExecutionProvider"])
        out_q = s_q.run(None, inp)[0].astype(np.float64).ravel()
        s_f = ort.InferenceSession(str(in_encoder), providers=["CPUExecutionProvider"])
        out_f = s_f.run(None, inp)[0].astype(np.float64).ravel()
        denom = (np.linalg.norm(out_q) * np.linalg.norm(out_f)) or 1.0
        cos = float(np.dot(out_q, out_f) / denom)
        if cos < args.fidelity_warn:
            print(f"[sq] WARNING: encoder-output cosine vs fp32 is {cos:.4f} "
                  f"(< {args.fidelity_warn}). This export likely COLLAPSED; expect a near-100% "
                  f"WER. Try a different --calibrate-method/--alpha or keep more ops fp32.",
                  file=sys.stderr)
        else:
            print(f"[sq] fidelity: encoder-output cosine vs fp32 = {cos:.4f} (>= "
                  f"{args.fidelity_warn}). Looks healthy.")
    except Exception as e:
        print(f"[sq] WARNING: exported encoder failed the fidelity smoke test: {e}", file=sys.stderr)

    if not args.no_candidate:
        cand = build_candidate_dir(model_dir, out_encoder, args.candidate_dir)
        print(f"[sq] candidate model dir (for wer-quants): {cand}")

    rel_cand = os.path.relpath(args.candidate_dir, ROOT)
    rel_model = os.path.relpath(model_dir, ROOT)
    print("\nCompare per-section degradation vs fp16:")
    print(f"  uv run scripts/wer-quants.py --model-dir {rel_cand} --quants int8")
    print(f"  uv run scripts/wer-quants.py --model-dir {rel_model} --quants int8,fp16")
    print("A new-int8 per-section WER that tracks fp16 (instead of climbing) is the win.")


if __name__ == "__main__":
    main()
