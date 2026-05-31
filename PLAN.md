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
- Because decoding is greedy (not beam), boosting is best-effort: we bias the
  per-step token choice toward continuing/starting a boost phrase. We cannot
  recover a phrase that greedy already pruned in an earlier frame. This is an
  accepted limitation; document it in the UI/help text. (A future, much larger
  task could add a small beam search; tracked as a stretch goal, not in scope
  for the first working version.)

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
  (`decode`). There is **no text → token-id encoder**, and the app ships only
  `vocab.txt`/`tokens.txt` (SentencePiece vocab), **not** the SentencePiece
  `.model` file. To turn a user phrase string into the token-id sequence(s) the
  trie needs, we must implement subword encoding ourselves from the vocab
  (handling the `▁` U+2581 word-start marker). This is its own subtask (Phase 1)
  and is the riskiest correctness item.
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
     using the vocab encoder from Phase 1. Include a leading-`▁` (word-start)
     variant so the phrase matches at a word boundary.
   - Insert each sequence into a trie. Each node knows its depth and its set of
     valid next-token-ids → child nodes. The root is always implicitly active.
2. **Track active trie nodes** during the greedy loop (start of utterance: just
   the root). Active set = all trie nodes we are currently "inside" plus root.
3. **Inject boost before argmax** at each step: for every active node, for each
   of its child tokens `tok`, add a reward to `tokenLogits[tok]`. Reward =
   `boostStrength * f(depth)` where `f` implements `depth_scaling` (deeper =
   more committed = larger reward, encouraging phrase completion). Keep it as a
   logit-space additive bonus (shallow fusion). Optionally apply a small penalty
   to leaving a partially-matched phrase (cancellation), but start without it
   for simplicity and add only if quality needs it.
4. **Update active nodes after emission:** when a non-blank token `maxId` is
   emitted, advance every active node that has `maxId` as a child to that child;
   nodes that don't match drop back to root (greedy can't keep alternatives).
   Always keep root active so a new phrase can start anytime. On phrase
   completion (terminal node) optionally emit nothing special — the tokens are
   already in `ids`.
5. **Parameters** (mirror the PR's vocabulary): `boostStrength` (≈ alpha *
   context_score, single user-facing slider), and a fixed/internal
   `depthScaling`. Expose at least the strength to the user.

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

### Phase 1 — Vocab subword encoder (text → token ids) [RISKIEST]
- [ ] Add `encode(text)` to `ParakeetTokenizer` (or a sibling util) that maps a
      string to token id(s) using the loaded vocab. Approach: build a
      token→id map once; greedy longest-match over characters with the `▁`
      word-start marker (prefix the first piece of each word with `▁`). Handle
      lowercase/case, unknown chars (fall back to `<unk>` or skip), and multi-
      word phrases.
- [ ] Optionally produce a small set of alternative tokenizations (with/without
      leading space, common casings) to improve match robustness.
- [ ] Unit-test the encoder by round-tripping: `decode(encode(x)) ≈ x` for a
      handful of phrases including accented French medical vocab (the app's
      target domain). No test harness exists yet (see TODO.md note) — add a
      minimal standalone test or a temporary script; do not block on a full
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
- [ ] Add a UI control (e.g. a textarea "one phrase per line" + a boost-strength
      slider) somewhere sensible in `App.jsx`. Keep it collapsed/advanced so it
      doesn't clutter the default flow.
- [ ] Persist the phrase list + strength in IndexedDB (`idb.js`) so it survives
      reloads. Decide localStorage vs idb (idb already used) — see Q3.
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

## 6. Open questions / decisions (resolve with user or pick documented default)
- **Q1. Scope of decoding:** greedy-only boosting now, beam search later?
  Default: greedy-only (matches current decoder). Beam = separate big project.
- **Q2. UI placement & format:** textarea (one phrase per line) + single
  strength slider, in an "Advanced" area. Default: yes.
- **Q3. Persistence:** IndexedDB via `idb.js` (already a dependency) vs
  localStorage. Default: IndexedDB to match existing storage.
- **Q4. Streaming state:** reset trie per window (default) vs carry across
  windows. Default: reset per `transcribe()` call (simplest, matches greedy).
- **Q5. Encoder fidelity:** greedy longest-match vocab encoder is approximate vs
  true SentencePiece. Is approximate acceptable, or do we ship the `.model` and
  add a real SP encoder (bigger download + dep)? Default: approximate first,
  measure, revisit only if match quality is poor.
- **Q6. Multiple boost weights per phrase** (PR supports per-phrase weighting)
  vs one global strength. Default: one global strength first.

## 7. Progress log (append newest at bottom; date + what changed + next step)
- 2026-05-31 — Session 1. Researched NeMo PR #14277 (server CUDA GPU-PB) and
  issue #14772; confirmed it can only be ported as a *concept* to this app's
  greedy TDT decoder. Mapped codebase anchor points (decode loop in
  `parakeet.js transcribe()` ~L452-476; missing text→id encoder in
  `tokenizer.js`; three `transcribe()` call sites). Chose greedy shallow-fusion
  boosting-trie design (§3). Wrote this PLAN.md. **Next:** confirm open
  questions in §6 (or accept defaults), then start Phase 1 (vocab subword
  encoder) — the riskiest correctness piece.
