# PLAN.md — Phrase Boosting (Context Biasing) for Parakeet Web

> **This is a recursive / cross-session plan file.** It is the single source of
> truth for the "phrase boosting" feature. Any session can pick this up: read it
> top to bottom, look at the **Progress log** to see where we stopped, do the
> next unchecked task, update the checkboxes and the Progress log, commit, and
> stop. Keep this file up to date as the work evolves; it is meant to outlive any
> single session's context window.

## 0. Original instruction (verbatim, do not lose this)

The user's request that created this plan:

> okay so please i'p gonna need a very ambitious feature, it's too complicated
> for a single session I believe so we'll need to use a recursive PLAN.md file
> where you store everything inside needed so I can just tell across sessions to
> iterate based on that file, including this very instruction. also mention in it
> that the TODO.md file is not relevant for this feature. The ask is: implement
> phrase boosting:
> - The reference PR: https://github.com/NVIDIA-NeMo/NeMo/pull/14277
> - Some more context here: https://github.com/NVIDIA-NeMo/NeMo/issues/14772

**`TODO.md` is NOT relevant to this feature.** It contains unrelated project
chores (slimming the React monolith, demo GIF, hardening loops, test suite,
dependency audit). Do not treat any TODO.md line as part of phrase boosting.
The single TODO.md line that *is* this feature ("implement phrase boosting…")
is fully superseded by this PLAN.md.

## 1. Goal

Let the user supply a list of "boost phrases" (names, jargon, drug names,
acronyms, etc.) that the transcriber should be biased toward recognizing, so
that audio which is acoustically ambiguous resolves in favor of those phrases.
Everything must stay 100% client-side (no network), consistent with the app's
privacy guarantee.

References:
- Reference PR: https://github.com/NVIDIA-NeMo/NeMo/pull/14277 (GPU-PB)
- Context issue: https://github.com/NVIDIA-NeMo/NeMo/issues/14772
- Background (older NeMo context biasing): PR #8223, `ASR_Context_Biasing.ipynb`,
  discussion #7839 (all referenced from the issue).

## 2. Research findings (so we don't re-derive this every session)

### 2.1 What the reference PR actually is
NeMo PR #14277 ("GPU-Accelerated Phrase-Boosting", GPU-PB) is a **server-side,
CUDA/PyTorch** implementation. Key points:
- It does **shallow fusion** during decoding using a **boosting tree** (a
  token-level trie / weighted finite-state structure), configured via
  `BoostingTreeModelConfig`.
- It generalizes NeMo's decoder to a list of fusion models
  (`fusion_states_list`) with per-model alpha weights, instead of a single
  KenLM n-gram path.
- Supported strategies: CTC (greedy_batch, beam_batch), RNN-T (greedy_batch,
  malsd_batch beam), **TDT (same logic as RNN-T)**, plus CUDA-graph mode.
- Config knobs: `key_phrases_file` (phrase list), `context_score` (per-arc
  reward, e.g. 1.0), `depth_scaling` (deeper matches rewarded more, e.g. 2.0),
  `boosting_tree_alpha` (fusion weight). Boost is applied as an additive
  reward during beam/greedy expansion.
