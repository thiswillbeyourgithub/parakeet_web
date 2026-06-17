# Architecture

This document is a file-by-file map of the repository: what each file is, what
it does, and how the pieces fit together. It was written with the help of Claude
Code.

Parakeet Web is a browser speech-to-text app. NVIDIA's Parakeet TDT model (in
ONNX form) runs entirely client-side via ONNX Runtime Web (WebGPU, with a WASM
fallback). The repository is four layers:

1. **`app/src/`** — the forked, framework-agnostic inference engine
   (`parakeet.js`): model loading, mel front-end, decoding, phrase boosting.
2. **`app/ui/`** — the Preact/React single-page UI that drives the engine, plus
   the "phone as mic" remote feature and its end-to-end crypto.
3. **`signaling/`** — a small Express server that brokers the WebRTC handshake
   for the remote microphone (it never sees plaintext audio).
4. **`docker/`, `scripts/`, `test/`, CI** — packaging, operator tooling, and the
   three-tier test suite.

A high-level data flow for a single transcription:

```
audio (file or mic/phone)
  -> PCM 16 kHz  (audio.js / pcm-recorder-worklet.js / remote-webrtc.js)
  -> log-mel spectrogram  (mel.js, or preprocessor.js ONNX variant)
  -> encoder ONNX session  (parakeet.js + backend.js + ONNX Runtime Web)
  -> TDT greedy / beam decode, with optional phrase boosting  (parakeet.js + phraseBoost.js)
  -> token ids -> text  (tokenizer.js)
  -> dictation regex post-processing  (App.jsx)
  -> rendered transcript with word timestamps
```

---

## Top-level

| Path | What it is |
|---|---|
| `README.md` | User-facing overview: features, quick start, per-feature docs. |
| `README_fr.md` | French translation of `README.md`, kept in lockstep with it (each links to the other; the About modal points here when the UI language is French). |
| `ARCHITECTURE.md` | This file. |
| `CLAUDE.md` | Instructions for Claude Code / contributors (version bump, screenshot, vendored-dep and Caddy refresh procedures). |
| `LICENSE` | AGPLv3 for the combined work. |
| `package.json` / `package-lock.json` | Root **dev/test harness** package (not published). Defines the `test:unit` / `test:http` / `test:e2e` scripts and the `prepare` hook that installs the git hooks path. |
| `.npmignore` | Files excluded when the inference engine is packed for npm. |
| `.dockerignore` | Build-context filter so host `node_modules/`, dev TLS keys and `.env` secrets never enter the Docker image. |
| `.gitignore` | Standard ignores. |
| `icon.svg` | App logo (used in README and as a source for the favicon). |
| `image.png` | README screenshot, refreshed via shot-scraper (see `CLAUDE.md`). |

---

## `app/src/` — the inference engine (forked `parakeet.js`)

