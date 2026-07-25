// Constants shared by the HTTP layer and the inference layer.
//
// This module exists so app.mjs never has to import engine.mjs: the HTTP layer
// talks to the engine only through the injected interface, and pulling in
// engine.mjs for one number would drag ONNX Runtime + scripts/transcribe.mjs
// into the tier-2 tests (and into `--help`) for nothing.
//
// Built with Claude Code.

/** Sample rate the whole pipeline is fixed at (the model's mel front-end). */
export const SAMPLE_RATE = 16000;
