// Tier-1 tests for the OpenAI-like server's option resolution
// (scripts/openai-like-server/lib/options.mjs).
//
// Two jobs here. The first is ordinary parser coverage: precedence, ranges,
// negatable booleans, and the guards that must fail CLOSED (a typo'd flag, an
// authless public bind, fp16 on a backend that cannot load it).
//
// The second is the ENV-VAR PLUMBING check, which is why this file matters beyond
// its assertions: an env var only works if it is read by the code AND passed into
// the container AND documented. This repo has repeatedly shipped vars that were
// read but never plumbed, so the test walks the option table and fails unless
// every row's env var appears in BOTH docker-compose.yml and env.example. Adding
// a knob without documenting it is therefore a test failure, not a discovery six
// months later.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  OPTIONS, resolveOptions, renderHelp, isLoopbackHost, coerceValue,
  REQUEST_OVERRIDES, DEFAULT_PORT,
} from '../../scripts/openai-like-server/lib/options.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, '../../scripts/openai-like-server');
const read = (name) => readFileSync(resolve(SERVER_DIR, name), 'utf8');

// Minimum viable argv: a model directory is mandatory.
const BASE = ['--model-dir', '/models'];

test('defaults: port 8002, loopback, wasm/int8, no auth', () => {
  const { options } = resolveOptions(BASE, {});
  assert.equal(options.port, DEFAULT_PORT);
  assert.equal(options.port, 8002);
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.ort, 'wasm');
  assert.equal(options.quant, 'int8');
  assert.equal(options.apiKey, '');
  assert.equal(options.modelId, 'parakeet-tdt-0.6b-v3-int8', 'model id derives from model+quant');
});

test('precedence: CLI beats env, env beats default', () => {
  const fromEnv = resolveOptions(BASE, { PARAKEET_PORT: '9001' }).options;
  assert.equal(fromEnv.port, 9001);
  const fromCli = resolveOptions([...BASE, '--port', '9002'], { PARAKEET_PORT: '9001' }).options;
  assert.equal(fromCli.port, 9002);
  // An empty env var must not shadow the default (compose passes VAR=${VAR:-}).
  const empty = resolveOptions(BASE, { PARAKEET_PORT: '' }).options;
  assert.equal(empty.port, 8002);
});

test('--flag=value and --flag value are equivalent', () => {
  assert.equal(resolveOptions([...BASE, '--port=9003'], {}).options.port, 9003);
  assert.equal(resolveOptions([...BASE, '--port', '9003'], {}).options.port, 9003);
});

test('model dir accepts the whisper-style -m alias', () => {
  assert.equal(resolveOptions(['-m', '/weights'], {}).options.modelDir, '/weights');
});

test('booleans: bare flag, negation, explicit value', () => {
  assert.equal(resolveOptions(BASE, {}).options.chunking, true, 'chunking on by default');
  assert.equal(resolveOptions([...BASE, '--no-chunking'], {}).options.chunking, false);
  assert.equal(resolveOptions([...BASE, '--chunking=false'], {}).options.chunking, false);
  assert.equal(resolveOptions([...BASE, '--diarize'], {}).options.diarize, true);
  assert.equal(resolveOptions(BASE, { PARAKEET_DIARIZE: 'true' }).options.diarize, true);
});

test('an unknown flag is fatal, never silently ignored', () => {
  // The whole point: --beam-widht must not quietly mean greedy.
  assert.throws(() => resolveOptions([...BASE, '--beam-widht', '4'], {}), /unknown option "--beam-widht"/);
});

test('a positional argument is fatal (this server takes options only)', () => {
  assert.throws(() => resolveOptions([...BASE, 'clip.mp3'], {}), /unexpected positional argument/);
});

test('numeric ranges are enforced, from CLI and from env', () => {
  assert.throws(() => resolveOptions([...BASE, '--beam-width', '99'], {}), /must be <= 25/);
  assert.throws(() => resolveOptions([...BASE, '--beam-width', '0'], {}), /must be >= 1/);
  assert.throws(() => resolveOptions([...BASE, '--beam-width', '2.5'], {}), /expected an integer/);
  assert.throws(() => resolveOptions([...BASE, '--port', 'http'], {}), /expected a number/);
  assert.throws(() => resolveOptions(BASE, { PARAKEET_BEAM_WIDTH: '99' }), /env PARAKEET_BEAM_WIDTH/);
});

