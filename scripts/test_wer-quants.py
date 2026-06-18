#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "jiwer",
# ]
# ///
"""Unit tests for the pure (model-free) helpers added to scripts/wer-quants.py for
the FLEURS --manifest mode: normalize_for_wer, load_manifest, corpus_wer.

These are the bug-prone bits of the per-language ground-truth WER feature
(normalisation, manifest parsing + wav-path resolution, corpus-WER aggregation);
the model-dependent transcription (child_manifest) is exercised by a real run, not
here. main() runs every T-test sequentially (no pytest harness, matching the model
repo's test_quantize-int8-smoothquant.py convention).

  uv run scripts/test_wer-quants.py

Built with Claude Code.
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

# wer-quants.py has a hyphen in its name, so import it by path. Its heavy deps
# (onnx_asr, librosa) are all function-local, so importing the module is cheap and
# pulls in nothing but stdlib + (lazily) jiwer when corpus_wer is called.
_SPEC = importlib.util.spec_from_file_location(
    "wer_quants", Path(__file__).resolve().parent / "wer-quants.py")
wq = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(wq)


def T1_normalize_folds_case_and_punct_keeps_accents():
    # Case + punctuation folded; diacritics kept; apostrophe becomes a split.
    assert wq.normalize_for_wer("L'utilisation du Système, métrique!") == \
        "l utilisation du système métrique"
    assert wq.normalize_for_wer("Café   ÉTÉ") == "café été"
    # Idempotent on already-normalised text.
    s = "il y a de nombreuses répercussions"
    assert wq.normalize_for_wer(s) == s


def T2_normalize_disabled_is_whitespace_only():
    # enabled=False keeps case + punctuation, only collapsing whitespace.
    assert wq.normalize_for_wer("Hello,   World.", enabled=False) == "Hello, World."
    assert wq.normalize_for_wer("  spaced   out  ", enabled=False) == "spaced out"


def T3_load_manifest_resolves_by_basename_and_counts_missing():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        wavs = root / "wavs_validation"
        wavs.mkdir()
        (wavs / "a.wav").write_bytes(b"")
        (wavs / "b.wav").write_bytes(b"")
        # c.wav is referenced but absent -> counted as missing, not returned.
        lines = [
            # audio_filepath prefix is deliberately bogus: only the basename is used.
            {"audio_filepath": "./somewhere/else/a.wav", "text": "alpha", "duration": 1.0},
            {"audio_filepath": "x/y/b.wav", "text": "beta", "duration": 2.0},
            {"audio_filepath": "z/c.wav", "text": "gamma", "duration": 3.0},
        ]
        manifest = root / "validation.json"
        manifest.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")

        items, missing = wq.load_manifest(manifest)
        assert missing == 1, missing
        assert [it["id"] for it in items] == ["a", "b"], items
        assert items[0]["audio_path"] == str(wavs / "a.wav")
        assert items[0]["text"] == "alpha"
        assert items[1]["duration"] == 2.0


def T4_load_manifest_limit_and_blank_lines():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        wavs = root / "wavs_validation"
        wavs.mkdir()
        for name in ("a", "b", "c"):
            (wavs / f"{name}.wav").write_bytes(b"")
        manifest = root / "validation.json"
        body = "\n".join([
            json.dumps({"audio_filepath": "a.wav", "text": "a"}),
            "",  # blank line must be skipped, not crash json.loads
            json.dumps({"audio_filepath": "b.wav", "text": "b"}),
            json.dumps({"audio_filepath": "c.wav", "text": "c"}),
        ]) + "\n"
        manifest.write_text(body, encoding="utf-8")

        items, missing = wq.load_manifest(manifest, limit=2)
        assert missing == 0
        assert [it["id"] for it in items] == ["a", "b"], items


def T5_load_manifest_explicit_audio_dir():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        alt = root / "elsewhere"
        alt.mkdir()
        (alt / "a.wav").write_bytes(b"")
        manifest = root / "validation.json"
        manifest.write_text(json.dumps({"audio_filepath": "a.wav", "text": "a"}) + "\n",
                            encoding="utf-8")
        # Without the override the sibling wavs_validation/ does not exist -> missing.
        items, missing = wq.load_manifest(manifest)
        assert items == [] and missing == 1
        # With the override the file resolves.
        items, missing = wq.load_manifest(manifest, audio_dir=alt)
        assert missing == 0 and items[0]["audio_path"] == str(alt / "a.wav")


def T6_corpus_wer_is_aggregate_not_mean_of_clips():
    # Clip 1: 1 substitution out of 2 ref words. Clip 2: perfect (0/3).
    # Per-clip WERs are 0.5 and 0.0 (mean 0.25); the CORPUS WER is the aggregate
    # 1 edit / 5 total ref words = 0.2. corpus_wer must return the aggregate.
    refs = ["the cat", "one two three"]
    hyps = ["the dog", "one two three"]
    w, scored, dropped = wq.corpus_wer(refs, hyps)
    assert scored == 2 and dropped == 0
    assert abs(w - 0.2) < 1e-9, w


def T7_corpus_wer_drops_empty_references():
    # A reference that is empty after normalisation (pure punctuation here) is
    # dropped (jiwer rejects empty references); the rest still score.
    refs = ["...", "hello world"]
    hyps = ["anything", "hello world"]
    w, scored, dropped = wq.corpus_wer(refs, hyps)
    assert dropped == 1 and scored == 1
    assert abs(w - 0.0) < 1e-9, w
    # All-empty references -> None, nothing scorable.
    w, scored, dropped = wq.corpus_wer(["!!!"], ["x"])
    assert w is None and scored == 0 and dropped == 1


def T8_corpus_wer_normalize_toggle_changes_score():
    # Only case/punctuation differ. Normalised: identical -> 0.0 WER.
    refs = ["Hello, world"]
    hyps = ["hello world"]
    w_norm, _, _ = wq.corpus_wer(refs, hyps, normalize=True)
    assert abs(w_norm - 0.0) < 1e-9, w_norm
    # Raw: "Hello," vs "hello" and "world" vs "world" -> 1 sub of 2 -> 0.5.
    w_raw, _, _ = wq.corpus_wer(refs, hyps, normalize=False)
    assert abs(w_raw - 0.5) < 1e-9, w_raw


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("T") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\nall {len(tests)} tests passed")


if __name__ == "__main__":
    main()
