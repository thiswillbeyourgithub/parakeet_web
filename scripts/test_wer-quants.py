#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "jiwer",
# ]
# ///
"""Unit tests for the pure (model-free) helpers in scripts/wer-quants.py: the
FLEURS --manifest mode (normalize_for_wer, load_manifest, corpus_wer) and the
model-dir layout resolution (layout_dir_for, candidate_paths, relocate_model_file).

These are the bug-prone bits of the per-language ground-truth WER feature
(normalisation, manifest parsing + wav-path resolution, corpus-WER aggregation,
per-language scoring, and the streaming dispatch that emits each language's result AS
PRODUCED) plus the layout rules that decide WHICH file each quant loads; the
model-dependent transcription (child_manifest) is exercised by a real run, not
here. main() runs every T-test sequentially (no pytest harness, matching the
model repo's test_quantize-int8-smoothquant.py convention).

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


def T9_score_one_manifest_rowdict():
    # One streamed manifest (one language) -> its corpus-WER rowdict. Clip 1 has 1
    # substitution of 2 ref words, clip 2 is perfect (0/3): corpus WER = 1/5 = 0.2,
    # ref_words = 5, and missing rides through from the manifest.
    m = {
        "label": "fr",
        "items": [
            {"ref": "the cat", "hyp": "the dog"},
            {"ref": "one two three", "hyp": "one two three"},
        ],
        "missing": 2,
    }
    row = wq.score_one_manifest(m, normalize=True)
    assert row["clips"] == 2 and row["scored"] == 2 and row["dropped"] == 0
    assert row["missing"] == 2
    assert row["ref_words"] == 5, row
    assert abs(row["wer"] - 0.2) < 1e-9, row


def T10_consume_stream_dispatches_each_manifest_then_returns_summary():
    # The streaming dispatch must call on_manifest for every __MANIFEST__ line and
    # return the final __RESULT__ summary; an __WER_JSON__-style mid-stream line (the
    # parent's own echo) and blanks must be ignored, not crash.
    seen = []
    lines = [
        wq.MANIFEST_SENTINEL + json.dumps({"label": "fr", "items": [], "missing": 0}),
        wq.MANIFEST_SENTINEL + json.dumps({"label": "en", "items": [], "missing": 1}),
        "__RESULT__" + json.dumps({"load_s": 1.0, "infer_s": 2.0}),
    ]
    summary = wq._consume_manifest_stream(lines, lambda m: seen.append((m["label"], m["missing"])))
    assert seen == [("fr", 0), ("en", 1)], seen
    assert summary == {"load_s": 1.0, "infer_s": 2.0}, summary


def T11_consume_stream_load_error_is_fatal():
    # A __LOAD_ERROR__ line must raise ModelLoadError (the parent treats an unloadable
    # encoder as fatal), carrying the child's message.
    lines = [wq.LOAD_ERROR_SENTINEL + json.dumps("encoder-model.fp16.onnx: no such file")]
    raised = False
    try:
        wq._consume_manifest_stream(lines, lambda m: (_ for _ in ()).throw(AssertionError("on_manifest must not run")))
    except wq.ModelLoadError as e:
        raised = True
        assert "fp16" in str(e.args[0]), e.args
    assert raised, "expected ModelLoadError"


def T12_consume_stream_is_incremental_not_buffered():
    # The whole point of the feature: a manifest is dispatched the MOMENT its line is
    # read, before later lines exist. Drive it from a generator that records when it is
    # advanced; the fr callback must fire BEFORE the generator produces the next line.
    order = []

    def gen():
        yield wq.MANIFEST_SENTINEL + json.dumps({"label": "fr", "items": [], "missing": 0})
        order.append("produced-result-line")  # only runs after fr's line was consumed
        yield "__RESULT__" + json.dumps({"load_s": 0.0, "infer_s": 0.0})

    wq._consume_manifest_stream(gen(), lambda m: order.append("scored-" + m["label"]))
    # fr scored strictly before the generator moved on to the result line: streaming,
    # not buffer-then-process.
    assert order == ["scored-fr", "produced-result-line"], order


def T13_w4a8_is_a_known_encoder_quant():
    # The MatMulNBits 4-bit encoder (scripts/quantize-nbits.py) is selected by onnx-asr's
    # filename-suffix scheme, so the table value IS the suffix: `encoder-model.w4a8.onnx`.
    # A missing key here makes --quants w4a8 exit as "unknown quant" and the FLEURS
    # harness in the model repo silently cannot score the 4-bit build.
    assert wq.QUANT_ARG["w4a8"] == "w4a8", wq.QUANT_ARG
    assert f"encoder-model.{wq.QUANT_ARG['w4a8']}.onnx" == "encoder-model.w4a8.onnx"
    # fp32 stays the unsuffixed file, so adding a width did not shift the sentinel.
    assert wq.QUANT_ARG["fp32"] is None


def _make_model_dir(root, files):
    """Create empty placeholder weights at the given relative paths."""
    for rel in files:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"")


def T14_layout_dir_for_maps_basename_to_directory():
    # The rule mirrors app/src/modelLayout.js: the directory is a pure function of
    # the basename, and the sidecars follow their graph.
    assert wq.layout_dir_for("encoder-model.int8.onnx") == "int8/"
    assert wq.layout_dir_for("decoder_joint-model.int8.onnx") == "int8/"
    # The longer suffix wins, or the lite build would land in int8/.
    assert wq.layout_dir_for("encoder-model.int8.lite.onnx") == "int8-lite/"
    assert wq.layout_dir_for("encoder-model.w4a8.onnx") == "w4a8/"
    assert wq.layout_dir_for("encoder-model.fp16.onnx") == "fp16/"
    assert wq.layout_dir_for("encoder-model.onnx") == "fp32/"
    assert wq.layout_dir_for("encoder-model.onnx.data") == "fp32/"
    assert wq.layout_dir_for("encoder-model.onnx.data.001") == "fp32/"
    assert wq.layout_dir_for("decoder_joint-model.onnx") == "fp32/"
    # Root files, ONNX or not.
    for name in ("vocab.txt", "config.json", "nemo128.onnx", "README.md"):
        assert wq.layout_dir_for(name) == "", name


def T15_candidate_paths_order_is_layout_root_sharded():
    assert wq.candidate_paths("encoder-model.int8.onnx") == [
        "int8/encoder-model.int8.onnx",
        "encoder-model.int8.onnx",
        "sharded/encoder-model.int8.onnx",
    ]
    # A root file yields two entries, not a duplicated one.
    assert wq.candidate_paths("vocab.txt") == ["vocab.txt", "sharded/vocab.txt"]


def T16_relocate_finds_the_nested_layout():
    # The layout the model repos ship: one directory per precision.
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _make_model_dir(root, [
            "vocab.txt",
            "int8/encoder-model.int8.onnx", "int8/decoder_joint-model.int8.onnx",
            "fp32/encoder-model.onnx", "fp32/encoder-model.onnx.data",
            "fp32/decoder_joint-model.onnx",
            "w4a8/encoder-model.w4a8.onnx",
        ])
        # onnx-asr hands out basename-shaped globs, where '?' stands in for '.'.
        assert wq.relocate_model_file(root, "encoder-model?int8.onnx") == "int8/encoder-model?int8.onnx"
        assert wq.relocate_model_file(root, "decoder_joint-model?int8.onnx") == "int8/decoder_joint-model?int8.onnx"
        assert wq.relocate_model_file(root, "encoder-model.onnx") == "fp32/encoder-model.onnx"
        assert wq.relocate_model_file(root, "encoder-model?w4a8.onnx") == "w4a8/encoder-model?w4a8.onnx"
        # vocab.txt is a root file in every layout.
        assert wq.relocate_model_file(root, "vocab.txt") == "vocab.txt"
        # The rewritten pattern must actually resolve the way onnx-asr resolves it.
        hits = list(root.glob(wq.relocate_model_file(root, "encoder-model?int8.onnx")))
        assert [p.name for p in hits] == ["encoder-model.int8.onnx"], hits


def T17_relocate_leaves_the_flat_layout_alone():
    # Upstream istupakov / an older mirror / an `hf download` of a pre-move
    # revision: everything at the top level, which onnx-asr already resolves.
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _make_model_dir(root, [
            "vocab.txt", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx",
            "encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx",
        ])
        for pattern in ("encoder-model?int8.onnx", "decoder_joint-model?int8.onnx",
                        "encoder-model.onnx", "vocab.txt"):
            assert wq.relocate_model_file(root, pattern) == pattern, pattern
        # A file the dir does not have is returned unchanged, so onnx-asr raises
        # its own ModelFileNotFoundError instead of us inventing a path.
        assert wq.relocate_model_file(root, "encoder-model?fp16.onnx") == "encoder-model?fp16.onnx"


def T18_relocate_finds_the_flat_plus_sharded_layout():
    # What the optimized repo published before the move: the root single-sidecar
    # fp32 encoder plus a sharded/ folder with the rewritten graph and its shards.
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _make_model_dir(root, [
            "vocab.txt", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx",
            "sharded/encoder-model.onnx",
            "sharded/encoder-model.onnx.data.000", "sharded/encoder-model.onnx.data.001",
        ])
        # No root copy of the fp32 graph here, so sharded/ is where it resolves.
        assert wq.relocate_model_file(root, "encoder-model.onnx") == "sharded/encoder-model.onnx"
        # int8 stays flat.
        assert wq.relocate_model_file(root, "encoder-model?int8.onnx") == "encoder-model?int8.onnx"

    # With BOTH copies present the root one wins, matching the documented order
    # (layout dir, root, sharded/).
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _make_model_dir(root, ["vocab.txt", "encoder-model.onnx", "sharded/encoder-model.onnx"])
        assert wq.relocate_model_file(root, "encoder-model.onnx") == "encoder-model.onnx"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("T") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\nall {len(tests)} tests passed")


if __name__ == "__main__":
    main()
