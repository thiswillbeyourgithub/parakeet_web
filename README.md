# Parakeet Web

> ⚠️ **EXPERIMENTAL WIP** – Made with care but with AI. Expect bugs, breaking changes, and rough edges.

**Try it now: [pw.olicorne.org](https://pw.olicorne.org/)** — no installation required.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Dictation Mode](#dictation-mode)
- [Local Model Fallback](#local-model-fallback)
- [Remote Microphone (Phone as Mic)](#remote-microphone-phone-as-mic--beta)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

Browser-based speech-to-text running entirely client-side using NVIDIA's [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) model (converted to ONNX format by [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)) via WebGPU/WASM.

![](./image.png)

## Features

| Feature | Details |
|---|---|
| 🔒 **100% Private** | Runs entirely in your browser — no audio ever leaves your device |
| ⚡ **WebGPU Accelerated** | Fast GPU inference with automatic WASM fallback for compatibility |
| 🎙️ **Phone as Mic** | Use your phone as a wireless microphone via end-to-end encrypted WebRTC |
| 📝 **Dictation Mode** | Post-processes transcriptions with regex rules (medical French vocabulary, punctuation, units) |
| 🕐 **Word Timestamps** | Per-word timestamps and confidence score heatmap |
| 📁 **File or Mic** | Transcribe uploaded audio files or record directly from your microphone |
| 📦 **Quantization** | Choose between fp32 (accurate) and int8 (faster/smaller) model variants |
| 📲 **PWA** | Installable as a Progressive Web App for an app-like experience |
| 🐳 **Docker Ready** | One-command self-hosted deployment |



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

The regex rules are sourced from the [murmure-regex repository](https://framagit.org/interhop/murmure-regex) by the non-profit [interhop.org](https://interhop.org/), originally created for the [Murmure](https://github.com/Kieirra/murmure) software. A single combined CSV file is automatically downloaded on container startup.

The rules are in French and cover categories like punctuation, unit abbreviations, clinical exam templates, medication name corrections, and medical vocabulary corrections.

This feature is very early and will improve rapidly.

### How it works

- **Docker**: The entrypoint script downloads the single combined `regex.csv` file from the [murmure-regex repository](https://framagit.org/interhop/murmure-regex) on first startup.
- **Local development**: Run `./scripts/download-dictation-regex.sh` to fetch the rules into `app/ui/public/dictation-regex/`.
- **Frontend**: The app loads the CSV rules at startup via a manifest file and applies them as JavaScript `RegExp` replacements. After regex processing, each line is stripped of leading/trailing whitespace and its first letter is capitalized. Three display modes are available per transcription: **Raw**, **Confidence** (heatmap), and **Dictation** (regex-cleaned).
- **Custom regex source**: Set the `DICTATION_REGEX_SOURCE` environment variable to override the default Murmure URL. This can be a GitLab-compatible repo URL (e.g. `https://framagit.org/interhop/murmure-regex`) or a local folder path containing CSV regex files (e.g. `/path/to/my/regex-csvs`). This allows you to iterate on regex rules locally without waiting for upstream changes.

## Remote Microphone (Phone as Mic) — Beta

No local microphone? Use your phone as a wireless mic via WebRTC. Audio is end-to-end encrypted (ECDH P-256 + AES-GCM-256) — the server only relays encrypted data and never sees the plaintext audio.

1. Click the **Phone Mic** button in the app
2. A QR code appears — scan it with your phone
3. Grant microphone permission on the phone
4. Speak — encrypted audio streams to the computer in real time
5. Click **Stop** on either device — the audio is transcribed normally


## Local Model Fallback

If HuggingFace is blocked or unreachable in your environment, you can serve model weights directly from the container:

```bash
# 1. Install the HuggingFace CLI and download the model files locally
pip install huggingface-hub
hf download istupakov/parakeet-tdt-0.6b-v3-onnx --local-dir ./fallback_models/istupakov__parakeet-tdt-0.6b-v3-onnx

# 2. In docker/docker-compose.yml, uncomment the volume bind:
#   - ./fallback_models/istupakov__parakeet-tdt-0.6b-v3-onnx:/app/ui/public/models/istupakov/parakeet-tdt-0.6b-v3-onnx:ro

# 3. In docker/.env, enable the fallback:
VITE_LOCAL_MODEL_FALLBACK=true
```

The downloaded files are git-ignored. When `VITE_LOCAL_MODEL_FALLBACK=true` is set, the app will check for the local model files on startup and refuse to load if they are missing.

### Requirements

- **Local network only**: works out of the box with no extra config (STUN-only / direct P2P).
- **Over the internet**: requires a [coturn](https://github.com/coturn/coturn) TURN relay. A commented-out coturn service is included in `docker/docker-compose.yml` — uncomment it and set `TURN_SERVER`, `TURN_SECRET`, and `TURN_EXTERNAL_IP` in `docker/.env`. If you already run coturn (e.g. for [WebSend](https://github.com/nicMusic/websend) or Nextcloud Talk), point to it and reuse the same `TURN_SECRET`.

See `docker/env.example` for all configuration options.

Built with [Claude Code](https://claude.com/claude-code).

## License

AGPLv3 – See LICENSE file

## Acknowledgments

- **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – Original project this is forked from
- **[nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** – The underlying ASR model by NVIDIA
- **[istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)** – ONNX conversion of the model
- **[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)** – Python reference implementation
- **ONNX Runtime Web** – Makes browser inference possible

## Credits

This fork is based on **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – all the heavy lifting and original implementation credit goes there. This would not exist without their excellent work.

