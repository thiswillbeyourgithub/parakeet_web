<p align="center">
  <img src="./icon.svg" alt="Parakeet Web logo" width="128" height="128" />
</p>

# Parakeet Web

**[English](./README.md) | [Français](./README_fr.md)**

> ⚠️ **EXPERIMENTAL WIP** – Made with care but with AI. Expect bugs, breaking changes, and rough edges.

**Try it now at [parakeetweb.olicorne.org](https://parakeetweb.olicorne.org/):** nothing to install, no account to create, no ads, and no personal or cross-site tracking. It runs anywhere Chrome is installed, with all transcription happening locally in your browser.

Made by Olivier Cornelis, psychiatrist and dev / data scientist ([bio](https://olicorne.org)).

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Dictation Mode](#dictation-mode)
- [Speaker Diarization](#speaker-diarization)
- [Dictation Devices (SpeechMike)](#dictation-devices-speechmike)
- [Live Transcription](#live-transcription)
- [Phrase Boosting](#phrase-boosting)
- [Remote Microphone (Phone as Mic)](#remote-microphone-phone-as-mic)
- [Local Model Fallback](#local-model-fallback)
- [Mobile debugging](#mobile-debugging)
- [Architecture](#architecture)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Credits](#credits)

---

Browser-based speech-to-text running entirely client-side using NVIDIA's [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) model (converted to ONNX by [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) and re-quantized for this app as [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)) via WebGPU/WASM.

![](./image.png)

## Features

| Feature | Details |
|---|---|
| 🔒 **100% Private** | Runs entirely in your browser — no audio ever leaves your device |
| ⚡ **WebGPU Accelerated** | Runs on the WASM backend (int8) by default so it works everywhere; opt into WebGPU for faster GPU inference |
| 🎙️ **Phone as Mic** | Use your phone as a wireless microphone via end-to-end encrypted WebRTC |
| ⏱️ **Live Transcription** | Optional streaming mode: text appears as you speak, dictation regex applied in real time |
| 🎯 **Phrase Boosting** | Bias the decoder toward your own list of phrases (names, jargon, drug names, acronyms), with optional per-phrase weights. Runs fully client-side |
| 🔦 **Beam Search** | Optional multi-hypothesis decoding (file transcription) that lets phrase boosting recover words greedy would discard; the default adapts to your device (greedy on phones, up to width 5 on desktops) |
| 📝 **Dictation Mode** | Post-processes transcriptions with regex rules (medical French vocabulary, punctuation, units) |
| 🗣️ **Speaker Diarization** | Optional "who spoke when" view: groups the transcript into colour-coded `Speaker N:` turns, fully client-side via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). The speaker count is detected automatically |
| 🕐 **Word Timestamps** | Per-word timestamps |
| 📁 **File or Mic** | Transcribe uploaded audio files or record directly from your microphone |
| 🎚️ **Capture Controls** | Per-recording toggles for noise suppression, echo cancellation, and auto gain control |
| 🌐 **Bilingual UI** | Interface available in English and French, auto-selected from your browser language (the underlying model itself is multilingual) |
| 📦 **Automatic Quantization** | Encoder precision follows the backend automatically: on WebGPU it uses fp16 (~1.2 GB, near-lossless, and lighter to serve; on a backend without fp16 compute kernels it is upcast to fp32 at identical accuracy), only falling back to a full fp32 encoder (~2.4 GB) when the model repo ships no fp16 file; on WASM it uses a SmoothQuant int8 encoder (smaller, the only one that fits the browser's 32-bit heap / blob-fetch limit, and recalibrated so its accuracy now tracks fp32 even on long audio, unlike a stock int8 cast that degrades badly past ~30 s). The decoder always runs int8 (on this model the int8 joiner is as accurate as fp32, while being smaller and faster). fp16 files are built by the `scripts/quantize-fp16.py` script that ships in the [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx) model repo (see also the [grikdotnet fp16 model card](https://huggingface.co/grikdotnet/parakeet-tdt-0.6b-fp16) documenting the same conversion) |
| 🐳 **Docker Ready** | One-command self-hosted deployment |

> **Planned:** as it matures, I want to eventually add support for [WEBCAT](https://github.com/freedomofpress/webcat/) (Web-based Code Assurance and Transparency) for even stronger security guarantees, so you can cryptographically verify that the code running in your browser is the code that was actually published.

## Quick Start

```bash
# 1. Copy the example env file and edit it with your own values
cp docker/env.example docker/.env

# 2. Run the demo locally with Docker
sudo docker compose -f docker/docker-compose.yml up
```

3. Then visit `http://localhost:5173`

## Dictation Mode

Parakeet Web includes an **experimental dictation mode** that post-processes transcriptions using regex rules to clean up spoken punctuation, medical vocabulary, and unit abbreviations. This is especially useful for French medical dictation.

The regex rules are sourced from the [murmure-regex repository](https://framagit.org/interhop/murmure-regex) by the non-profit [interhop.org](https://interhop.org/), originally created for the [Murmure](https://github.com/Kieirra/murmure) software. A single combined CSV file is automatically downloaded on container startup. I have been investigating contributing to [Murmure](https://github.com/Kieirra/murmure) upstream.

The rules are in French and cover categories like punctuation, unit abbreviations, clinical exam templates, medication name corrections, and medical vocabulary corrections.

This feature is very early and will improve rapidly.

### How it works

- **Docker**: The entrypoint script downloads the single combined `regex.csv` file from the [murmure-regex repository](https://framagit.org/interhop/murmure-regex) on every container start.
- **Frontend**: The app loads the CSV rules at startup via a manifest file and applies them as JavaScript `RegExp` replacements. After regex processing, each line is stripped of leading/trailing whitespace and its first letter is capitalized. Two display modes are available per transcription: **Raw** and **Dictation** (regex-cleaned).
- **Custom regex source**: Set the `DICTATION_REGEX_SOURCE` environment variable to override the default Murmure URL. This can be a GitLab-compatible repo URL (e.g. `https://framagit.org/interhop/murmure-regex`) or a local folder path containing CSV regex files (e.g. `/path/to/my/regex-csvs`). This allows you to iterate on regex rules locally without waiting for upstream changes.

## Speaker Diarization

Parakeet Web can answer **"who spoke when"**: it splits a transcription into per-speaker turns, grouping the words into colour-coded `Speaker 1:`, `Speaker 2:` ... blocks. Everything runs **locally in your browser** — no audio leaves your device, exactly like the transcription itself.

Diarization is fully **opt-in** and never runs unless you ask for it:

- **Per transcription**: a **Speakers** button sits right after the **Dictation** button on each transcription. Click it to diarize that one entry; the view switches to coloured speaker turns. Click **Raw** / **Dictation** to switch back.
- **Automatically for everything**: in the settings sidebar, set the default display mode to **Speakers** (next to **Raw** and **Dictation**). Every new transcription is then diarized automatically, just like the dictation default.

The **number of speakers is detected automatically** by default, so you do not have to specify it. If you do know it, you can set a fixed count:

- a **Number of speakers** control in the settings sidebar sets the default (**Auto**, or 1-10), and
- each transcription's **⋮** menu has its own **Number of speakers** override that **re-segments that recording immediately** when you change it (handy when auto over- or under-splits a particular clip).

**Rename speakers**: click a speaker label (e.g. **Speaker 1**) to edit it inline. The new name replaces that speaker everywhere in the transcript, and **copying** a diarized transcription yields clean `Name: text` blocks ready to paste.

**Reuse names across recordings**: once you have named a speaker, diarizing another recording in the same session automatically reuses that name for the same voice. The app compares a voice embedding of each speaker against the ones you have already named and labels a match for you (you can still rename it). This matching happens entirely in memory for the current session only: the voice embeddings are biometric data, so they are never written to disk and are gone when you reload the page.

**Persistence**: when **Save transcript history locally** is enabled, the speaker turns and your custom names are saved alongside the text, so a diarized transcription comes back in the **Speakers** view (same colours and renamed labels) after a reload. To protect privacy only the grouped turns (`Speaker: text`) and names are stored, never the per-word timings or the raw audio segments.

### How it works

Diarization is powered by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), whose prebuilt WebAssembly speaker-diarization engine is vendored into the app (it bundles its own ONNX Runtime, separate from the transcription engine). It runs a two-model offline pipeline on the same 16 kHz audio already in memory:

1. a [pyannote segmentation](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0) model finds speech regions and speaker-change points, then
2. a [3D-Speaker CAM++](https://huggingface.co/csukuangfj/speaker-embedding-models) speaker-embedding model (~28 MB) embeds each region, and the embeddings are clustered into speakers.

The resulting speaker segments are matched to the existing word timestamps (each word gets the speaker whose segment overlaps it most), and consecutive words from the same speaker are grouped into turns.

- The two models (~34 MB total) are fetched from the same model hub as the ASR model (`VITE_DIARIZATION_*` env vars, with a local `/models` fallback) and cached in IndexedDB. They are prefetched in the background as soon as the ASR model finishes loading, so the first diarization is instant. If that download fails, the **Speakers** button and the **Speakers** default-display option are greyed out and show the reason on hover (instead of an error popup).
- The WebAssembly engine loads lazily the first time you actually diarize, so it costs nothing if you never use the feature.

This feature was wired up with [Claude Code](https://www.anthropic.com/claude-code).

## Dictation Devices (SpeechMike)

Parakeet Web supports physical dictation devices (Philips SpeechMike and similar) via [GoogleChromeLabs/dictation_support](https://github.com/GoogleChromeLabs/dictation_support). The device's RECORD, PLAY/PAUSE and STOP buttons control the in-app recording lifecycle:

- **RECORD**: start a new recording (ignored while already recording; use PLAY to pause/resume instead).
- **PLAY**: pause or resume the current recording.
- **STOP**: stop the recording (or start a new one when idle).

Pair the device once via the **Connect Dictation Device** button in settings; on subsequent visits the page auto-reconnects with no extra click.

> **Browser limitation:** this feature uses the [WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API), which is currently only available in **Chromium-based browsers** (Chrome, Edge, Brave, Opera, Vivaldi, ...). Firefox and Safari do not implement WebHID, so the physical buttons cannot drive the app there. You can still use the device as a regular USB microphone in any browser, but you have to start and stop recording with the on-screen controls. On non-Chromium browsers Parakeet Web tries to detect a plugged-in SpeechMike from the audio-input device list and shows a hint pointing you to a compatible browser.

This integration was wired up with [Claude Code](https://www.anthropic.com/claude-code).

## Live Transcription

By default, transcription runs once when you stop recording. If you'd rather see the text appear as you speak, enable **Live transcription** in the settings panel. The model is then re-run every few seconds on a sliding window of recent audio, and the transcript updates incrementally during the recording. The dictation regex (if loaded) is applied to the entire visible text on every update, so corrections like "point virgule" → ";" happen live too.

This works for both the local microphone and the [phone-as-mic](#remote-microphone-phone-as-mic) path — the live transcriber consumes the same audio buffer either way.

### How it works

Parakeet's encoder is non-streaming (it sees the whole window at once with self-attention), so accuracy depends heavily on having enough acoustic context. The live transcriber maintains a sliding **context window** of the last *N* seconds of audio and re-runs the model on it every few seconds. Words near the trailing edge of the window are "pending" (may be revised by the next, larger-context window) and words past a 3-second commit boundary are frozen for good. The result: every word is eventually transcribed with at least 3 seconds of right-context, while you still see updates as you speak.

When you hit stop, the canonical full-audio transcription pass runs as it always has, and its result replaces the live one — so the live mode never affects the final accuracy.

### Settings

- **Live transcription** (off by default): toggle the streaming mode on or off.
- **Context window**: how many seconds of recent audio the encoder sees on each update.
  - **Auto** (recommended): starts at 15 s and adapts itself between **10 s and 60 s** based on how fast your machine actually transcribes. Faster machines get a larger window (more context, better accuracy); slower machines get a smaller one (so updates can keep up).
  - Or pick a fixed value (10/15/20/30/45/60 s) if you want to override the auto-adapter — for example, choose 60 s on a fast desktop to maximize accuracy, or 10 s on a phone to keep latency low.

The cadence (how often the live transcript updates) is always auto-adapted: if a transcription pass takes longer than expected, updates back off so the queue never grows. Enable **Display more details** in settings to see the current window size, step interval, and per-tick processing time below the live transcript.

This feature was implemented with [Claude Code](https://www.anthropic.com/claude-code).

## Phrase Boosting

Speech models reliably mis-hear words they rarely saw in training: personal names, local place names, drug names, niche jargon, acronyms. **Phrase boosting** lets you give the decoder a short list of words and phrases to favor, so acoustically ambiguous audio resolves toward them instead of a more common look-alike.

Open the settings panel and find the **Phrase boosting** group:

- **Boost phrases**: one phrase per line, with up to three optional colon-separated fields (`phrase:WEIGHT:MINP:AUG`). The full per-line syntax is in the collapsible reference below; the two most common fields are:
  - `phrase:WEIGHT`, e.g. `acetaminophen:2.5`. A positive weight nudges the decoder *toward* the phrase; a **negative** weight pushes it *away* (a penalty), e.g. `um:-3` to suppress a filler word. The valid range is -10 to 10 (nonzero); an out-of-range or zero weight is ignored with an inline warning and treated as 1.
  - `phrase:WEIGHT:MINP`, e.g. `venlafaxine:5:0.1`, sets a per-phrase **min-p gate**: the phrase is only nudged when its token is at least `MINP` times as likely as the model's top candidate for that step. This keeps boosting a ranking nudge rather than a hammer that can hallucinate a phrase the model never considered, and unlike a fixed top-k it adapts to how confident the model is at each step (tight near a confident peak, wider when the model is unsure). Default min-p is 0.05 (at least 5% as likely as the top candidate).
- **Boost strength**: a global multiplier applied on top of every phrase's weight. Ranges from -10 to 10; set it to 0 to disable boosting without clearing your list. A negative strength inverts every phrase at once (boosts become penalties).
- **Augmenting a phrase into extra surface forms**: the decoder matches case-sensitive tokens, so `venlafaxine` alone does not match `Venlafaxine`. Add the `AUG` field (the third colon-separated field, see the reference below) to expand a phrase into Title Case, ALL CAPS, proclitic prefixes (so a vowel-initial term like `amoxicilline` also boosts `l'amoxicilline` / `d'amoxicilline`), and symbol-stripped forms (so `alpha-methyl` also boosts `alpha methyl`), e.g. `amoxicilline:5::faph`. Apply it to every following line at once with a `*:::AUG` defaults line.

Your phrase list and strength are saved locally (IndexedDB) and survive reloads. Like everything else in this app, boosting runs **100% in your browser**: nothing about your phrases is sent anywhere.

**Operator-provided lists (optional, self-hosted):** set the `BOOST_PHRASES_SOURCE` environment variable to a local folder of `.txt` files (one phrase per line, same per-line syntax as the box) or to an https URL pointing at a single `.txt` file. When at least one list is found, a selector appears above the box so users can pick which list to load; choosing one fills the box with that file's contents. The selector always includes a **Custom** entry for typing your own phrases, and that custom text is saved across sessions independently of the loaded files. A served list can ship pre-tuned by carrying its own per-phrase defaults on a `*:WEIGHT:MINP:AUG` line (see the collapsible reference below), and very large lists can be precompiled to `.pwc` files so the container skips re-encoding them on every boot (a server-startup saving, not a visitor-side one; see the collapsible reference below). When the variable is unset, no selector is shown and the box works exactly as described above (manual entry only). The bundled `docker-compose.yml` ships one curated list out of the box: it bind-mounts the repo's `phrase_boosting/` folder (currently a `french_medical` list) at `/boost-defaults` and defaults `BOOST_PHRASES_SOURCE` to it, so the selector is populated without any extra setup. Set `BOOST_PHRASES_SOURCE=` (empty) in your `.env` to ship no lists.

**Pre-selecting a default list:** set `VITE_PHRASE_BOOST_DEFAULT` to one of the served list names (a bare name like `medical` or `medical.txt`) to have it pre-selected for first-time visitors. The container refuses to start if the name does not match a list it is serving, so an operator typo can never silently fall back to manual entry. You can also pre-select a list per-link with the `?phrase_boost=<name>` query parameter (e.g. `https://your-host/?phrase_boost=medical`), which is handy for sharing a ready-to-use link. Neither the env default nor the URL parameter overrides a returning user's own saved selection; they only seed the default when the visitor has no saved choice yet. The bundled `docker-compose.yml` defaults this to `french_medical` (the shipped list); set `VITE_PHRASE_BOOST_DEFAULT=` (empty) in your `.env` to pre-select nothing.

<details>
<summary><strong>Full per-line syntax, how boosting works, and precompiled lists</strong></summary>

#### Per-line syntax

Each line is `phrase` followed by up to three optional colon-separated fields, `phrase:WEIGHT:MINP:AUG`:

- `WEIGHT` (default 1): the boost weight, -10 to 10 (nonzero). Positive nudges *toward* the phrase, negative *away* (a penalty). Out-of-range or zero is ignored with an inline warning and treated as 1.
- `MINP` (default 0.05): the per-phrase min-p gate, a number in (0, 1]; the phrase is only nudged when its token is at least `MINP` times as likely as the model's top candidate for that step. Unlike a fixed top-k rank, this adapts to the model's per-step confidence.
- `AUG` (default none): augment this phrase into extra surface forms. Any mix of `f` (Title Case), `a` (ALL CAPS), `p` (proclitic prefixes, e.g. `l'`/`d'` glued to a vowel-initial term), and `h` (strip symbols/separators, so `alpha-methyl` also boosts `alpha methyl`; covers `, . ' " - _ ? !` and friends). Two shorthands: `s` forces none (as-typed only) and `i` is all of them. Omit to leave the phrase as-typed, or set a list-wide default with a `*:::AUG` line (see below).

Leave an earlier field empty to keep its default while setting a later one, e.g. `venlafaxine::0.1` keeps weight 1 but sets min-p 0.1, and `amoxicilline:5::faph` sets all three.

A list can ship pre-tuned with a `*:WEIGHT:MINP:AUG` defaults line: it sets the default weight, min-p and augmentation for every line that follows it (until the next `*` line changes them), using the exact same fields as a phrase. So `*:2` makes the rest of the list weight 2, `*:::faph` augments the rest, and `*:1.5:0.1:fhp` sets all three; each empty field leaves that default unchanged, and a per-phrase field still overrides the `*` default. A `*` weight is a per-phrase *default*, not the global multiplier: the strength slider still scales everything (your typed phrases and the list) on top of it, so a list's `*:2` and a slider at 1.5 give an effective weight of 3. A list can also override the proclitic prefixes used by the `p` augmentation with a `#!prefixes a' b' ...` line (whitespace-separated); the default is the French elision set (`l'`, `d'`, `L'`, `D'`). A prefix ending in an apostrophe only attaches before a vowel (so `l'amoxicilline` but never `l'beta`); any other prefix (e.g. Arabic `al-`) attaches unconditionally.

#### How it works

This is a browser port of the *concept* behind NVIDIA NeMo's [GPU-Accelerated Phrase-Boosting](https://github.com/NVIDIA-NeMo/NeMo/pull/14277) (see also issue [#14772](https://github.com/NVIDIA-NeMo/NeMo/issues/14772)). Each phrase is tokenized with a faithful reimplementation of the model's BPE tokenizer and inserted into a token-level **boosting trie**. During decoding, before each token is chosen, the trie adds an additive reward (shallow fusion) in **logit space** to the tokens that would start or continue one of your phrases, with deeper matches rewarded a little more to encourage finishing a phrase once it starts. Adding to a logit is the principled log-domain nudge: it multiplies that token's probability before the softmax renormalizes, rather than crudely scaling the final probability. A **min-p gate** keeps the reward honest: a token is only boosted when its probability is at least a fixed fraction of the model's top candidate for that step (default 0.05, i.e. 5%, configurable per phrase), so a strong weight nudges the ranking without forcing a word the model never considered. This is the min-p rule from LLM sampling: it adapts to the per-step distribution (tight near a confident peak, wider when the model is unsure), where a fixed top-k rank would admit junk on confident steps and miss a plausible rare term on uncertain ones. A negative weight applies the same reward with the opposite sign, penalizing the phrase instead.

At beam width 1 this app decodes **greedily** (one best token per step), so boosting is best-effort: it biases each step toward your phrases, but it cannot recover a phrase the greedy decoder already discarded on an earlier frame. Raising the **Beam Width** setting (file transcription only; see below) lets the decoder keep several competing hypotheses, so a boosted phrase can survive in a lower-ranked beam until the audio confirms it, which is exactly the case greedy cannot recover. Beam search costs roughly Nx the decode time for width N, so the default stays modest and adapts to your device (greedy on phones, 2 on low-memory computers, 5 on a typical desktop). Boost strength helps too, but very large values can distort otherwise-correct text, so start small and increase only as needed. Accented Latin text and ligatures (e.g. `isotrétinoïne`, `sœur`) are fully supported. Scripts the tokenizer has no tokens for (e.g. Chinese/Japanese/Korean) collapse to a single unknown token and cannot be boosted; such phrases are automatically skipped and listed in an inline warning rather than silently ignored. This is a tokenizer limitation, not a bug.

#### Precompiled lists (`.pwc`, self-hosted only)

When `LOCAL_MODEL_PATH` is set, the container encodes each operator-provided list to token ids at boot and serves the result (a sibling `.json`) so visitors' browsers skip that work. Visitors are already fast either way; what is not free is that boot encode itself, which reruns on **every** container start and is slow for a very large (10k-100k phrase) list. Precompiling spares the **server** that repeated startup work (it does not change visitor speed). Compile the list once:

```bash
node scripts/compile-boost.mjs my-list.txt --model-dir /path/to/model
```

(use the same model folder you mount at `LOCAL_MODEL_PATH`) and drop the resulting `my-list.pwc` next to `my-list.txt` in your `BOOST_PHRASES_SOURCE` folder. The `.pwc` is a gzip-compressed file (it is only ever read back by the container, never fetched by a browser, so it ships smaller). The container then reuses the `.pwc`'s token ids at boot instead of re-encoding, cutting container startup time, as long as its vocab signature matches the model. If the model (hence vocab) differs, the stale `.pwc` is silently ignored and the `.txt` is re-encoded, so a mismatched `.pwc` is never wrong, only skipped. `.pwc` reuse is local-folder only (the single-URL form always re-encodes).

</details>

This feature was implemented with [Claude Code](https://www.anthropic.com/claude-code).

## Remote Microphone (Phone as Mic)

**No microphone? No problem!** Use your phone as a wireless mic via WebRTC. Audio is end-to-end encrypted (ECDH P-256 + AES-GCM-256) — the server only relays encrypted data and never sees the plaintext audio.

1. Click the **Phone Mic** button in the app
2. A QR code appears — scan it with your phone
3. Grant microphone permission on the phone
4. **Verify the short code** that appears on both screens matches — read it aloud or compare visually. If the codes differ, click **Codes differ – abort** on either device. This step defends against a malicious signaling server that could otherwise swap encryption keys to MITM the supposedly end-to-end channel. The Confirm button is disabled for 3 seconds (with a visible countdown) so a reflexive Enter/Space press cannot auto-accept a tampered code without you actually reading it.
5. Speak — encrypted audio streams to the computer in real time
6. Click **Stop** on either device — the audio is transcribed normally

### Send a saved audio file from the phone

Once paired, the phone page also offers **📁 Send an audio file**. Pick any
audio file on the phone (mp3, m4a, wav, ...) and it is decoded to PCM **on the
phone**, then streamed through the exact same end-to-end encrypted tunnel the
live mic uses. The computer chunks, resamples and transcribes it identically
to a recording, including resumable long-audio chunking — there is no separate
upload path and the relay still only ever sees ciphertext. A progress bar
shows the (faster-than-real-time) transfer, which you can cancel. Very long
files are truncated on the phone with a warning (the session limit is roughly
60 minutes of 16 kHz audio). The phone never resamples: it sends the decoded
PCM and the desktop downsamples it, exactly like a live phone mic, so the
decode path stays robust across browsers including iOS Safari. This is handy
when the file lives on your phone but you want it transcribed on the desktop.
Built with the help of Claude Code.

### Reconnecting after a drop

Phone connections drop (the screen locks, you switch apps, the Wi-Fi flaps).
When that happens the desktop **keeps the same QR code on screen and waits**
for the phone to come back, rather than forcing you to start over. Two layers
of recovery cover it:

- **Automatic reconnect.** The phone remembers the pairing and silently
  re-joins the same room with a short exponential backoff. A brief flap usually
  recovers on its own with no interaction.
- **In-page camera re-scan.** If auto-reconnect can't recover (too many
  failures, or the phone page was reloaded and lost the link), tap **📷 Scan QR
  code** on the phone. The rear camera opens right in the page and you scan the
  QR still shown on the computer to re-pair — no need to leave the page or open
  a separate barcode app. (Re-pairing always runs a fresh short-code
  verification, so the end-to-end guarantee is unchanged.)

If you ever want a brand-new pairing instead, click **Generate new QR** on the
computer. Rooms live for about 10 minutes, after which you'll need a new QR.
Built with the help of Claude Code.

### Requirements

- **Local network only**: works out of the box with no extra config (STUN-only / direct P2P).
- **Over the internet**: requires a [coturn](https://github.com/coturn/coturn) TURN relay. A commented-out coturn service is included in `docker/docker-compose.yml` — uncomment it and set `TURN_SERVER`, `TURN_SECRET`, and `TURN_EXTERNAL_IP` in `docker/.env`. If you already run coturn (e.g. for [WebSend](https://github.com/nicMusic/websend) or Nextcloud Talk), point to it and reuse the same `TURN_SECRET`.
- **Restrictive networks (last resort)**: when both direct WebRTC and TURN/TURNS are blocked (some corporate proxies strip UDP and the TURNS CONNECT upgrade), the signaling sidecar can forward the encrypted audio frames itself, over WebSocket (preferred) or HTTP long-poll. After the SDP exchange the client races WebRTC and the relay in parallel for ~10 s: WebRTC wins if it gets through, otherwise the relay takes over and the peer connection is torn down. Audio stays AES-256-GCM end-to-end, so the relay only ever sees ciphertext (it is purely a transport fallback). Enabled by default; toggle with `RELAY_ENABLE` (server) and `VITE_RELAY_ENABLE` (client).

See `docker/env.example` for all configuration options.


## Local Model Fallback

If HuggingFace is blocked or unreachable in your environment, you can serve
model weights directly from the container. Pick any host folder, populate
it with the ONNX files, bind-mount it into the container, and set
`LOCAL_MODEL_PATH` to the matching in-container path:

```bash
# 1. Populate any host folder with the ONNX files (flat layout):
hf download Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx \
    --local-dir /host/path/to/onnx-files
```

```yaml
# 2. In docker/docker-compose.yml, add a volume:
volumes:
  - /host/path/to/onnx-files:/models:ro
```

```bash
# 3. In docker/.env, set:
LOCAL_MODEL_PATH=/models
```

Caddy serves whatever is at `LOCAL_MODEL_PATH` under `/models/`. The
container crashes at startup if `vocab.txt` is missing, so
misconfigurations are caught early.

Use `VITE_MODEL_SOURCE` to choose where the UI fetches weights from:

- `hf` (default): HuggingFace only.
- `local`: instance-served `/models/` only, HuggingFace is never contacted.
- `both`: HuggingFace first, silent fallback to `/models/` if HF is
  unreachable.

When `LOCAL_MODEL_PATH` is set and `VITE_MODEL_SOURCE` is left unset, it
is auto-promoted to `both`.

The container runs as UID 1000. If your files end up unreadable to UID
1000, run `chmod -R a+rX /host/path/to/onnx-files` (or
`chown -R 1000:1000 /host/path/to/onnx-files`).

Built with [Claude Code](https://claude.com/claude-code).

## Mobile debugging

Append `?debug=1` to any URL to load the in-page [eruda](https://github.com/liriliri/eruda)
devtools — useful for inspecting console logs and network requests on a phone
where you cannot open desktop devtools. Eruda is vendored locally (served
from same-origin with SRI), so nothing is fetched from a CDN at runtime.

Examples:

- Main app: `https://your-host/?debug=1`
- Remote-mic page: `https://your-host/remote-mic.html?debug=1#ROOMID:SECRET`
  (the room info is in the hash fragment, so `?debug=1` goes before the `#`)

Without `?debug=1`, no devtools surface is shipped to the user.

## Architecture

For a file-by-file map of the codebase (the inference engine, the UI, the
signaling server, Docker packaging and the test suite) see
[ARCHITECTURE.md](./ARCHITECTURE.md).

## License

The application code is licensed under **AGPLv3** (see the LICENSE file).

Some bundled phrase-boosting lists include bacterial names derived from LPSN (List of Prokaryotic names with Standing in Nomenclature), which is licensed **CC BY-SA 4.0**, not AGPLv3: the `lorn` (List of Recommended Names for bacteria of medical importance) list, and the bacterial names merged into the `french_medical` list. See [ATTRIBUTION.md](./ATTRIBUTION.md) for details and the required attribution.

## Acknowledgments

- **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – Original project this is forked from
- **[LPSN (List of Prokaryotic names with Standing in Nomenclature)](https://lpsn.dsmz.de/)** – Source of the bacterial names in the `lorn` (List of Recommended Names for bacteria of medical importance) and `french_medical` boost lists, used under CC BY-SA 4.0 (see [ATTRIBUTION.md](./ATTRIBUTION.md))
- **[nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** – The underlying ASR model by NVIDIA
- **[istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)** – ONNX conversion of the model
  - This was essential in allowing me to come up with my own improved quantization, available at [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)
- **[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)** – Python reference implementation
- **ONNX Runtime Web** – Makes browser inference possible
- **[sherpa-onnx (k2-fsa)](https://github.com/k2-fsa/sherpa-onnx)** – Prebuilt WebAssembly speaker-diarization engine (Apache-2.0)
- **[pyannote segmentation 3.0](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0)** – Speech segmentation model used for diarization (MIT)
- **[3D-Speaker CAM++](https://huggingface.co/csukuangfj/speaker-embedding-models)** – Speaker-embedding model used for diarization (Apache-2.0)

## Credits

This fork is based on **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – all the heavy lifting and original implementation credit goes there. This would not exist without their excellent work.

