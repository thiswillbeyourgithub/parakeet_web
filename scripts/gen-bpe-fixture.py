#!/usr/bin/env python3
"""Emit a cross-check fixture for the JS BPE encoder to stdout (JSON).

For each phrase we record the ground-truth token ids produced by the REAL
HuggingFace `tokenizers` library loading the upstream tokenizer.json. We also
emit the model's id2token table parsed from vocab.txt exactly the way the app's
tokenizer.js parses it, so the JS encoder under test uses the same vocabulary
the app uses at runtime.

Consumed by scripts/test-bpe-encoder.mjs. Round-tripping decode(encode(x)) is
NOT a sufficient check (it passes for a wrong-but-self-consistent encoder), so
this exact-id cross-check against HuggingFace is the real gate.

Requires: pip install tokenizers huggingface_hub  (network on first run; cached).
Built with Claude Code.
"""
import json, sys
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download

# Phrase set: the single source of truth for cross-check cases. Covers the
# categories called out in PLAN.md Phase 1 plus edge cases.
PHRASES = [
    # plain English
    "hello world", "acetaminophen", "ibuprofen", "transcription",
    "Dr. Smith", "Mr. O'Brien", "e.g.", "U.S.A.",
    # accented / French medical vocab
    "café", "naïve", "Müller", "métastase", "œsophage", "pneumonie",
    "hémoglobine", "diabète", "anticoagulant", "céphalée", "ostéoporose",
    "électrocardiogramme", "Élisabeth",
    # acronyms
    "ECG", "MRI", "DNA", "COVID", "HbA1c", "mRNA", "NaCl",
    # hyphenated
    "co-trimoxazole", "well-being", "twenty-one", "SARS-CoV-2",
    # digits / mixed
    "COVID-19", "type 1 diabetes", "ibuprofen 200mg", "p53", "level 2.5",
    "3,5-dimethyl", "v3", "A1c", "12 34", "1.5", "200",
    # CJK / non-Latin (expected to hit <unk> via fuse_unk)
    "東京", "北京", "中文", "한국어", "ありがとう",
    # whitespace / punctuation edge cases
    "  double  space ", " leading", "trailing ", "x  y", "   ",
    "multiple   spaces here", "",
    # mixed scripts
    "café ☕", "naïve résumé",
]


def main():
    tok_path = hf_hub_download("nvidia/parakeet-tdt-0.6b-v3", "tokenizer.json")
    vocab_path = hf_hub_download("istupakov/parakeet-tdt-0.6b-v3-onnx", "vocab.txt")

    tk = Tokenizer.from_file(tok_path)

    # Parse vocab.txt the same way app/src/tokenizer.js does: split on
    # whitespace, take [piece, id]. Build the id2token array (index == id).
    id2token = []
    with open(vocab_path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            piece, idstr = parts[0], parts[1]
            i = int(idstr)
            if i >= len(id2token):
                id2token.extend([None] * (i + 1 - len(id2token)))
            id2token[i] = piece

    cases = [{"text": p, "ids": tk.encode(p).ids} for p in PHRASES]
    json.dump({"id2token": id2token, "cases": cases}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
