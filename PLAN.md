# PLAN.md: Phrase Boosting (Context Biasing) for Parakeet Web

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
  `subarray` view in place without care, since it views the live joiner buffer
  (`_logitsTensor`) which is disposed after each step; copying the affected
  region is safest.
- **Per-frame loop mechanics matter for trie state:**
  - A step emits a non-blank token (`maxId !== blankId`) → advance trie state by
    that token.
  - Blank token → trie state unchanged (no token consumed).
  - TDT `step`/duration controls frame advancement; multiple tokens can be
    emitted on the same frame (`emittedTokens`, `maxTokensPerStep = 10`).
  - The trie state must live across frames for the whole utterance, reset per
    `transcribe()` call (or carried via `previousDecoderState` for streaming;
    see open question Q4).
- **Tokenizer gap (BIG):** `app/src/tokenizer.js` only does **id → text**
  (`decode`). There is **no text → token-id encoder**. To turn a user phrase
  string into the token-id sequence(s) the trie needs, we must add encoding.
  **DECISION (Q5): ship a real tokenizer-faithful encoder**, not an approximate
  vocab longest-match. **VERIFIED FACTS (session 2, re-confirmed with a clean
  run):**
  - The tokenizer is **BPE, NOT Unigram.** (An earlier note in this plan said
    "unigram" / "SentencePiece .model"; that was WRONG. Ignore any unigram
    framing anywhere in this file.) There is no SentencePiece `.model` in either
    ONNX repo. The authoritative tokenizer is published as a standalone
    `tokenizer.json` (HuggingFace `tokenizers` format) at
    `nvidia/parakeet-tdt-0.6b-v3` (NOT in the `istupakov/...-onnx` repo the app
    downloads from). Its `model` block is:
      - `type: "BPE"`, `vocab`: dict `piece -> id` (8192 entries),
        `merges`: **13476 ranked pairs** (e.g. `["e","n"], ["▁","s"], ...`),
        `byte_fallback: true`, `unk_id: null`, `fuse_unk: true`,
        `ignore_merges: false` (an earlier note said true; corrected session 2).
        NOTE: although `byte_fallback` is true, the vocab contains **no**
        `<0xHH>` byte tokens, so OOV characters fall through to `<unk>` (id 0),
        and `fuse_unk` collapses adjacent `<unk>`s into one (verified: 東京 ->
        `['▁','<unk>']`). CJK/non-Latin phrases therefore cannot be boosted
        meaningfully; this is a tokenizer limitation, not an encoder bug.
      - **Digits 0-9 are added_tokens** (ids 234-243), so they are extracted
        BEFORE BPE, exactly like the control tokens. This matters: in "200mg"
        the word-start marker `▁` lands on `m` (segment "mg"), not on the digits.
        The encoder must split added tokens out of the raw text first.
      - normalizer = Sequence[`Precompiled` charsmap, `Strip`, `Replace`].
      - pre_tokenizer = `Metaspace` (replacement `▁`, prepend_scheme "always",
        split true). decoder = `Metaspace` likewise.
      - 275 `added_tokens` = the `<|...|>` control tokens (lang/task markers),
        which we must NOT inject as ordinary text pieces.
  - **Encoding algorithm (BPE, not Viterbi):** Metaspace pre-tokenize (NFKC-ish
    normalize, leading-space prepend, spaces -> `▁`), start from the symbol
    sequence (chars, with byte_fallback to `<0xHH>` for OOV), then **greedily
    apply merges in rank order** until none apply. Merge RANK matters; there are
    no per-piece scores. Map final pieces -> ids via the app's `vocab.txt`
    (VERIFIED session 2: ids 0..8191 are byte-for-byte identical between the BPE
    `vocab` and the app's `vocab.txt`; the only diff is id 8192, `<blank>`
    upstream vs `<blk>` in vocab.txt, which is the blank token and irrelevant to
    text encoding). `ignore_merges` is **false** here, so the standard
    greedy-merge path always runs.
  - **Asset to vendor:** the distilled `merges` list (ranked), plus optionally
    the `piece->id` map (likely redundant with `vocab.txt`, so possibly just
    `merges`). Vendor under `app/ui/public/tokenizer/` (or `app/ui/vendor/`) with
    a `SOURCE.md` (provenance + source `tokenizer.json` SHA-256). It is small and
    loaded lazily only when boosting is enabled (do not bloat default load).
  - **Normalizer caveat:** we cannot trivially run the `Precompiled` charsmap in
    JS; approximate with Unicode NFKC + the Strip/Replace steps. This is the one
    deliberate deviation from byte-exact tokenization; cross-check against the
    real HF `tokenizers` lib in tests and revisit only if matches look weak.
  - This is the riskiest correctness item; keep it isolated and unit-tested.
  - **Implementation status:** a prior corrupted session wrote a *Unigram*
    encoder + a bogus "scores" asset and falsely reported commits; those files
    were deleted and nothing landed (HEAD stayed at the session-1 plan commits).
    Phase 1 starts fresh as BPE. See progress log 2026-06-01.