- The older approach (PR #8223) is CTC word-spotting with a context graph and
  requires a `ctc_decoder` head, which the Parakeet TDT 0.6B hybrid model does
  **not** have (that is the exact blocker reported in issue #14772).

### 2.2 What we can actually port to this app
This app is **not** NeMo. It is a browser ONNX-Runtime-Web port doing **greedy
TDT decoding only** (no beam search). Therefore:
- We cannot reuse any CUDA/PyTorch code. We port the *concept*: a token-level
  boosting trie + additive shallow-fusion reward injected into the token logits
  before argmax.
- **DECISION (Q1): greedy now, beam later.** Ship greedy boosting first, but
  structure the boosting module so a small beam-search TDT decoder can consume
  the same `BoostingTrie` later without a rewrite. Keep boost scoring decoupled
  from the argmax so a future beam path can call the same "score these
  hypotheses" API. Beam search itself is a separate, larger project and is NOT
  in scope for the first working version.
- Because the first version decodes greedily, boosting is best-effort: we bias
  the per-step token choice toward continuing/starting a boost phrase. We cannot
  recover a phrase that greedy already pruned in an earlier frame. Document this
  limitation in the UI/help text.

### 2.3 Codebase anchor points (verified this session)
- **Decoder loop:** `app/src/parakeet.js`, method `transcribe()`. The greedy
  argmax over `tokenLogits` is around lines 452-476 (`_runCombinedStep()`
  returns `tokenLogits`, a zero-copy `subarray` view of the joiner output).
  **This is the single injection point**: apply boost to a *copy* of the token
  logits (or boost specific indices) before the argmax. Do NOT mutate the
  `subarray` view in place without care — it views the live joiner buffer
  (`_logitsTensor`) which is disposed after each step; copying the affected
  region is safest.
- **Per-frame loop mechanics matter for trie state:**
  - A step emits a non-blank token (`maxId !== blankId`) → advance trie state by
    that token.
  - Blank token → trie state unchanged (no token consumed).
  - TDT `step`/duration controls frame advancement; multiple tokens can be
    emitted on the same frame (`emittedTokens`, `maxTokensPerStep = 10`).
  - The trie state must live across frames for the whole utterance, reset per
    `transcribe()` call (or carried via `previousDecoderState` for streaming —
    see open question Q4).
- **Tokenizer gap (BIG):** `app/src/tokenizer.js` only does **id → text**
  (`decode`). There is **no text → token-id encoder**. To turn a user phrase
  string into the token-id sequence(s) the trie needs, we must add encoding.
  **DECISION (Q5): ship a real SentencePiece encoder**, not an approximate
  vocab longest-match. This means:
  - Source the SentencePiece `.model` file for this model. Check the model repo
    `istupakov/parakeet-tdt-0.6b-v3-onnx` (and `nvidia/parakeet-tdt-0.6b-v3`)
    for the `.model` / `tokenizer.model` artifact. **VERIFY it exists and the
    vocab matches `vocab.txt` exactly before building on it** (open task).
  - Parakeet SentencePiece is a **unigram** model: encoding = Viterbi
    best-segmentation over piece log-probs from the `.model` (a protobuf). We
    need a browser JS implementation. Options to evaluate (Phase 1): a small
    vendored JS SentencePiece/unigram library, or a minimal hand-rolled unigram
    Viterbi decoder that parses the `.model` protobuf for pieces+scores. Respect
    the no-network / supply-chain posture: vendor any dep under
    `app/ui/vendor/` with a `SOURCE.md`, or hand-roll to avoid the dependency.
  - The `.model` is an extra asset to download with the model; gate its fetch so
    it only loads when boosting is actually used (do not bloat the default
    load). Honor Chromium's blob-fetch cap concerns already noted in CLAUDE.md.
  - This is the riskiest correctness item; keep it isolated and unit-tested.
- **Call sites of `transcribe()`** (all must pass the new boosting option
  through, defaulting to off):
  - `app/ui/src/App.jsx:2559` (chunked long-audio path)
  - `app/ui/src/App.jsx:2659` (single-shot path)
  - `app/ui/src/lib/liveTranscriber.js:169` (live streaming path)
- **Config / i18n / persistence:** `app/ui/src/config.js` (runtime config),
  `app/ui/src/i18n.jsx` (all UI strings — add new keys), `app/src/idb.js`
  (IndexedDB) for persisting the phrase list.

## 3. Chosen algorithm (greedy shallow-fusion boosting trie)

This is the design to implement unless a future session deliberately changes it
(record any change here with rationale).

1. **Build a boosting trie** from the list of boost phrases:
   - For each phrase, produce one (or a few alternative) token-id sequence(s)
     using the SentencePiece encoder from Phase 1. Include a leading-`▁`
     (word-start) variant so the phrase matches at a word boundary.
   - Insert each sequence into a trie. Each node knows its depth and its set of
     valid next-token-ids → child nodes. The root is always implicitly active.
   - **DECISION (Q6): per-phrase weights.** Each inserted phrase carries its own
     weight; trie nodes store the (max) weight of phrases passing through them so
     the bonus at a node reflects that phrase's weight, not a single global one.
     UI input syntax: `phrase` (default weight) or `phrase:WEIGHT` (e.g.
     `acetaminophen:2.5`). Parse and validate weights (numeric, bounded); ignore
     malformed weights with a default and surface a gentle inline warning.
2. **Track active trie nodes** during the greedy loop (start of utterance: just
   the root). Active set = all trie nodes we are currently "inside" plus root.
3. **Inject boost before argmax** at each step: for every active node, for each
   of its child tokens `tok`, add a reward to `tokenLogits[tok]`. Reward =
   `phraseWeight * globalStrength * f(depth)` where `phraseWeight` is the node's
   per-phrase weight (Q6) and `f` implements `depth_scaling` (deeper = more
   committed = larger reward, encouraging phrase completion). Keep it as a
   logit-space additive bonus (shallow fusion). Expose this as a pure "score
   these candidate tokens" call on the trie so a future beam path (Q1) can reuse
   it. Optionally apply a small penalty to leaving a partially-matched phrase
   (cancellation), but start without it and add only if quality needs it.
4. **Update active nodes after emission:** when a non-blank token `maxId` is
   emitted, advance every active node that has `maxId` as a child to that child;
   nodes that don't match drop back to root (greedy can't keep alternatives).
   Always keep root active so a new phrase can start anytime. On phrase
   completion (terminal node) optionally emit nothing special — the tokens are
   already in `ids`.
5. **Parameters** (mirror the PR's vocabulary): a user-facing global
   `boostStrength` slider (≈ alpha * context_score) multiplied by each phrase's
   per-phrase weight (Q6), plus a fixed/internal `depthScaling`.

Keep the implementation in a **new module** (e.g. `app/src/phraseBoost.js`)
exporting a `BoostingTrie` class with `buildFromPhrases(phrases, tokenizer,
opts)`, `reset()`, `activeChildBoosts()` (returns token-id → bonus map for the
current active set), and `advance(tokenId)`. `parakeet.js` consumes it through a
single optional `opts.phraseBoost` (an already-built trie or its config); do not
duplicate decode logic. Per the user's global rule: **no code duplication** —
if boosting needs to touch the argmax in more than one place, factor the argmax
into a helper rather than copy-pasting the unrolled loop.

## 4. Task breakdown (check off as you go)

### Phase 0 — Setup
- [x] Research PR/issue + codebase; write this PLAN.md.
- [ ] (Optional) Resolve the open questions in §6 with the user, or proceed with
      the documented defaults and note the choice in the Progress log.

### Phase 1 — SentencePiece encoder (text → token ids) [RISKIEST] (Q5)
- [ ] Locate and verify the SentencePiece `.model` for this model in the model
      repo(s) (`istupakov/parakeet-tdt-0.6b-v3-onnx`,
      `nvidia/parakeet-tdt-0.6b-v3`). Confirm its piece list matches the shipped
      `vocab.txt`/`tokens.txt` ids exactly. If no `.model` exists or ids do not
      line up, STOP and re-raise with the user (fallback would be the approximate
      vocab longest-match we explicitly chose against in Q5).
- [ ] Decide encoder implementation: vendored JS SentencePiece/unigram lib under
      `app/ui/vendor/` (+ `SOURCE.md`) vs a hand-rolled unigram Viterbi decoder
      that parses the `.model` protobuf (pieces + log-scores). Prefer hand-rolled
      if small, to avoid a new supply-chain dependency; otherwise vendor.
- [ ] Implement `encode(text)` producing token-id sequence(s), with a leading-`▁`
      word-start variant. Handle casing, unknown chars, multi-word phrases.
- [ ] Gate `.model` download so it loads only when boosting is enabled (do not
      bloat default model load; mind Chromium blob-fetch cap from CLAUDE.md).
- [ ] Unit-test by round-tripping `decode(encode(x)) ≈ x` for phrases including
      accented French medical vocab (the app's target domain). No test harness
      exists yet — add a minimal standalone test/script; do not block on a full
      suite.
- [ ] Commit.

### Phase 2 — Boosting trie + decode hook
- [ ] Create `app/src/phraseBoost.js` with `BoostingTrie` per §3.
- [ ] Wire into `parakeet.js transcribe()`: accept `opts.phraseBoost`, reset at
      start, inject boosts before argmax, advance after each emitted token.
      Inject by copying only the affected logit indices (do not mutate the live
      joiner subarray view unsafely). Default path (no boost) must be byte-for-
      byte unchanged in behavior and ~unchanged in speed.
- [ ] Verify memory hygiene: no new un-disposed ORT tensors; trie is plain JS.
- [ ] Commit.

### Phase 3 — UI + plumbing
- [ ] Add a textarea ("one phrase per line", supporting optional `phrase:WEIGHT`
      per Q6) + a global boost-strength slider, in a collapsed Advanced area of
      `App.jsx` (Q2). Show inline parse warnings for malformed weights.
- [ ] Persist the phrase list + global strength in **IndexedDB via `idb.js`**
      (Q3) so it survives reloads.
- [ ] Build the trie once when phrases change (not per transcribe), pass it
      through all three `transcribe()` call sites (App.jsx x2, liveTranscriber).
- [ ] Add i18n strings in `i18n.jsx` for every new label/help text (EN + FR at
      minimum — match existing languages present in the file).
- [ ] Commit (UI and i18n can be one or two commits; one commit per logical
      unit per the user's preference).

### Phase 4 — Live transcription path
- [ ] Confirm boosting works with the streaming/windowed `liveTranscriber.js`
      path. Mind that live re-transcribes overlapping windows; trie state should
      reset per window (it already calls `transcribe()` per tick). Verify no
      double-counting / drift.
- [ ] Commit.

### Phase 5 — Verify, document, screenshot
- [ ] Manual verification with the `/verify` or `/run` skill: load model, enable
      a boost phrase that the model otherwise mis-transcribes, confirm it now
      appears. Capture before/after.
- [ ] Update `README.md` features table + a short "Phrase Boosting" section.
      Mention it was built with Claude Code (per user's global doc rule) and
      note the greedy-decoding best-effort limitation.
- [ ] Refresh README screenshot only if UI visibly changed (see CLAUDE.md
      shot-scraper recipe). Ask the user before refreshing.
- [ ] Bump version: edit `app/package.json` only, in its own commit, after all
      other changes are committed (per CLAUDE.md).
- [ ] Remove the "implement phrase boosting" line from `TODO.md` once shipped.

## 5. Constraints / project rules to respect (from CLAUDE.md + global prefs)
- **No code duplication.** Factor shared logic; flag any duplication to the user.
- **Many small commits**, ideally one per task/loop turn. Commit prior unrelated
  changes separately before version bumps.
- **No em-dashes** anywhere (code, comments, docs, commits). Use commas/colons/
  parentheses. (This file follows that rule.)
- Mark any placeholder with `TODO` and tell the user about it.
- Version bump = edit `app/package.json` only, separate commit, last.
- Stay fully client-side; no new network calls; respect the privacy posture and
  the ongoing security-hardening mindset (treat phrase list as untrusted text:
  no eval, careful with regex built from user input, bound trie size).
- Use the global skills where relevant: `dev-pref`, `clean-code`/`simplify`
  before finalizing, `verify`/`run` to confirm, `code-review` on the diff.

## 6. Decisions (RESOLVED with user 2026-05-31)
- **Q1. Decoding scope:** RESOLVED → **greedy now, beam later.** Build greedy
  boosting but keep the trie scoring API reusable by a future beam decoder.
- **Q2. UI placement & format:** RESOLVED → **textarea (one phrase per line) +
  global strength slider, in a collapsed Advanced area.**
- **Q3. Persistence:** RESOLVED → **IndexedDB via `idb.js`.**
- **Q4. Streaming state:** RESOLVED → **reset trie per window / per
  `transcribe()` call.**
- **Q5. Encoder fidelity:** RESOLVED → **ship a real SentencePiece encoder**
  (source/verify the `.model`, hand-roll or vendor a unigram Viterbi encoder).
  Not the approximate vocab longest-match.
- **Q6. Boost weights:** RESOLVED → **per-phrase weights** (`phrase:WEIGHT`
  syntax) multiplied by the global strength slider.

## 7. Progress log (append newest at bottom; date + what changed + next step)
- 2026-05-31 — Session 1. Researched NeMo PR #14277 (server CUDA GPU-PB) and
  issue #14772; confirmed it can only be ported as a *concept* to this app's
  greedy TDT decoder. Mapped codebase anchor points (decode loop in
  `parakeet.js transcribe()` ~L452-476; missing text→id encoder in
  `tokenizer.js`; three `transcribe()` call sites). Chose greedy shallow-fusion
  boosting-trie design (§3). Wrote this PLAN.md. **Next:** confirm open
  questions in §6 (or accept defaults), then start Phase 1 (vocab subword
  encoder) — the riskiest correctness piece.
- 2026-05-31 — Session 1 (cont). Resolved all open questions with the user and
  folded the answers into §2/§3/§4/§6: greedy-now-beam-later (Q1), real
  SentencePiece encoder (Q5, upgrades Phase 1 from approximate to sourcing and
  parsing the `.model`), per-phrase weights (Q6), Advanced textarea + slider
  (Q2), IndexedDB (Q3), reset-per-window streaming (Q4). **Next:** Phase 1 step
  1 — locate and verify the SentencePiece `.model` for parakeet-tdt-0.6b-v3 and
  confirm its piece ids match the shipped vocab before building the encoder.