test('enums list the valid values in the error', () => {
  assert.throws(() => resolveOptions([...BASE, '--ort', 'tensorrt'], {}), /must be one of wasm, node, cuda/);
  assert.throws(() => resolveOptions([...BASE, '--response-format', 'yaml'], {}),
    /must be one of json, text, srt, vtt, verbose_json/);
});

test('--help short-circuits, so it works with no config at all', () => {
  const { help } = resolveOptions(['--help'], {});
  assert.equal(help, true);
  const help2 = resolveOptions(['-h'], {});
  assert.equal(help2.help, true);
});

test('a missing model dir is fatal and says how to get the weights', () => {
  assert.throws(() => resolveOptions([], {}), /no model directory/);
  assert.throws(() => resolveOptions([], {}), /hf download/);
});

test('an authless non-loopback bind is refused, and the escape hatch is explicit', () => {
  assert.throws(() => resolveOptions([...BASE, '--host', '0.0.0.0'], {}),
    /refusing to listen on the non-loopback address/);
  // With a key: allowed.
  assert.equal(resolveOptions([...BASE, '--host', '0.0.0.0', '--api-key', 'k'], {}).options.host, '0.0.0.0');
  // With the named acknowledgement (what the container uses): allowed.
  assert.equal(
    resolveOptions([...BASE, '--host', '0.0.0.0', '--allow-keyless-non-loopback'], {}).options.host,
    '0.0.0.0',
  );
});

test('isLoopbackHost covers the forms an operator actually types', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(h), true, `${h} should be loopback`);
  }
  for (const h of ['0.0.0.0', '::', '192.168.1.10', 'example.com', '']) {
    assert.equal(isLoopbackHost(h), false, `${h} should not be loopback`);
  }
});

test('fp16/fp32 on the wasm backend is refused at boot, with the reason', () => {
  assert.throws(() => resolveOptions([...BASE, '--quant', 'fp16'], {}), /cannot load on the wasm backend/);
  assert.throws(() => resolveOptions([...BASE, '--quant', 'fp32'], {}), /--ort node/);
  // Native backends may use them.
  assert.equal(resolveOptions([...BASE, '--quant', 'fp32', '--ort', 'node'], {}).options.quant, 'fp32');
});

test('a wordlist without a wordlist dir is fatal', () => {
  assert.throws(() => resolveOptions([...BASE, '--wordlist', 'medical'], {}), /needs --wordlist-dir/);
});

test('an unsupported language is refused against the model list', () => {
  assert.throws(() => resolveOptions([...BASE, '--language', 'zz'], {}), /not in .* supported set/);
  assert.equal(resolveOptions([...BASE, '--language', 'fr'], {}).options.language, 'fr');
});

test('route prefixes must be absolute paths', () => {
  assert.throws(() => resolveOptions([...BASE, '--request-path', 'asr'], {}), /must start with "\/"/);
  assert.equal(resolveOptions([...BASE, '--request-path', '/asr'], {}).options.requestPath, '/asr');
});

test('whisper no-op flags are accepted with a warning and consume their value', () => {
  // -p takes a value: if it were not consumed, "4" would look like a positional
  // argument and throw -- which is exactly the regression this guards.
  const { options, warnings } = resolveOptions([...BASE, '--convert', '-p', '4', '-ng'], {});
  assert.equal(options.modelDir, '/models');
  assert.equal(warnings.length, 3);
  assert.match(warnings.join('\n'), /ignoring --convert/);
  assert.match(warnings.join('\n'), /ignoring -p/);
});

test('unsupported whisper flags are fatal, name an alternative, and are downgradable', () => {
  assert.throws(() => resolveOptions([...BASE, '--translate'], {}), /not supported/);
  assert.throws(() => resolveOptions([...BASE, '--translate'], {}), /no translation head/);
  assert.throws(() => resolveOptions([...BASE, '--best-of', '5'], {}), /--beam-width/);
  // The escape hatch turns every one of them into a warning.
  const { warnings } = resolveOptions([...BASE, '--translate', '--best-of', '5', '--ignore-unsupported'], {});
  assert.equal(warnings.length, 2);
  assert.match(warnings.join('\n'), /--ignore-unsupported/);
});