This folder is a long-diverged fork of [ysdede/parakeet.js](https://github.com/ysdede/parakeet.js).
It is first-party source maintained in-tree, **not** a clean vendor; see
`app/src/SOURCE.md` for the fork point and the manual upstream-sync runbook.
Imports resolve through the Vite alias `parakeet.js -> app/src/index.js`.

| File | Role |
|---|---|
| `index.js` | Public entry point of the engine. Re-exports `ParakeetModel`, the hub loaders, and the `fromUrls` / `fromHub` convenience factories. |
| `parakeet.js` | The heart of the engine (~1.3k lines). `ParakeetModel`: holds the encoder + decoder/joiner ONNX sessions, runs the combined TDT step, and implements both decode paths — greedy (beam width 1) and MAES beam search — plus word-timestamp/confidence extraction and the stateful-streaming hooks used by live transcription. |
| `backend.js` | ONNX Runtime Web initialisation. Picks the WebGPU or WASM backend and **integrity-verifies** each ORT WASM/MJS runtime asset against `/ort/manifest.json` before handing the bytes to ORT (defence against a tampered serving path swapping in a malicious ML runtime). Falls back with a loud warning when the manifest or WebCrypto is unavailable. |
| `models.js` | Central model registry: per-variant metadata (vocab size, mel bins, prediction-network shape, supported languages) plus `LANGUAGE_NAMES`. Adding a model version is a one-object change. |
| `hub.js` | HuggingFace Hub download + browser caching (IndexedDB). Supports a local-base-URL fallback for when HF is firewalled; `HubDownloadError` lets the UI distinguish "HF blocked" from other failures and offer the local model. |
| `idb.js` | Tiny shared IndexedDB helper (memoised `open`), used by both the model cache and the UI settings store. |
| `tokenizer.js` | `vocab.txt` parsing and **decode** (id -> text): SentencePiece `▁`->space, blank/`<unk>` skipping, punctuation cleanup. `parseVocabText` is shared with the server-side boost prebuild. |
| `mel.js` | Pure-JS log-mel spectrogram (~845 lines) matching the NeMo/onnx-asr preprocessor exactly, with an incremental/streaming API. Ported from upstream after the fork point. |
| `preprocessor.js` | `OnnxPreprocessor`: the alternative ONNX-model-based mel front-end (vs. the pure-JS `mel.js`). De-duplicates concurrent session creation. |
| `bpeEncoder.js` | BPE **encode** (text -> token ids), the reverse of `tokenizer.js`. Reimplements the upstream HuggingFace `tokenizers` BPE pipeline closely enough to match token ids for realistic boost phrases. Needed only by phrase boosting. |
| `phraseBoost.js` | Phrase boosting / context biasing: a token-level trie that injects an additive logit-space reward to bias decoding toward (or away from) user phrases. Drives both the greedy and MAES-beam decode paths in `parakeet.js`. |
| `boostCompile.js` | Shared "compile" pipeline that turns a boost-phrase `.txt` into the serialized token-id artifact (the expensive BPE encode done once). Single source of truth for both the container prebuild and the operator CLI compiler. Node-only. |
| `SOURCE.md` | Provenance: fork point, divergence notes, and the manual upstream-sync procedure. |
| `LICENSE.upstream` | The upstream MIT license that still covers the forked portions. |

---

## `app/ui/` — the web application

A Vite-built Preact app (using the React-compat layer). It has two HTML entry
points: the main app and the remote-microphone phone page.

### Build / entry / config

| File | Role |
|---|---|
| `index.html` | Main app HTML entry. |
| `remote-mic.html` | Separate HTML entry for the phone "remote mic" page. |
| `vite.config.js` | Vite build config: the `parakeet.js` alias to `app/src`, the two entry points, optional local HTTPS, and the COOP/COEP setup. |
| `postbuild.mjs` | Post-build SRI injector: adds `integrity=` to the content-hashed `<script>`/`<link>` refs in `dist/*.html`, and emits the asset-integrity / ORT manifests that `backend.js` and `asset-integrity.js` verify against at runtime. |
| `package.json` / `package-lock.json` | UI dependencies and build scripts. |

### Source (`app/ui/src/`)

| File | Role |
|---|---|
| `main.jsx` | React root bootstrap for the main app. Installs a global error/rejection banner so nothing fails silently in production. |
| `App.jsx` | The application (~4.8k lines): all UI state and orchestration — model load, file/mic/phone recording, decode options (beam, boosting), dictation-regex post-processing, word-timestamp rendering, settings persistence, and wiring of every `lib/` helper. |
| `App.css` | Styles for the app. |
| `config.js` | Build-time/runtime config indirection. Reads `window.__CONFIG__` (written by the Docker entrypoint) or falls back to Vite `import.meta.env`. Every operator-settable `VITE_*` key must be listed here. |
| `i18n.jsx` | Translation tables + `I18nProvider` / `useI18n` / `LanguageSwitcher`. |
| `remote-mic-entry.jsx` | React root + UI for the phone page: captures mic audio (or decodes a saved audio file on the phone), encrypts it, and streams PCM to the desktop over WebRTC (with pause/resume, multi-recording, wake-lock). The "Send an audio file" action decodes + downmixes the file to mono locally (no phone-side resample, for iOS robustness; the desktop resamples) and pumps it through the same `audio-config`->Int16-chunks->`audio-end` framing as the live mic, paced via `RemoteMicRTC.drain()`. |
| `phraseBoost.worker.js` | Module worker that moves the CPU-heavy BPE encode of a boost list off the main thread so the UI does not freeze on large clinical lists. |

### Reusable components (`app/ui/src/components/`)

| File | Role |
|---|---|
| `Banner.jsx` | Tone-styled banner (`info`/`danger`/...). |
| `Button.jsx` | Variant-styled button. |
| `Card.jsx` | Tone-styled card container. |
| `Modal.jsx` | Modal primitive + a module-level "any modal open" counter (`useAnyModalOpen`) that disables background controls to thwart keystroke-injection attacks. |
| `VerificationModal.jsx` | Blocking fingerprint-compare modal for the remote-mic handshake — the human MITM check on the swapped-key attack. Non-selectable code + confirm delay. |

### Library helpers (`app/ui/src/lib/`)

| File | Role |
|---|---|
| `audio.js` | Shared audio helpers: PCM resample to 16 kHz and an RMS level monitor, used by both local and remote recording. |
| `format.js` | Pure display formatters (`formatTime`, `formatDuration`, `formatBytes`). |
| `keepalive.js` | Ref-counted keepalive: screen Wake Lock + a silent looping audio element to dodge background-tab throttling during long inference. |
| `liveTranscriber.js` | Streaming transcriber: runs the model over a sliding PCM window, emits committed vs. pending words with absolute timestamps, and adapts step/window size to bound latency. |
| `asset-integrity.js` | Verify-then-load for loose runtime assets that bypass the HTML SRI chain (the PCM worklet, the sherpa-onnx diarization glue/wrapper/wasm). Hashes bytes against the build-time pin before `AudioWorklet.addModule` (`verifiedAddModule`) or returns the verified bytes/blob (`fetchVerifiedAsset`). |
| `diarizer.js` | Lazy singleton loader + runner for the vendored sherpa-onnx WebAssembly speaker-diarization engine. Verifies and injects the emscripten glue (classic blob-URL `<script>`), feeds it the `.wasm` bytes and the two model buffers via `FS_createDataFile`, caches the engine handle keyed by model identity, and exposes `runDiarization(pcm16k, opts)` returning speaker segments. |
| `diarizationModels.js` | Downloads the two diarization models (pyannote segmentation + CAM++ embedding) through the same hub as the ASR model (HF first, local `/models` fallback, IndexedDB-cached, memoised). Exports `getDiarizationModels()` and `diarizationModelProtectKeys()` (the cache keys the orphan sweep must keep). Repo/file defaults come from the `VITE_DIARIZATION_*` config. |
| `speakerAssign.js` | Pure helpers mapping diarization output onto the transcript: `assignSpeakersToWords` (each word gets the max-overlap speaker, gaps go to the nearest), `groupWordsIntoTurns` (consecutive same-speaker words -> `Speaker N` turns), `speakerCount`, and `turnsToLabeledText` (turns -> `Name: text` blocks for copy/export, via a `nameFor(speaker)` resolver so renamed speakers come through). Unit-tested in `test/unit/speaker-assign.test.mjs`. |
| `remote-crypto.js` | The E2E crypto for the remote mic: ECDH (P-256) key exchange -> HKDF -> AES-GCM, all via Web Crypto. |
| `remote-webrtc.js` | `RemoteMicRTC`: WebRTC peer-connection lifecycle, signaling, and the data channel that carries encrypted PCM. Includes the HTTPS-relay fallback for UDP-blocked networks. |
| `remote-relay-transport.js` | The two HTTPS relay transports (WebSocket + long-poll) used as last resort when WebRTC cannot connect. Same ciphertext frames, same interface as the data channel. Each exposes a `drain()` (buffered-amount / queue-depth) so the saved-file pump can pace itself to the link. |
| `remote-mic-handshake.js` | Shared handshake logic used by both desktop and phone, so both sides hash the public keys in the same byte order for the fingerprint compare. |
| `remote-mic-link.js` | Pure parser/validator for a scanned remote-mic QR payload (`parseRemoteMicLink`). Accepts only a same-origin `/remote-mic.html#roomId:secret` link, the trust boundary for the in-page camera re-scan. Unit-tested in `test/unit/remote-mic-link.test.mjs`. |
| `persistStorage.js` | Asks the browser to promote this origin's IndexedDB to the "persistent" bucket so Chromium does not evict the multi-GB model cache under disk pressure (which looked like "the version bump wiped my model"). Idempotent, called on every load. |

### Public / static assets (`app/ui/public/`)

| File | Role |
|---|---|
| `favicon.svg` | Favicon. |
| `pcm-recorder-worklet.js` | AudioWorklet processor that captures raw PCM (bypassing MediaRecorder's Opus priming delay). Integrity-checked at load by `asset-integrity.js`. |
| `js/eruda-loader.js` | Opt-in (`?debug=1`) loader for the vendored eruda mobile devtools; externalised so the CSP can stay strict. |
| `js/eruda.min.js` | Vendored eruda devtools bundle. |
| `js/qrcode.min.js` | Vendored QR-code generator (renders the phone-pairing QR). |
| `js/jsqr.min.js` | Vendored QR-code scanner (jsQR 1.4.0, Apache-2.0). Loaded lazily behind an SRI pin by the phone page's in-page camera re-scan, so a dropped phone can re-pair by scanning the desktop's QR without leaving the page. |
| `tokenizer/bpe-merges.json` | Distilled BPE merges + added-token list for the phrase-boost encoder (loaded lazily only when boosting is on). |
| `tokenizer/SOURCE.md` | Provenance + refresh recipe for that asset. |
| `ort/*` | Mirror of the ONNX Runtime Web WASM/MJS runtime files, served same-origin and integrity-verified via the manifest. |
| `sherpa-onnx/sherpa-onnx-wasm-main-speaker-diarization.wasm` | The sherpa-onnx diarization engine's WebAssembly binary (bundles its own ONNX Runtime). Loaded and integrity-verified by `diarizer.js`. |
| `sherpa-onnx/sherpa-onnx-wasm-main-speaker-diarization.js` | Emscripten glue for that wasm, with the baked-in `.data` model loader stripped out (the app loads its own models instead). Injected as a classic blob-URL script. |
| `sherpa-onnx/sherpa-onnx-speaker-diarization.js` | sherpa-onnx's small JS API wrapper (verbatim upstream), defines `OfflineSpeakerDiarization` / `createOfflineSpeakerDiarization` over the emscripten module. |

### Vendored dependencies (`app/ui/vendor/`)

Locally vendored npm packages, served same-origin instead of from a CDN. Each
has a `SOURCE.md` recording the pinned version and tarball hash. Refreshed via
`scripts/update-vendored.sh` (except `dictation_support`, which is upstream
git-only). Not documented file-by-file here:

- `preact/` — the UI framework (with the `compat` React shim).
- `onnxruntime-web/` — the ONNX Runtime Web distribution (the inference runtime).
- `dictation_support/` — SpeechMike / dictation-device support (GoogleChromeLabs/dictation_support).
- `sherpa-onnx-diarization/` — provenance only (`SOURCE.md` + `LICENSE`) for the prebuilt sherpa-onnx speaker-diarization WASM artifacts; the runtime files themselves live under `public/sherpa-onnx/` (above) because they are integrity-pinned and served same-origin. Not refreshed by `update-vendored.sh`; refresh procedure is in its `SOURCE.md`.

---

## `signaling/` — WebRTC signaling server

| File | Role |
|---|---|
| `server.js` | Express server (~1.3k lines): room management, SDP offer/answer relay, ICE trickle, and time-limited TURN credential generation. Brokers the handshake only; it never sees plaintext audio (everything is E2E-encrypted by `remote-crypto.js`). Runs as a sidecar inside the Docker image. |
| `package.json` / `package-lock.json` | Server dependencies (Express). |

---

## `docker/` — self-hosted deployment

| File | Role |
|---|---|
| `Dockerfile` | Multi-stage build (Node builder -> Caddy runtime). Base images pinned to immutable digests; optional `npm audit` build gate. |
| `Caddyfile` | Production reverse proxy: serves the built bundle, sets the COOP/COEP/security headers, and proxies `/api/signal/*` to the Node sidecar. |
| `docker-compose.yml` | One-command deployment; wires env vars and the bind-mounted fallback-model folder. |
| `entrypoint.sh` | Container boot: verifies the fallback model, populates dictation regex, generates `config.js` (runtime `VITE_*` -> `window.__CONFIG__`), runs the boost prebuild, starts the signaling sidecar, then execs Caddy. |
| `prebuild-boost.mjs` | Boot-time phrase-boost prebuild: when the operator ships boost lists and the vocab is on disk, encodes each list to token ids once (via `app/src/boostCompile.js`) so visitors' browsers skip the BPE work. |
| `env.example` | Documented template for `docker/.env` (all operator-settable knobs). |

---

## `scripts/` — operator and maintainer tooling

| File | Role |
|---|---|
| `transcribe.mjs` | CLI transcription harness: runs the real engine modules under Node (ORT WASM) to reproduce the browser transcript from the terminal. Also produces the E2E golden transcript. `--quant` sets the encoder quant; `--decoder-quant` (default fp32) picks the fused decoder_joint quant independently, so the heavy encoder can stay int8 while the small decoder runs full precision. |
| `compile-boost.mjs` | Compiles a boost `.txt` into a `.pwc` artifact so the container skips re-encoding on boot (operator-run counterpart of `prebuild-boost.mjs`). |
| `distill-bpe-merges.py` | Distills the small `bpe-merges.json` asset from the upstream `tokenizer.json`. |
| `gen-bpe-fixture.py` | Emits the BPE cross-check fixture (ground-truth ids from real HuggingFace `tokenizers`) consumed by the unit tests. |
| `gen-fleurs-fixtures.mjs` | One-time local tool that builds the FLEURS regression fixtures (`test/fixtures/fleurs/`): samples en+fr validation clips, transcodes them to mp3, transcribes each with the int8 pipeline (reusing `transcribe.mjs`), keeps the ones the model reproduces well, stitches them into one long clip, and writes `manifest.json` with both the human reference and the model golden. `--decoder-quant` (default fp32) sets the decoder_joint quant; warns when it is not int8, since the e2e app decodes int8. |
| `gen-jfk-moon-fixtures.mjs` | One-time local tool that builds the long-audio chunking fixture: downloads the public-domain JFK "We choose to go to the Moon" speech (Internet Archive) into the gitignored cache, crops the first 3 min to `test/fixtures/jfk-moon-3min.mp3`, and transcribes it with the int8 pipeline for the golden. `--decoder-quant` (default fp32) sets the decoder_joint quant; warns when it is not int8, since the e2e app decodes int8. Exports the download/transcode helpers (and a full-speech clip in the cache) reused by `webgpu-check.mjs`. |
| `wer-bench.mjs` | WER bench that drives the repo's OWN JS pipeline (`transcribe.mjs` + the chunked TDT decode) to A/B encoder quantisations across chunk windows. Built to confirm fp16 holds long chunks where the stock int8 dropped content; runs on native onnxruntime-node (`--ort node`) so fp16/fp32 load. The `--configs` quant is the encoder quant; `--decoder-quant` (default fp32) sets the fused decoder_joint quant for every config. Appends each run to `bench_wer.md`. |
| `wer-quants.py` | Small Python WER+timing+RAM bench across int8/fp16/fp32, built on the UPSTREAM `onnx-asr` library (the lib this app is a port of) rather than the JS pipeline. Self-contained `uv run` script. Used to validate the SmoothQuant int8 encoder. `--quants` sweeps the encoder quant; `--decoder-quant` (default fp32) holds the fused decoder_joint at a fixed precision by swapping only its `InferenceSession` (resolved via onnx-asr's own resolver, so no second encoder loads and the RAM figure stays honest); the oracle reference stays matched at `--reference-quant`. `--audio` takes a single file OR a folder (e.g. the model repo's `calibration_audio/` speeches): a folder is analysed file-by-file and capped by a final cross-file overall-WER summary. Runs on CPU by default; `--cuda` re-launches once under `onnxruntime-gpu` via uv (with the local CUDA-12/cuDNN-9 wheel libs on `LD_LIBRARY_PATH`) to run on an NVIDIA GPU. **`--manifest` mode:** instead of the long-pass/oracle analysis, score whole FLEURS-style validation splits (`<lang>/validation.json` + `wavs_validation/`) against their HUMAN labels as one corpus WER per quant; references/hypotheses are normalised (case+punctuation folded, accents kept; `--no-normalize` for raw WER). `--manifest` is REPEATABLE: pass it once per language and every language is scored in a SINGLE model load (a tqdm bar per language on stderr). Each language emits a `__WER_JSON__` line tagged with `--run-label` so a driver can build a model x language matrix. (The gitignored `parakeet-tdt-0.6b-v3-smoothquant-onnx/wer-fleurs-validation.sh` driver evaluates a roster of models -- istupakov fp32/int8, this repo's int8, and the `models_in_testing/` candidates -- each loaded once over all languages, with a pre-flight that skips unloadable model dirs, and prints the matrix + per-model MICRO/MACRO.) |
| `test_wer-quants.py` | Self-contained `uv run` unit tests (T1-T8) for the model-free helpers of `wer-quants.py`'s `--manifest` mode: `normalize_for_wer` (case/punctuation folding, accents kept), `load_manifest` (basename wav resolution, missing/limit/blank-line handling, explicit audio dir), and `corpus_wer` (aggregate not per-clip mean, empty-reference drop, normalise toggle). No model/onnxruntime needed; `main()` runs every test sequentially. |
| `grid_search_benchmark.mjs` | Grid-search WER bench over NeMo jsonl manifest(s): reuses the production decode + phrase-boost trie unchanged and sweeps encoder-quant x decoder-quant x beam-width x boost-strength (`--quant int8,fp16,fp32` benchmarks each encoder quant, the outer dimension, with its own model load + encoder cache), printing WER/Levenshtein per combination. `--decoder-quants int8,fp16,fp32` (default fp32) sweeps the fused decoder_joint quant independently of the encoder quant, nested under each encoder quant so the cached encoder output is reused across the decoder sweep (no re-encode); the accuracy table gains a `dec` column. Sorts by CER by default; multi-dataset overall is size-weighted (micro-average). |
| `webgpu-check.mjs` | **Manual** WebGPU harness (NOT a test tier, run by hand on a GPU box), the WebGPU analog of the wasm long-audio-chunking e2e. Reuses `serve.mjs` + `seed.mjs` to load the fp16 model on `webgpu-hybrid`. Default (`npm run webgpu:check`) runs the 3 min crop and asserts chunking + content overlap vs the golden; `--full` (`npm run webgpu:memcheck`) runs the FULL ~17 min speech and watches JS heap (via CDP) for a leak. Fails on OOM/crash, silent WASM fallback, content miss, or unbounded heap growth; SKIPs (exit 2) when no real WebGPU GPU is present (rejects software/SwiftShader adapters). |
| `fetch-e2e-models.mjs` | Downloads the model files the tier-3 E2E needs into the E2E model dir (skips files already present): the int8 ASR weights plus the two speaker-diarization models (pyannote segmentation + CAM++ embedding) that `transcription-diarization.spec.js` needs. |
| `run_all_tests.sh` | Convenience runner for the full three-tier suite: rebuilds `app/ui/dist` (the e2e tier tests the built app, so a stale dist would test an old UI), then runs tier 1 (unit) -> tier 2 (http) -> tier 3 (e2e), fail-fast. `--no-build` / `--no-e2e` flags. Excludes the GPU/WebGPU diagnostics and WER benches by design. |
| `download-dictation-regex.sh` | Fetches dictation regex CSVs from Murmure for non-Docker local dev. |
| `update-vendored.sh` | Refreshes the npm-vendored deps (version query, download, SHA verify, rewrite `SOURCE.md`). Run only on explicit request. |
| `update-caddy.sh` | Refreshes the pinned Caddy base-image digest in the Dockerfile. |

---

## `test/` — three-tier test suite

Tier 1 (unit) and tier 2 (http) run on pre-push and in CI; tier 3 (E2E) is the
slow, model-loading tier run separately.

| Path | Role |
|---|---|
| `test/unit/*.test.mjs` | **Tier 1**, pure-logic unit tests (no model download). Decode/front-end: `beam-decode`, `bpe-encoder`, `chunk-default`, `chunk-stitch`, `mel`, `phrase-boost`, `tokenizer`, `boost-compile`, `boost-spec-file`. Hub/cache/quant selection: `resolve-quant`, `get-parakeet-model-files`, `list-local-repo-files`, `resolve-local-model-base`, `hub-cache-validate`, `should-retry-locally`, `model-corruption-recovery`, `sweep-orphans` (cache-GC orphan selection, incl. the protected-key carve-out that keeps diarization models across loads), `stream-to-memory` (fp32 shard byte-assembly), `external-data`, `resolve-files` (per-quant encoder/decoder/vocab resolution, incl. the int8 SmoothQuant encoder-name fallback and the independent `decoderQuant` so an int8 encoder can pair with an fp32 decoder). Diarization: `speaker-assign` (word -> speaker max-overlap mapping + turn grouping). Bench/misc: `grid-search-datasets`, `grid-search-eta`, `ort-runtime-config` (the `--ort` backend -> executionProviders/from-path mapping, incl. the opt-in `cuda` GPU backend), `persist-storage`, `format`, `remote-crypto`, `remote-relay-drain` (transport backpressure drain for the saved-file pump), `caddy-permissions-policy` (asserts the production Caddy `Permissions-Policy` grants `camera=(self)` for the remote-mic QR re-scan and pins the self-allowlist). |
| `test/http/*.test.mjs` | **Tier 2**, integration tests against the **real** signaling server spawned on a random port: `config`, `origin`, `rate-limit`, `rooms`, `validation`. |
| `test/http/helpers.mjs` | Spawn/teardown helper for the signaling server, shared by the tier-2 tests. |
| `test/e2e/transcription.spec.js` | **Tier 3** Playwright happy-path: loads the WASM int8 model in real headless Chromium and transcribes each clip in a fixture list (French `sample.aac` + English `jfk.mp3`) end to end against its golden. |
| `test/e2e/transcription-diarization.spec.js` | **Tier 3** in-browser proof that the vendored sherpa-onnx WASM speaker-diarization engine loads and runs: transcribes the two-speaker fixture (`two-speakers.wav`: JFK + a FLEURS English clip, loudness-normalised lossless PCM so both speakers transcribe), clicks the per-entry Speakers button, and asserts >= 2 colour-coded speaker turns (first != last speaker, non-empty text) plus a Raw <-> Speakers toggle that reuses the cached result. Then exercises the interactive controls: renaming a speaker inline (label button -> text input) and forcing a speaker count from the entry kebab (re-segments, here collapsing to one turn). Self-skips when the two diarization models are not served (HEAD-probe); `npm run e2e:models` fetches them. |
| `test/e2e/chunking.spec.js` | **Tier 3** long-audio path: seeds a 5 s chunk window and feeds the ~11 s `jfk.mp3` so `transcribeChunked` splits into several chunks, asserting chunking engaged and the stitched transcript recovers the golden content. |
| `test/e2e/fleurs-regression.spec.js` | **Tier 3** multilingual regression: loads the model ONCE and loops the 10 en + 10 fr FLEURS clips through the file input, asserting each transcript against both the committed int8 golden and the FLEURS human reference (word-overlap). |
| `test/e2e/long-audio-chunking.spec.js` | **Tier 3** realistic long-audio path: feeds the committed 3 min JFK "moon speech" crop (`jfk-moon-3min.mp3`, one continuous speech, so seams land mid-sentence) at a seeded 20 s chunk window (the default is now a single 60 s for every backend, so it seeds a small window to get ~a dozen chunks); asserts chunking engaged, content recovered, and no runaway seam duplication. (Replaced the stitched-FLEURS clip, now used only by `scripts/wer-bench.mjs`.) |
| `test/e2e/transcription-fp32-wasm.spec.js` | **Tier 3** in-browser proof that the **sharded** fp32 encoder loads and transcribes on WASM in real headless Chromium (the single 2.4 GB sidecar can't; the `scripts/shard-fp32.py` pieces each < 2 GB can). Gated behind the `allowWasmFp32` opt-in; SELF-SKIPS when the local `sharded/` shards are absent (upstream ships none). |
| `test/e2e/transcription-fp32-wasm-autoupgrade.spec.js` | **Tier 3** proof of the local auto-upgrade: user picks WASM fp32, the HF repo ships no shards, so `hub.js` (given `localUpgradeBaseUrl='/models'`) probes the local mirror, finds the shards, and switches the whole load to local. Routes the HF listing to the shard-less istupakov set; needs the local shards (else skips). |
| `test/e2e/transcription-fp32-wasm-no-downgrade.spec.js` | **Tier 3** negative counterpart: when NEITHER source can serve fp32, `hub.js` throws `QuantUnavailableError` instead of silently falling back to int8, and the UI shows a banner + Failed status. 404s the local shard probes; needs no weights, so never skips. |
| `test/e2e/controls-gated-on-model.spec.js` | **Tier 3** (model-free) gate check: record / upload / remote-mic controls stay hidden until the model is fully loaded. Holds every HF request open so the app parks in `loadingModel`, the exact window the gate must cover. |
| `test/e2e/remote-mic-button-creates-room.spec.js` | **Tier 3** regression: clicking "Phone Mic" must MINT a new room (createRoom path), not the re-arm path. Guards the `onClick={() => startRemoteMic()}` wiring (forwarding the click event as `existingRoom` made the first click POST `/rooms/undefined/rearm` -> 401 -> "Phone disconnected"). Fakes `/api/signal/*` to reach the QR/"waiting" state and asserts no `/rearm` or `/undefined/` request. |
| `test/e2e/keyboard-shortcuts-opt-in.spec.js` | **Tier 3** (model-free): global single-letter shortcuts (R/S/F/Space/Enter) are opt-in and OFF by default; exercises the 'S' settings-toggle before and after opting in. |
| `test/e2e/settings-watchdog.spec.js` | **Tier 3** (model-free): startup must not hang when the settings IndexedDB never opens (a blocking `versionchange` in another tab). Stubs `indexedDB.open` to never settle and asserts the restore watchdog boots on defaults. |
| `test/e2e/boost-default-source.spec.js` | **Tier 3** (model-free): a curated phrase-boost list can be pre-selected via `?phrase_boost=<name>` or the operator default, but NEITHER overrides a returning user's saved choice. |
| `test/e2e/boost-rebuild-on-status.spec.js` | **Tier 3** regression: the phrase-boost trie rebuilds once per real model change, NOT on every `status` transition (which used to refreeze the UI on large curated lists). Counts `[Boost] rebuilding trie` logs across a full transcription. |
| `test/e2e/boost-unk-preview-before-model.spec.js` | **Tier 3** (model-free) regression: the "untokenizable terms" warning for a curated list appears as soon as the list loads (from the prebuilt artifact's `skipped`), not only after a model is loaded. |
| `test/e2e/seed.mjs` | Shared `seedSettings(page, extra)` helper: writes the app's settings IndexedDB so a spec boots with a known config (local WASM model source + spec-specific keys). |
| `test/e2e/text-overlap.mjs` | Shared transcript-comparison helpers (`words()`, `overlap()`, and order/count-sensitive `wer()`) used by the transcription + chunking specs and the WER benches. |
| `test/e2e/serve.mjs` | Static server for the E2E (serves the built UI + weights with the cross-origin-isolation headers ORT needs). |
| `test/e2e/playwright.config.js` | Playwright config that boots `serve.mjs`. |
| `test/support/bpe-fixture.mjs` | Loader for the BPE cross-check fixture. |
| `test/support/load-browser-module.mjs` | Helper to unit-test browser files that attach to a bare `window` (evaluated in a `vm` context). |
| `test/fixtures/` | Committed test inputs/goldens: `bpe-fixture.json`, `sample.aac` + `sample.expected.txt` (French clinical clip), `jfk.mp3` + `jfk.expected.txt` (public-domain JFK English clip), `jfk-moon-3min.mp3` + `jfk-moon-3min.expected.txt` (+ `.meta.json` provenance) for the long-audio chunking e2e, built by `scripts/gen-jfk-moon-fixtures.mjs`. Audio goldens are produced by the int8 weights via `scripts/transcribe.mjs`. |
| `test/fixtures/fleurs/` | FLEURS regression set built by `scripts/gen-fleurs-fixtures.mjs`: 10 en + 10 fr validation clips (mp3) + a stitched long clip, with `manifest.json` carrying each clip's human reference and int8 golden. |

---

## CI / git hooks

| File | Role |
|---|---|
| `.githooks/pre-push` | Runs the fast tiers (unit + http) before every push; tier 3 is skipped. Activated by the root `package.json` `prepare` script. |
| `.github/workflows/test.yml` | PR CI gate: mirrors the pre-push fast tiers and adds tier-3 E2E as a separate job. |
