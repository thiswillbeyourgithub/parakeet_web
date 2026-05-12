# Forked parakeet.js

- Package: `parakeet.js`
- Upstream: https://github.com/ysdede/parakeet.js
- Fork-point upstream commit: `441412e6273808c32c91703af4b13d96c4273b20`
  (2025-07-15, upstream version `0.0.3`)
- First post-fork commit in this repo: `6be52cb` ("commit post fork", 2025-12-10)
- License: MIT (see `LICENSE.upstream`). The combined parakeet-web work is
  AGPLv3 (see `../../LICENSE`); MIT continues to apply to the portions
  originating upstream.
- **Last upstream commit triaged:** `262e1f9` (2026-04-03, upstream master HEAD
  at 2026-05-12). Bump this when running the sync runbook below.

Unlike the npm-vendored deps under `app/ui/vendor/`, this is **not** a clean
vendor of an upstream release. The code was forked at upstream v0.0.3 and has
since diverged substantially in both directions, so byte-level pinning
(tarball SHA-256, refresh-from-registry) does not apply here. Treat this
folder as first-party source maintained in-tree.

Imports resolve through the Vite alias `parakeet.js -> app/src/index.js`
(see `../ui/vite.config.js`), so nothing about this folder reaches npm at
install time; the listing in `../package.json` is just metadata.

## Divergence notes

- Upstream is now well past the fork-point (1.4.x at time of writing, with
  new modules such as `long_audio.js` and `sentence_boundary.js` that have
  no equivalent here).
- This fork carries non-trivial changes against the fork-point: refactored
  backend selection, expanded `models.js` registry, encoder/decoder
  quantization controls, deduplicated preprocessor sessions, dynamic
  `blankId` and tokenizer cleanup, plus everything required to integrate
  with the surrounding parakeet-web UI / signaling / Docker stack.