test('--ignore-unsupported works regardless of flag order', () => {
  // The severity decision is deferred until argv is fully parsed, so putting the
  // escape hatch last must behave like putting it first.
  assert.doesNotThrow(() => resolveOptions([...BASE, '--ignore-unsupported', '--translate'], {}));
  assert.doesNotThrow(() => resolveOptions([...BASE, '--translate', '--ignore-unsupported'], {}));
});

test('coerceValue accepts the boolean spellings clients really send', () => {
  const spec = { type: 'bool', cli: ['--x'] };
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(coerceValue(spec, v), true, v);
  for (const v of ['0', 'false', 'no', 'off', '']) assert.equal(coerceValue(spec, v), false, v);
  assert.throws(() => coerceValue(spec, 'maybe'), /expected a boolean/);
});

test('--help documents every option and both compatibility tables', () => {
  const help = renderHelp();
  for (const spec of OPTIONS) {
    assert.ok(help.includes(spec.cli[0]), `--help is missing ${spec.cli[0]}`);
    assert.ok(help.includes(spec.env), `--help is missing env var ${spec.env}`);
  }
  assert.match(help, /Accepted for whisper compatibility but ignored/);
  assert.match(help, /Rejected/);
  assert.match(help, /\/v1\/audio\/transcriptions/);
});

// ── the plumbing gate ────────────────────────────────────────────────────────
test('every option env var is passed through docker-compose.yml', () => {
  const compose = read('docker-compose.yml');
  const missing = OPTIONS.filter((o) => !compose.includes(o.env)).map((o) => o.env);
  assert.deepEqual(missing, [], 'env vars read by the server but never passed into the container');
});

test('every option env var is documented in env.example', () => {
  const example = read('env.example');
  const missing = OPTIONS.filter((o) => !example.includes(o.env)).map((o) => o.env);
  assert.deepEqual(missing, [], 'env vars that exist but are undocumented');
});

test('env.example documents the compose-only variables too', () => {
  const example = read('env.example');
  const compose = read('docker-compose.yml');
  // Variables the compose file interpolates that are NOT server options: the
  // build args, the resource limits and the two host paths.
  for (const v of ['MODEL_DIR', 'WORDLIST_DIR', 'ORT_NODE_VARIANT', 'RUN_NPM_AUDIT',
    'RUNTIME_BASE', 'CPU_LIMIT', 'MEMORY_LIMIT', 'TMPFS_SIZE']) {
    assert.ok(compose.includes(`\${${v}`), `${v} should be interpolated by docker-compose.yml`);
    assert.ok(example.includes(v), `${v} should be documented in env.example`);
  }
});

test('the compose file keeps the hardening posture', () => {
  const compose = read('docker-compose.yml');
  // These are the properties that make the container boring to attack; a future
  // edit that drops one should fail here rather than in a postmortem.
  assert.match(compose, /user:\s*"1000:1000"/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /pids_limit:/);
  assert.match(compose, /init:\s*true/);
  // Uploads are attacker-supplied bytes on a tmpfs: never executable.
  assert.match(compose, /\/tmp:.*noexec/);
  // The model mount must stay read-only.
  assert.match(compose, /:\/models:ro/);
  // The port must be published to loopback only.
  assert.match(compose, /"127\.0\.0\.1:\$\{PARAKEET_PORT:-8002\}:8002"/);
});

test('the Dockerfile pins its base image by digest and installs deps safely', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /RUNTIME_BASE=node:\d+-bookworm-slim@sha256:[0-9a-f]{64}/,
    'base image must be pinned to an immutable digest');
  assert.match(dockerfile, /npm ci --ignore-scripts/, 'install scripts are the malware delivery channel');
  assert.match(dockerfile, /integrity/, 'the lockfile integrity guard must stay');
  assert.match(dockerfile, /USER parakeet/);
});

test('every per-request field maps to a real option', () => {
  for (const [field, spec] of REQUEST_OVERRIDES) {
    assert.equal(typeof field, 'string');
    assert.ok(OPTIONS.includes(spec), `${field} must point at an OPTIONS row`);
  }
  // Spot-check the ones whisper clients send by their whisper names.
  assert.ok(REQUEST_OVERRIDES.has('beam_size'));
  assert.ok(REQUEST_OVERRIDES.has('prompt'));
  assert.ok(REQUEST_OVERRIDES.has('temperature'));
  assert.ok(REQUEST_OVERRIDES.has('phrase_boost'));
});
