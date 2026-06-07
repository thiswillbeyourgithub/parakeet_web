# Vendored BPE tokenizer asset (`bpe-merges.json`)

This directory holds the small tokenizer asset used by the **phrase boosting**
feature to turn user-supplied phrases into the same token-id sequences the
Parakeet model emits. It is loaded lazily, only when boosting is enabled, so it
does not bloat the default page load.

## What is in `bpe-merges.json`

The Parakeet tokenizer is a **BPE** tokenizer (not Unigram). The app already
ships the full `piece -> id` table as `vocab.txt` (downloaded alongside the ONNX
model), so to avoid duplicating that mapping this asset deliberately stores
**only what `vocab.txt` lacks**:

- `merges`: the ranked list of BPE merge pairs (`[["e","n"], ["▁","s"], ...]`).
  Rank = array order; lower index = applied first.
- `added_tokens`: the contents of the tokenizer's added tokens (digits `0`-`9`
  and the `<|...|>` control tokens). The encoder splits these out of the input
  before applying BPE, exactly as the upstream tokenizer does. Their ids are
  resolved from `vocab.txt` at runtime (not stored here), so there is no id
  duplication. Entries that do not resolve (e.g. `<blank>`, named `<blk>` in
  `vocab.txt`) are skipped; they never appear in text anyway.
- `byte_fallback`, `fuse_unk`, `ignore_merges`, `metaspace`: model flags the
  encoder needs to faithfully reproduce upstream behavior.

## Provenance

- Source: `nvidia/parakeet-tdt-0.6b-v3` / `tokenizer.json`
- Source `tokenizer.json` SHA-256:
  `bd321b096832a3f270bd3b2a88823957920f1a5c5ada71114a26ea729d0cbe91`
- Regenerate with: `python scripts/distill-bpe-merges.py` (from the repo root).

Note: the authoritative `tokenizer.json` lives in the upstream NVIDIA repo, NOT
in the `Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx` repo the app downloads
the model weights from (that repo ships only `vocab.txt`).

This asset and its tooling were produced with Claude Code.
