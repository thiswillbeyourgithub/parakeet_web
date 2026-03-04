# ParakeetWeb

> ⚠️ **EXPERIMENTAL WIP** – This is a heavily modified fork, purely vibe-coded. Expect bugs, breaking changes, and rough edges.

Browser-based speech-to-text running entirely client-side using NVIDIA's [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) model (converted to ONNX format by [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)) via WebGPU/WASM.

![](./image.png)

## What It Does

- Runs speech-to-text entirely in your browser (nothing sent to servers)
- Supports WebGPU (fast) and WASM (compatible) backends
- Word-level timestamps and confidence scores
- File upload or microphone recording
- Model quantization options (fp32/int8)
- Installable as a PWA (Progressive Web App) for app-like experience

## Status

- 🚧 Work in progress
- 🧪 Experimental and unstable
- 📝 Licensed under AGPLv3
- 🎨 Vibe-coded with [aider.chat](https://github.com/Aider-AI/aider/) and [Claude Code](https://claude.com/claude-code)

## Live Demo

A running instance is available at **https://pw.olicorne.org/** (no installation required).

## Quick Start

```bash
# 1.Modify .env.example into .env to set your own values
# 2.Run the demo locally with Docker
sudo docker compose up
```

3. Then visit `http://localhost:5173`

## Local Model Fallback

If HuggingFace is blocked or unreachable in your environment, you can serve model weights directly from the container:

```bash
# 1. Install the HuggingFace CLI and download the model files locally
pip install huggingface-hub
hf download istupakov/parakeet-tdt-0.6b-v3-onnx --local-dir ./fallback_models/istupakov__parakeet-tdt-0.6b-v3-onnx

# 2. In docker-compose.yml, uncomment the volume bind:
#   - ./fallback_models/istupakov__parakeet-tdt-0.6b-v3-onnx:/app/ui/public/models/istupakov/parakeet-tdt-0.6b-v3-onnx:ro

# 3. In your .env, enable the fallback:
VITE_LOCAL_MODEL_FALLBACK=true
```

The downloaded files are git-ignored. When `VITE_LOCAL_MODEL_FALLBACK=true` is set, the app will check for the local model files on startup and refuse to load if they are missing.

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

