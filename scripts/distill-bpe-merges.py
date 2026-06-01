#!/usr/bin/env python3
"""Distill the BPE merges + added-token list from the upstream Parakeet
tokenizer.json into a small asset for the browser phrase-boosting encoder.

The app already ships the full piece->id table as vocab.txt (downloaded with
the ONNX model), so we deliberately do NOT duplicate ids here: we vendor only
the ranked `merges` list (absent from vocab.txt) plus the list of added-token
contents (so the encoder knows which substrings to split out before BPE, e.g.
the digits 0-9). Ids are resolved from vocab.txt at runtime.

Source: nvidia/parakeet-tdt-0.6b-v3  (tokenizer.json)
Run:    python scripts/distill-bpe-merges.py
Built with Claude Code.
"""
import json, hashlib, sys
from pathlib import Path
from huggingface_hub import hf_hub_download

OUT = Path("app/ui/public/tokenizer/bpe-merges.json")
SRC_REPO = "nvidia/parakeet-tdt-0.6b-v3"

def main():
    path = hf_hub_download(SRC_REPO, "tokenizer.json")
    raw = Path(path).read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    tok = json.loads(raw)
    model = tok["model"]
    assert model["type"] == "BPE", f"expected BPE, got {model['type']}"
    merges = model["merges"]
    # Normalise merges to [a, b] pairs (newer tokenizers already use pairs).
    norm_merges = []
    for m in merges:
        if isinstance(m, str):
            a, b = m.split(" ", 1)
        else:
            a, b = m[0], m[1]
        norm_merges.append([a, b])
    # Added-token contents (everything matched before the BPE model). The
    # encoder resolves these to ids via vocab.txt and skips any it can't (e.g.
    # the blank token, named <blank> upstream but <blk> in vocab.txt).
    added = [a["content"] for a in tok["added_tokens"]]
    out = {
        "_source": SRC_REPO + "/tokenizer.json",
        "_source_sha256": sha,
        "byte_fallback": model.get("byte_fallback", False),
        "fuse_unk": model.get("fuse_unk", False),
        "ignore_merges": model.get("ignore_merges", False),
        "metaspace": "▁",
        "merges": norm_merges,
        "added_tokens": added,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    print(f"  merges: {len(norm_merges)}  added_tokens: {len(added)}")
    print(f"  source sha256: {sha}")

if __name__ == "__main__":
    main()
