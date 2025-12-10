# Parakeet.js (Fork)

> ⚠️ **EXPERIMENTAL WIP** – This is a heavily modified fork, purely vibe-coded. Expect bugs, breaking changes, and rough edges.

Browser-based speech-to-text running entirely client-side using NVIDIA's Parakeet models via WebGPU/WASM.

## Credits

This fork is based on **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – all the heavy lifting and original implementation credit goes there. This would not exist without their excellent work.

## Status

- 🚧 Work in progress
- 🧪 Experimental and unstable
- 📝 Licensed under GPLv3
- 🎨 Vibe-coded with [aider.chat](https://github.com/Aider-AI/aider/)

## Quick Start

```bash
# Run the demo locally with Docker
docker-compose up

# Or run it directly
cd ui
npm install
npm run dev
```

Then visit `http://localhost:5173`

## What It Does

- Runs speech-to-text entirely in your browser (nothing sent to servers)
- Supports WebGPU (fast) and WASM (compatible) backends
- Word-level timestamps and confidence scores
- File upload or microphone recording
- Model quantization options (fp32/int8)

## Usage

See the `ui/` directory for a complete React implementation you can copy/paste.

Basic API:

```js
import { ParakeetModel, getParakeetModel } from 'parakeet.js';

// Download model files (cached in IndexedDB)
const { urls, filenames } = await getParakeetModel('istupakov/parakeet-tdt-0.6b-v3-onnx', {
  backend: 'wasm',      // or 'webgpu'
  encoderQuant: 'int8',
  decoderQuant: 'int8',
});

// Create model instance
const model = await ParakeetModel.fromUrls({ ...urls, filenames, backend: 'wasm' });

// Transcribe 16kHz mono audio
const result = await model.transcribe(pcmFloat32Array, 16000, {
  returnTimestamps: true,
  returnConfidences: true,
});

console.log(result.utterance_text);
console.log(result.words); // [{text, start_time, end_time, confidence}, ...]
```

## License

GPLv3 – See LICENSE file

## Acknowledgments

- **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – Original project this is forked from
- **[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)** – Python reference implementation
- **ONNX Runtime Web** – Makes browser inference possible
