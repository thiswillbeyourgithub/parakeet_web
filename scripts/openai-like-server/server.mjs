#!/usr/bin/env node
// OpenAI/whisper-compatible HTTP API in front of the parakeet_web ONNX pipeline.
//
//   node scripts/openai-like-server/server.mjs --model-dir ./fallback_models
//   curl -F file=@clip.mp3 -F response_format=srt http://127.0.0.1:8002/v1/audio/transcriptions
//
// This file is only the boot sequence: resolve options (CLI > env > default),
// build the engine, start listening, shut down cleanly. Everything else lives in
// lib/ -- routing in app.mjs, inference glue in engine.mjs, and the option table
// itself in options.mjs (which also generates --help).
//
// The transcript is produced by the SAME code path as `node
// scripts/transcribe.mjs`: engine.mjs imports that script's own exported helpers
// rather than reimplementing model loading, phrase boosting or ffmpeg decoding.
//
// See README.md in this folder for the full API, the docker-compose deployment
// and the whisper-compatibility table.
//
// Built with Claude Code.

import { resolveOptions, renderHelp, isLoopbackHost } from './lib/options.mjs';
import { createEngine } from './lib/engine.mjs';
import { createApiServer } from './lib/app.mjs';

async function main() {
  let options;
  let warnings;
  try {
    const resolved = resolveOptions(process.argv.slice(2), process.env);
    if (resolved.help) {
      console.log(renderHelp());
      process.exit(0);
    }
    ({ options, warnings } = resolved);
  } catch (err) {
    // Configuration errors are the operator's to fix, so print the message
    // (which names the flag and the fix) without a stack trace.
    console.error(`[parakeet-api] fatal: ${err.message}`);
    process.exit(2);
  }

  for (const w of warnings) console.error(`[parakeet-api] warning: ${w}`);

  console.error(`[parakeet-api] loading model from ${options.modelDir} `
    + `(enc ${options.quant} / dec ${options.decoderQuant}, ort=${options.ort})...`);
  let engine;
  try {
    engine = await createEngine(options);
  } catch (err) {
    console.error(`[parakeet-api] fatal: ${err.message}`);
    process.exit(3);
  }

  const info = engine.info();
  console.error(`[parakeet-api] model ready in ${(info.loadMs / 1000).toFixed(1)}s: ${info.modelId}`);
  console.error(`[parakeet-api] ffmpeg: ${info.ffmpeg}`);
  console.error(`[parakeet-api] wordlists: ${info.wordlists.length ? info.wordlists.join(', ') : '(none)'}`
    + `${options.wordlist ? ` (default: ${options.wordlist})` : ''}`);
  console.error(`[parakeet-api] diarization: ${info.diarization.available
    ? `available${options.diarize ? ', on by default' : ' (pass diarize=true)'}`
    : `unavailable -- ${info.diarization.reason}`}`);

  const { server, routes, close } = createApiServer({ engine, options });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[parakeet-api] fatal: ${options.host}:${options.port} is already in use `
        + '(another instance? change --port / PARAKEET_PORT)');
      process.exit(4);
    }
    console.error(`[parakeet-api] fatal: server error: ${err.message}`);
    process.exit(5);
  });

  server.listen(options.port, options.host, () => {
    console.error(`[parakeet-api] listening on http://${options.host}:${options.port}`);
    for (const [name, path] of Object.entries(routes)) {
      if (path) console.error(`[parakeet-api]   ${name.padEnd(15)} ${path}`);
    }
    // Spell out the keyless contract: clients that cannot be configured without
    // an api_key (most OpenAI SDKs insist on one) can send any placeholder and
    // it is accepted, because there is no secret to compare it against.
    console.error(`[parakeet-api] auth: ${options.apiKey
      ? 'Bearer token required'
      : 'NONE (any key a client sends is accepted and ignored)'}`);
    console.error(`[parakeet-api] limits: ${options.maxUploadMb} MiB upload, `
      + `${options.maxQueue} queued, ${options.requestTimeoutSec}s timeout`);
    if (!options.apiKey) {
      // Two very different risk levels, so say which one this is rather than
      // printing one vague note for both.
      console.error(isLoopbackHost(options.host)
        ? '[parakeet-api] note: no API key set; safe only because the bind address is loopback.'
        : `[parakeet-api] WARNING: no API key AND bound to ${options.host} `
          + '(--allow-keyless-non-loopback). Anything that can reach this port can transcribe. '
          + 'This is only acceptable while something outside the process limits reachability '
          + '(e.g. compose publishing it to 127.0.0.1).');
    }
  });

  // Graceful shutdown: stop accepting, let the in-flight job finish (an ORT run
  // is not interruptible anyway), then release the model and the temp dir.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      if (closing) return;                       // a second Ctrl-C should not race the first
      closing = true;
      console.error(`[parakeet-api] ${signal}: shutting down...`);
      const hard = setTimeout(() => {
        console.error('[parakeet-api] shutdown timed out; exiting anyway');
        process.exit(0);
      }, 15_000);
      hard.unref();
      try { await close(); } catch { /* already down */ }
      try { await engine.dispose(); } catch { /* already down */ }
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(`[parakeet-api] fatal: ${err?.stack || err}`);
  process.exit(1);
});
