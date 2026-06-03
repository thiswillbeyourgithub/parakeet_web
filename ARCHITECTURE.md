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
| `remote-mic-entry.jsx` | React root + UI for the phone page: captures mic audio, encrypts it, and streams PCM to the desktop over WebRTC (with pause/resume, multi-recording, wake-lock). |
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
| `asset-integrity.js` | Verify-then-load for loose runtime assets that bypass the HTML SRI chain (today: the PCM worklet). Hashes bytes against the build-time pin before `AudioWorklet.addModule`. |
| `remote-crypto.js` | The E2E crypto for the remote mic: ECDH (P-256) key exchange -> HKDF -> AES-GCM, all via Web Crypto. |
| `remote-webrtc.js` | `RemoteMicRTC`: WebRTC peer-connection lifecycle, signaling, and the data channel that carries encrypted PCM. Includes the HTTPS-relay fallback for UDP-blocked networks. |
| `remote-relay-transport.js` | The two HTTPS relay transports (WebSocket + long-poll) used as last resort when WebRTC cannot connect. Same ciphertext frames, same interface as the data channel. |
| `remote-mic-handshake.js` | Shared handshake logic used by both desktop and phone, so both sides hash the public keys in the same byte order for the fingerprint compare. |

### Public / static assets (`app/ui/public/`)

| File | Role |
|---|---|
| `favicon.svg` | Favicon. |
| `pcm-recorder-worklet.js` | AudioWorklet processor that captures raw PCM (bypassing MediaRecorder's Opus priming delay). Integrity-checked at load by `asset-integrity.js`. |
| `js/eruda-loader.js` | Opt-in (`?debug=1`) loader for the vendored eruda mobile devtools; externalised so the CSP can stay strict. |
| `js/eruda.min.js` | Vendored eruda devtools bundle. |
| `js/qrcode.min.js` | Vendored QR-code generator (renders the phone-pairing QR). |
| `tokenizer/bpe-merges.json` | Distilled BPE merges + added-token list for the phrase-boost encoder (loaded lazily only when boosting is on). |
| `tokenizer/SOURCE.md` | Provenance + refresh recipe for that asset. |
| `ort/*` | Mirror of the ONNX Runtime Web WASM/MJS runtime files, served same-origin and integrity-verified via the manifest. |

### Vendored dependencies (`app/ui/vendor/`)

Locally vendored npm packages, served same-origin instead of from a CDN. Each
has a `SOURCE.md` recording the pinned version and tarball hash. Refreshed via
`scripts/update-vendored.sh` (except `dictation_support`, which is upstream
git-only). Not documented file-by-file here:

- `preact/` — the UI framework (with the `compat` React shim).
- `onnxruntime-web/` — the ONNX Runtime Web distribution (the inference runtime).
- `dictation_support/` — SpeechMike / dictation-device support (GoogleChromeLabs/dictation_support).

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
| `transcribe.mjs` | CLI transcription harness: runs the real engine modules under Node (ORT WASM) to reproduce the browser transcript from the terminal. Also produces the E2E golden transcript. |
| `compile-boost.mjs` | Compiles a boost `.txt` into a `.pwc` artifact so the container skips re-encoding on boot (operator-run counterpart of `prebuild-boost.mjs`). |
| `distill-bpe-merges.py` | Distills the small `bpe-merges.json` asset from the upstream `tokenizer.json`. |
| `gen-bpe-fixture.py` | Emits the BPE cross-check fixture (ground-truth ids from real HuggingFace `tokenizers`) consumed by the unit tests. |
| `gen-fleurs-fixtures.mjs` | One-time local tool that builds the FLEURS regression fixtures (`test/fixtures/fleurs/`): samples en+fr validation clips, transcodes them to mp3, transcribes each with the int8 pipeline (reusing `transcribe.mjs`), keeps the ones the model reproduces well, stitches them into one long clip, and writes `manifest.json` with both the human reference and the model golden. |
| `fetch-e2e-models.mjs` | Downloads just the int8 model files the tier-3 E2E needs into the E2E model dir (skips files already present). |
| `download-dictation-regex.sh` | Fetches dictation regex CSVs from Murmure for non-Docker local dev. |
| `update-vendored.sh` | Refreshes the npm-vendored deps (version query, download, SHA verify, rewrite `SOURCE.md`). Run only on explicit request. |
| `update-caddy.sh` | Refreshes the pinned Caddy base-image digest in the Dockerfile. |

---

## `test/` — three-tier test suite

Tier 1 (unit) and tier 2 (http) run on pre-push and in CI; tier 3 (E2E) is the
slow, model-loading tier run separately.

| Path | Role |
|---|---|
| `test/unit/*.test.mjs` | **Tier 1**, pure-logic unit tests (no model download): `beam-decode`, `bpe-encoder`, `format`, `mel`, `phrase-boost`, `remote-crypto`, `tokenizer`. |
| `test/http/*.test.mjs` | **Tier 2**, integration tests against the **real** signaling server spawned on a random port: `config`, `origin`, `rate-limit`, `rooms`, `validation`. |
| `test/http/helpers.mjs` | Spawn/teardown helper for the signaling server, shared by the tier-2 tests. |
| `test/e2e/transcription.spec.js` | **Tier 3** Playwright happy-path: loads the WASM int8 model in real headless Chromium and transcribes each clip in a fixture list (French `sample.aac` + English `jfk.mp3`) end to end against its golden. |
| `test/e2e/chunking.spec.js` | **Tier 3** long-audio path: seeds a 5 s chunk window and feeds the ~11 s `jfk.mp3` so `transcribeChunked` splits into several chunks, asserting chunking engaged and the stitched transcript recovers the golden content. |
| `test/e2e/seed.mjs` | Shared `seedSettings(page, extra)` helper: writes the app's settings IndexedDB so a spec boots with a known config (local WASM model source + spec-specific keys). |
| `test/e2e/text-overlap.mjs` | Shared `words()` / `overlap()` transcript-comparison helpers used by the transcription + chunking specs. |
| `test/e2e/serve.mjs` | Static server for the E2E (serves the built UI + weights with the cross-origin-isolation headers ORT needs). |
| `test/e2e/playwright.config.js` | Playwright config that boots `serve.mjs`. |
| `test/support/bpe-fixture.mjs` | Loader for the BPE cross-check fixture. |
| `test/support/load-browser-module.mjs` | Helper to unit-test browser files that attach to a bare `window` (evaluated in a `vm` context). |
| `test/fixtures/` | Committed test inputs/goldens: `bpe-fixture.json`, `sample.aac` + `sample.expected.txt` (French clinical clip), `jfk.mp3` + `jfk.expected.txt` (public-domain JFK English clip). Audio goldens are produced by `scripts/transcribe.mjs` against the int8 weights. |

---

## CI / git hooks

| File | Role |
|---|---|
| `.githooks/pre-push` | Runs the fast tiers (unit + http) before every push; tier 3 is skipped. Activated by the root `package.json` `prepare` script. |
| `.github/workflows/test.yml` | PR CI gate: mirrors the pre-push fast tiers and adds tier-3 E2E as a separate job. |