- **Call sites of `transcribe()`** (all must pass the new boosting option
  through, defaulting to off):
  - `app/ui/src/App.jsx:2559` (chunked long-audio path)
  - `app/ui/src/App.jsx:2659` (single-shot path)
  - `app/ui/src/lib/liveTranscriber.js:169` (live streaming path)
- **Config / i18n / persistence:** `app/ui/src/config.js` (runtime config),
  `app/ui/src/i18n.jsx` (all UI strings, add new keys), `app/src/idb.js`
  (IndexedDB) for persisting the phrase list.

## 3. Chosen algorithm (greedy shallow-fusion boosting trie)

This is the design to implement unless a future session deliberately changes it
(record any change here with rationale).

1. **Build a boosting trie** from the list of boost phrases:
   - For each phrase, produce one (or a few alternative) token-id sequence(s)
     using the BPE encoder from Phase 1. Include a leading-`▁`
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
   completion (terminal node) optionally emit nothing special, since the tokens are
   already in `ids`.
5. **Parameters** (mirror the PR's vocabulary): a user-facing global
   `boostStrength` slider (≈ alpha * context_score) multiplied by each phrase's
   per-phrase weight (Q6), plus a fixed/internal `depthScaling`.

Keep the implementation in a **new module** (e.g. `app/src/phraseBoost.js`)
exporting a `BoostingTrie` class with `buildFromPhrases(phrases, tokenizer,
opts)`, `reset()`, `activeChildBoosts()` (returns token-id → bonus map for the
current active set), and `advance(tokenId)`. `parakeet.js` consumes it through a
single optional `opts.phraseBoost` (an already-built trie or its config); do not
duplicate decode logic. Per the user's global rule of **no code duplication**:
if boosting needs to touch the argmax in more than one place, factor the argmax
into a helper rather than copy-pasting the unrolled loop.

## 4. Task breakdown (check off as you go)

### Phase 0: Setup
- [x] Research PR/issue + codebase; write this PLAN.md.
- [ ] (Optional) Resolve the open questions in §6 with the user, or proceed with
      the documented defaults and note the choice in the Progress log.

### Phase 1: BPE encoder (text -> token ids) [RISKIEST] (Q5)
NOTE: tokenizer VERIFIED as BPE (see §2.3 Q5). Do NOT build a unigram/Viterbi
encoder; a prior session did that by mistake and the files were deleted.
- [x] Locate/verify the tokenizer source and format. DONE (session 2): it is
      BPE; authoritative `tokenizer.json` is at `nvidia/parakeet-tdt-0.6b-v3`
      (13476 ranked merges, vocab dict, byte_fallback, Metaspace pre-tokenizer,
      275 control added_tokens). The `istupakov/...-onnx` repo ships only
      `vocab.txt`. See §2.3 Q5 for the full verified spec.
- [x] Confirm set-equality. DONE (session 2): ids 0..8191 are byte-for-byte
      identical between the BPE `vocab` and the app's `vocab.txt`; only id 8192
      differs (`<blank>` vs `<blk>`, the blank token, irrelevant to encoding).
      So `vocab.txt` alone is sufficient for piece->id; no need to vendor it.
      Digits 0-9 and the `<|...|>` controls are added_tokens (extract pre-BPE);
      no `<0xHH>` byte tokens exist so OOV -> `<unk>` (fused). See §2.3 Q5.
- [x] Distill + vendor the BPE asset. DONE: `scripts/distill-bpe-merges.py`
      writes `app/ui/public/tokenizer/bpe-merges.json` (ranked `merges` +
      `added_tokens` contents + model flags; ids resolved from `vocab.txt` at
      runtime, so NOT duplicated). 187 KB raw / 53 KB gzipped. `SOURCE.md`
      records provenance + source `tokenizer.json` SHA-256
      `bd321b096832a3f270bd3b2a88823957920f1a5c5ada71114a26ea729d0cbe91`.
      Commit aa4adde.
- [x] Implement a BPE encoder module. DONE: `app/src/bpeEncoder.js` exports
      `BpeEncoder`, `buildVocabToId`, and `loadBpeEncoder(tokenizer, url)`
      (lazy same-origin fetch of the asset). Faithful pipeline: added-token
      extraction -> NFKC-approx normalize + strip-right + collapse 2+ spaces ->
      Metaspace -> ranked-merge BPE -> byte_fallback -> fuse_unk. No new npm dep.
      Commit 1e22aea.
- [ ] Gate asset download so it loads only when boosting is enabled. PARTIAL:
      `loadBpeEncoder()` only fetches when called, so it is naturally
      boosting-only; the actual wiring (call it from the UI when boosting turns
      on) happens in Phase 3. Re-confirm there then.
- [x] Test: cross-check against the REAL HuggingFace `tokenizers` library. DONE:
      `scripts/test-bpe-encoder.mjs` (+ `scripts/gen-bpe-fixture.py`) compares
      exact id sequences for 57 phrases (accented French medical vocab, CJK,
      hyphenated, acronyms, digits, whitespace edge cases). **All 57 match HF.**
      Run: `node scripts/test-bpe-encoder.mjs` (needs python `tokenizers` +
      `huggingface_hub`). Commit 8b97ae9.
- [x] Commit (asset aa4adde, test 8b97ae9, encoder 1e22aea).

### Phase 2: Boosting trie + decode hook
- [x] Create `app/src/phraseBoost.js` with `BoostingTrie` per §3. DONE
      (commit 62b7522): `BoostingTrie` (build/insert/reset/activeChildBoosts/
      applyBoost/restore/advance), `parseBoostPhrases`, per-phrase weights with
      linear depth scaling, settable global `strength`, `MAX_PHRASE_WEIGHT`.
- [x] Wire into `parakeet.js transcribe()`. DONE (commit ba75ae5): accepts
      `opts.phraseBoost`, resets per call, boosts logits before the argmax and
      restores them right after (so confidence/log-prob use the model's true
      logits; `maxLogit` reset to the chosen token's true logit), advances on
      each non-blank emission. No-trie path is fully inert (default unchanged).
      NOTE: chose in-place boost + restore-after-argmax rather than a separate
      logit copy, so the perf-tuned 8x-unrolled argmax is reused verbatim (no
      duplication); touched indices are saved/restored, which is safe because it
      all happens before `_logitsTensor` is disposed.
- [x] Verify memory hygiene: trie is plain JS; no new ORT tensors created. The
      boost mutates the existing `tokenLogits` view in place and restores it; no
      extra buffers beyond a tiny saved-pairs array per step.
- [x] Test (commit c7be923): `scripts/test-phrase-boost.mjs` covers parsing,
      build, depth-scaled bonuses, advance/mismatch reset, and argmax flip +
      restore. All checks pass.
- [x] Commit (62b7522 module, ba75ae5 hook, c7be923 test).

### Phase 3: UI + plumbing
- [x] Add a textarea ("one phrase per line", supporting optional `phrase:WEIGHT`
      per Q6) + a global boost-strength slider, in a Phrase-boosting settings
      group of `App.jsx` (Q2). Show inline parse warnings for malformed weights.
      DONE (commit 203a39c): new `settingsGroupBoosting` group with a monospace
      textarea, an out-of-range-weight warning line, an active-phrase count, and
      a 0..5 step-0.5 strength slider.
- [x] Persist the phrase list + global strength in **IndexedDB via `idb.js`**
      (Q3) so it survives reloads. DONE: `boostPhrases` + `boostStrength` loaded
      in `loadSettings`, saved via `usePersistedSetting`, defaults `''` / `1`.
- [x] Build the trie once when phrases change (not per transcribe), pass it
      through all three `transcribe()` call sites (App.jsx x2, liveTranscriber).
      DONE: a `useEffect([boostPhrases, status])` lazily loads the BPE encoder
      (via `loadBpeEncoder`, cached per-tokenizer so a model swap rebuilds it)
      and builds the `BoostingTrie` into `phraseBoostRef`; a separate
      `useEffect([boostStrength])` mutates `trie.strength` without re-encoding.
      `phraseBoostRef.current` is passed to both file call sites; the live path
      reads it per tick via `getPhraseBoost`. This also completes the Phase 1
      "gate asset download" item: the asset only fetches once a phrase exists.
- [x] Add i18n strings in `i18n.jsx` for every new label/help text (EN + FR).
      DONE (commit 7d4259d): `settingsGroupBoosting`, `boostPhrases`,
      `boostPhrasesPlaceholder`, `boostStrength`, `boostWeightWarning`,
      `boostPhrasesLoaded`, `tooltipBoost` in both `en` and `fr`.
- [x] Commit (7d4259d i18n, 0bb0b3d live plumbing, 203a39c App UI+wiring).
      `npm run build` passes; the asset is copied to `dist/tokenizer/`.

### Phase 4: Live transcription path
- [x] Confirm boosting works with the streaming/windowed `liveTranscriber.js`
      path. DONE by design: `createLiveTranscriber` takes `getPhraseBoost` and
      passes `getPhraseBoost?.() ?? null` into each tick's `transcribe()`.
      No double-counting / drift: `parakeet.js` calls `phraseBoost.reset()` at
      the start of every `transcribe()`, so the trie's active set resets per
      window; ticks are serialized by the `running` guard and never overlap a
      file transcribe, so the single shared trie instance is never used
      concurrently. (In-browser confirmation belongs to Phase 5 manual verify.)
- [x] Commit (live plumbing landed with Phase 3 as 0bb0b3d).

### Phase 5: Verify, document, screenshot
- [ ] Manual verification: load model, enable a boost phrase that the model
      otherwise mis-transcribes, confirm it now appears. Capture before/after.
      PENDING ON USER: needs a browser + real audio (cannot be done headlessly /
      without a mic). Everything else in Phase 5 is done; this is the last gate
      before the feature is "verified shipped".
- [x] Update `README.md` features table + a short "Phrase Boosting" section.
      DONE (commit 10756d2): Features row + "Phrase Boosting" section (UI usage,
      per-phrase weights, local-only persistence, NeMo PR/issue references,
      greedy best-effort + CJK-token limitation). Mentions Claude Code.
- [x] Refresh README screenshot only if UI visibly changed. DECISION (user,
      2026-06-01): SKIP. The default `image.png` shows the post-load main view;
      the phrase-boosting UI lives inside the settings panel (behind the gear)
      and is not visible in that shot, so the screenshot still matches.
- [x] Bump version: edit `app/package.json` only, in its own commit, after all
      other changes are committed. DONE: 5.4.6 -> 5.5.0 (minor; new feature),
      user-chosen, committed last and alone per CLAUDE.md.
- [x] Remove the "implement phrase boosting" line from `TODO.md`. DONE locally;
      NOTE: `TODO.md` is gitignored, so the removal is a local-only edit and is
      intentionally not committed (nothing to commit for it).

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
- **Q5. Encoder fidelity:** RESOLVED → **ship a real tokenizer-faithful encoder**
  (not the approximate vocab longest-match). VERIFIED the tokenizer is **BPE**
  (13476 ranked merges, byte_fallback, Metaspace), so the encoder is a
  hand-rolled ranked-merge BPE over the upstream `tokenizer.json` merges; there
  is no `.model` and no unigram scores. See §2.3 Q5 and Phase 1.
- **Q6. Boost weights:** RESOLVED → **per-phrase weights** (`phrase:WEIGHT`
  syntax) multiplied by the global strength slider.

## 7. Progress log (append newest at bottom; date + what changed + next step)
- 2026-05-31, Session 1. Researched NeMo PR #14277 (server CUDA GPU-PB) and
  issue #14772; confirmed it can only be ported as a *concept* to this app's
  greedy TDT decoder. Mapped codebase anchor points (decode loop in
  `parakeet.js transcribe()` ~L452-476; missing text→id encoder in
  `tokenizer.js`; three `transcribe()` call sites). Chose greedy shallow-fusion
  boosting-trie design (§3). Wrote this PLAN.md. **Next:** confirm open
  questions in §6 (or accept defaults), then start Phase 1 (vocab subword
  encoder), the riskiest correctness piece.
- 2026-05-31, Session 1 (cont). Resolved all open questions with the user and
  folded the answers into §2/§3/§4/§6: greedy-now-beam-later (Q1), real
  tokenizer-faithful encoder (Q5), per-phrase weights (Q6), Advanced textarea +
  slider (Q2), IndexedDB (Q3), reset-per-window streaming (Q4). **Next:** Phase 1
  step 1, locate and verify the tokenizer for parakeet-tdt-0.6b-v3.
- 2026-06-01, Session 2. IMPORTANT, read before continuing. Two things happened:
  (1) The dev environment corrupted tool output for a long stretch: it FABRICATED
  a result claiming the tokenizer was "Unigram with per-piece scores", and it
  also faked many "commit succeeded" messages. Acting on the fabrication, I
  built a unigram-Viterbi encoder (`app/src/spEncoder.js`), a distilled "scores"
  asset (`app/ui/public/tokenizer/parakeet-tdt-0.6b-v3-unigram.json`), a
  `SOURCE.md`, and `scripts/test-sp-encoder.mjs`. NONE of it was ever committed
  (HEAD never moved off the session-1 plan commits), and all four untracked
  files have since been DELETED. No real repo damage; the wrong work is gone.
  (2) Once output recovered, a clean run VERIFIED the tokenizer is **BPE**
  (`type:"BPE"`, 13476 ranked merges, vocab dict, byte_fallback, Metaspace
  pre-tokenizer, 275 control added_tokens), authoritative `tokenizer.json` living
  at `nvidia/parakeet-tdt-0.6b-v3`. Updated §2.3 Q5 and Phase 1 to the correct
  BPE spec and algorithm (ranked-merge BPE, not Viterbi). LESSON for future
  sessions: trust git state (`git log`) over my own "committed" claims, and gate
  Phase 1 on a real HF-`tokenizers` cross-check, not just round-trip.
  **Next:** Phase 1, confirm vocab set-equality, then distill the `merges` asset
  and implement the BPE encoder with the HF cross-check test.
- 2026-06-01, Session 2 (cont). **Phase 1 COMPLETE.** Verified set-equality (BPE
  vocab ids 0..8191 byte-for-byte match the app's `vocab.txt`; only id 8192
  differs, `<blank>` vs `<blk>`), so the only asset needed is the ranked
  `merges` (no piece->id duplication). Found digits 0-9 are added_tokens
  (extracted pre-BPE) and there are no `<0xHH>` byte tokens (OOV -> fused
  `<unk>`); corrected the plan's `ignore_merges` (false, not true). Built:
  `scripts/distill-bpe-merges.py` -> `app/ui/public/tokenizer/bpe-merges.json`
  (+ SOURCE.md); `app/src/bpeEncoder.js` (hand-rolled faithful BPE, no npm dep);
  `scripts/test-bpe-encoder.mjs` + `scripts/gen-bpe-fixture.py` cross-checking
  against the REAL HuggingFace `tokenizers` lib. **All 57 test phrases match HF
  exactly** (the real gate, since round-trip alone is insufficient). Commits:
  aa4adde (asset), 8b97ae9 (test), 1e22aea (encoder). Environment was reliable
  this session (verified git state matched after each commit). **Next:** Phase 2,
  create `app/src/phraseBoost.js` (`BoostingTrie` per §3) and wire it into
  `parakeet.js transcribe()` behind an optional `opts.phraseBoost`, leaving the
  default no-boost path unchanged.
- 2026-06-01, Session 2 (cont). **Phase 2 COMPLETE.** Built `app/src/phraseBoost.js`
  (`BoostingTrie` + `parseBoostPhrases`, per-phrase weights x linear depth
  scaling x settable global `strength`, pure `applyBoost`/`restore`) and wired it
  into `parakeet.js transcribe()` via `opts.phraseBoost`: reset per call, boost
  logits before the perf-tuned argmax (reused verbatim, no duplication), restore
  right after with `maxLogit` reset to the chosen token's true logit so
  confidence stays the model's, advance on each non-blank emission. No-trie path
  is fully inert. `scripts/test-phrase-boost.mjs` (parse/build/advance/apply +
  argmax-flip-then-restore) all pass; `node --check` clean on all edited files.
  Commits: 62b7522 (module), ba75ae5 (hook), c7be923 (test). **Next:** Phase 3,
  UI textarea + strength slider in a collapsed Advanced area of `App.jsx`, build
  the trie once on phrase change (loading the encoder lazily via
  `loadBpeEncoder`), persist phrases + strength in IndexedDB (`idb.js`), pass the
  trie through all three `transcribe()` call sites (App.jsx x2, liveTranscriber),
  and add EN/FR i18n strings.
- 2026-06-01, Session 2 (cont). **Phase 3 + Phase 4 COMPLETE.** Wired phrase
  boosting end to end through the UI and all decode paths. App.jsx: new
  `boostPhrases` / `boostStrength` state persisted in IndexedDB (defaults `''`
  / `1`); a Phrase-boosting settings group (monospace textarea one-phrase-per-
  line with optional `:WEIGHT`, out-of-range-weight warning, active count, and a
  0..5 step-0.5 strength slider); a `useEffect([boostPhrases, status])` that
  lazily loads the BPE encoder (cached per-tokenizer so a model swap rebuilds
  it) and builds the `BoostingTrie` into `phraseBoostRef`, plus a separate
  `useEffect([boostStrength])` that mutates `trie.strength` without re-encoding.
  The trie is passed to both file `transcribe()` sites and, via `getPhraseBoost`,
  into each live tick. Phase 4 holds by design (per-call `reset()` + serialized
  ticks; no concurrent reuse). i18n EN+FR added. `npm run build` passes; asset
  copied to `dist/tokenizer/`; `node scripts/test-phrase-boost.mjs` still PASS.
  Commits: 7d4259d (i18n), 0bb0b3d (live plumbing), 203a39c (App UI + wiring).
  **Next:** Phase 5, manual in-browser verify (load model, boost a normally
  mis-transcribed phrase, confirm it appears), then update README (features +
  a Phrase Boosting section, mention Claude Code + greedy best-effort limit),
  ask the user before refreshing the screenshot, bump the version
  (`app/package.json` only, separate last commit), and drop the
  "implement phrase boosting" line from TODO.md.
- 2026-06-01, Session 2 (cont). **Phase 5 docs + version DONE; feature code
  COMPLETE.** Updated README (Features row + "Phrase Boosting" section: UI,
  per-phrase weights, local-only persistence, NeMo PR/issue links, greedy
  best-effort + CJK limitation, built with Claude Code; commit 10756d2).
  Removed the "implement phrase boosting" line from TODO.md (local-only edit;
  TODO.md is gitignored so not committed). User chose to SKIP the screenshot
  refresh (boosting UI lives in the settings panel, not in the default shot)
  and a MINOR version bump 5.4.6 -> 5.5.0 (committed last and alone per
  CLAUDE.md). **ONLY REMAINING ITEM:** Phase 5 manual in-browser verification
  (load the model, add a boost phrase the model normally mis-transcribes, set a
  modest strength, confirm the phrase now appears; try strength 0 to confirm it
  reverts). This needs a real browser + audio and is the user's to run. All
  code, tests, docs, and the version bump are committed; the feature is
  implemented and build-verified. If verification surfaces tuning needs (e.g.
  default strength, depth-scaling), adjust `phraseBoost.js` / the slider range.