- `mel.js` was **ported from upstream after the fork-point**, not written
  from scratch. The header comment block is byte-identical to upstream's
  `src/mel.js` and the implementation tracks upstream's `f73dfc3 feat: Pure
  JS preprocessor, stateful streaming API` (2026-02-06). Upstream has
  since added FFT perf optimizations (real-FFT reconstruction, unrolled
  stages) that the local copy is missing — they are queued in the sync
  runbook below.
- Stateful streaming hooks (`previousDecoderState` / `returnDecoderState` /
  `timeOffset` on `transcribe()`) mirror upstream's
  `StatefulStreamingTranscriber` API but were re-implemented locally
  (commit `5c92e29`) rather than copied.
- Because the divergence is two-way, cherry-picking from upstream requires
  reading the relevant upstream commit by hand. There is no automated
  "refresh" path; `scripts/update-vendored.sh` deliberately ignores this
  folder.

## Refresh / sync procedure (manual, one-off)

If you just want to pull a single specific fix from upstream:

1. Identify the upstream commit (`git -C <upstream-clone> log -- src/<file>`).
2. Read the diff between the fork-point commit
   (`441412e6273808c32c91703af4b13d96c4273b20`) and the target commit.
3. Apply by hand, keeping the local refactors intact.
4. Record what you picked in the commit message (`Picks <sha> from upstream`).
5. Update the "Last upstream commit triaged" SHA above if you advance past it.

## Upstream sync runbook (periodic Claude-driven round)

The goal: periodically have Claude survey upstream commits we haven't
triaged yet, decide which to port, port the worthwhile ones in separate
commits, and document the rest so the next round doesn't re-evaluate
them. This file holds the durable record; `TEMP_PLAN.md` at the repo root
holds the per-round backlog (gitignored — it's working state, not a
deliverable).

### Procedure

1. **Refresh upstream clone.**
   ```sh
   cd /tmp && rm -rf parakeet-upstream
   git clone --quiet https://github.com/ysdede/parakeet.js.git parakeet-upstream
   ```

2. **List untriaged commits.** Use the "Last upstream commit triaged" SHA
   from the header of this file:
   ```sh
   cd /tmp/parakeet-upstream
   git log --format='%h %ad %s' --date=short --no-merges <LAST_SHA>..master -- src/ types/
   ```

3. **Triage each new commit into `TEMP_PLAN.md`.** Use the verdict tags:
   - `PORT` / `PORT-CRITICAL` / `PORT-HARD` — bring it over (each in its
     own local commit, mention the upstream SHA in the message).
   - `DONE` — already covered locally (record the local SHA in the entry).
   - `DEPENDS` — only relevant after a parent PORT lands.
   - `OUT-OF-SCOPE` — features parakeet-web doesn't use (long_audio,
     sentence_boundary, LCS merger, fp16, multilingual v3, FLEURS, GH-Pages
     demo, HF Spaces demo).
   - `SKIP` — pure log/comment/TODO/refactor noise.

4. **Port the `PORT*` items.** For each:
   - Inspect the upstream diff at that SHA.
   - Re-implement the equivalent change in `app/src/`, preserving local
     refactors and naming. These are usually **not** clean cherry-picks
     because the surrounding code has moved.
   - Stage and commit with a message like:
     ```
     <conv>(<scope>): <subject>

     Re-implementation of upstream <sha> (<short subject>). The upstream
     patch did not apply cleanly because <reason>; the equivalent change
     here is <one-line summary of what the local diff does>.
     ```
   - Run a local build (`cd app/ui && npm run build`) at minimum; ideally
     re-test transcription on a sample.
   - Flip the `[ ]` to `[x]` in `TEMP_PLAN.md` and record the local SHA.

5. **Bump the "Last upstream commit triaged" SHA** in this file once every
   commit in the new range has a verdict (whether `[x]`, `DONE`, or
   `OUT-OF-SCOPE`). Commit the bump separately from the ports themselves
   so the audit trail is clean.

6. **Append a one-line entry to the "Sync log" below** for the round:
   `- <round-date>: triaged <N> new commits, ported <M>. <one-sentence highlight>.`

### What stays local vs upstream

- **Keep first-party (do not try to sync to upstream):** `hub.js` (resumable
  downloads, SHA-256 model verification, HF revision pin, IndexedDB
  caching, local fallback), `models.js`, `idb.js`, the entire security
  hardening layer.
- **Track upstream:** `parakeet.js` (the decoder/transcribe loop),
  `mel.js`, `preprocessor.js`, `tokenizer.js`, `backend.js`. These are
  the files where upstream fixes are most likely to apply.
- **Out-of-scope upstream features (don't port even if asked):** long-form
  audio chunking, sentence boundary detection, LCS-based segment merger,
  fp16 quantization path, multilingual v3 demo plumbing, FLEURS dataset
  utilities, anything under upstream's `demo/` directory.

## Bug fixes that look novel locally (candidates to upstream)

If you ever feel like sending PRs back to ysdede/parakeet.js, these local
commits do not appear to have an upstream equivalent:

- `c82036a` — clamp non-finite confidence to avoid NaN/-Infinity in log-prob
- `3b8eaaf` + `6b3b302` — read `blankId` from tokenizer instead of hardcoding
  1024; throw if `<blk>` token missing
- `1d6cb49` — serialize session creation when externalData is present
- `f0afc65` / `afff02b` — pre-allocate reusable tensors + zero-copy joiner
  subarray (may overlap with upstream `47427b5`; verify before submitting)

## Sync log

- **2026-05-12 (round 0):** initial triage against upstream HEAD `262e1f9`.
  87 src/types commits since fork-point; ~30 queued for port, ~8 marked DONE,
  rest OUT-OF-SCOPE. No ports applied in this round — the round just
  bootstrapped the runbook.
- **2026-05-12 (round 1):** ported upstream `0629e8f` (NeMo TDT alignment)
  as local `05c6fb6`. The decode loop now only adopts the new decoder state
  on non-blank emission and no longer forces an extra `t += 1` when staying
  on the same frame — this unblocks legitimate multi-token-per-frame
  emission (the fix's documented win on contraction-heavy audio).
- **2026-05-12 (round 2):** wholesale-resynced `mel.js` from upstream HEAD
  `262e1f9` as local `2732210`. Local mel.js had no parakeet-web-specific
  divergence (single port commit, byte-identical to upstream's snapshot),
  so replacing the file is cleaner than chained cherry-picks across 17
  perf/correctness commits with cross-commit invariants. Bulk of the
  delta is the FFT real-reconstruction path (PR74), 3-stage FFT unroll,
  shared precompute, buffer reuse, MurmurHash3-style mel cache key, and
  filterbank sparse bounds. Public API unchanged.
- **2026-05-12 (round 3):** three small upstream items.
  (a) `79d01fd` ports `85af256` — `fromHub` was flattening the wrong shape
  into `fromUrls`; App.jsx was unaffected since it doesn't use `fromHub`.
  (b) `6b8ba53` ports `9218917` — adds the four shape-validation checks
  in `_runCombinedStep` (logits present, both output states present,
  data length covers vocab, TDT duration logits non-empty), with eager
  `logits.dispose()` on failure. (c) `93844f5` marked DONE — its
  parakeet.js half was already absorbed by round 1's port `05c6fb6`,
  and its backend.js half is already covered by `bd38bf1`.

(Documentation prepared with help from Claude Code.)
