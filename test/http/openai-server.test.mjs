// Tier-2 tests for the OpenAI-like transcription API
// (scripts/openai-like-server/lib/app.mjs).
//
// The real HTTP server is started on a random loopback port and driven with
// `fetch` and real multipart bodies: routing, auth, CORS, the upload cap, the
// queue and every response format are the code under test, unmocked.
//
// Only the INFERENCE side is a double. `createApiServer` takes the engine as an
// argument for exactly this reason: a real engine means ~600 MB of int8 weights
// and tens of seconds per case, which would make this tier untestable in CI, and
// none of the behaviour asserted here depends on the transcript being real. The
// engine/model path is covered by the tier-1 tests plus the manual real-model
// smoke commands in the folder README.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions } from '../../scripts/openai-like-server/lib/options.mjs';
import { createApiServer } from '../../scripts/openai-like-server/lib/app.mjs';
import { badRequest } from '../../scripts/openai-like-server/lib/errors.mjs';
import { SAMPLE_RATE } from '../../scripts/openai-like-server/lib/constants.mjs';

// Two speakers, a sentence each, with a clear pause between them so the segment
// builder splits them for the same reason a real recording would.
const WORDS = [
  { text: 'bonjour', start_time: 0.00, end_time: 0.40, confidence: 0.9 },
  { text: 'tout', start_time: 0.45, end_time: 0.60, confidence: 0.9 },
  { text: 'le', start_time: 0.62, end_time: 0.70, confidence: 0.9 },
  { text: 'monde.', start_time: 0.75, end_time: 1.10, confidence: 0.8 },
  { text: 'oui', start_time: 2.50, end_time: 2.80, confidence: 0.7 },
  { text: 'merci.', start_time: 2.85, end_time: 3.20, confidence: 0.7 },
];
const TEXT = 'bonjour tout le monde. oui merci.';
const DIARIZATION = [
  { start: 0, end: 1.2, speaker: 0 },
  { start: 2.4, end: 3.3, speaker: 1 },
];
const KNOWN_WORDLISTS = ['french_medical'];

/** A fake engine.mjs. Overrides let one case make one call slow or failing. */
function fakeEngine(over = {}) {
  return {
    info: () => ({
      modelId: 'parakeet-tdt-0.6b-v3-int8',
      model: 'parakeet-tdt-0.6b-v3',
      quant: 'int8',
      decoderQuant: 'int8',
      ort: 'wasm',
      wordlists: KNOWN_WORDLISTS,
      diarization: { available: true },
    }),
    // 3.5 s of silence: only its LENGTH is used (for the duration and the rtf log).
    decode: async () => new Float32Array(Math.round(3.5 * SAMPLE_RATE)),
    transcribe: async ({ params }) => {
      // Mirror the real engine, which resolves the wordlist name inside the job
      // and raises a 400 listing what exists.
      if (params.wordlist && !KNOWN_WORDLISTS.includes(params.wordlist)) {
        throw badRequest(`unknown wordlist "${params.wordlist}". Available: ${KNOWN_WORDLISTS.join(', ')}`,
          { param: 'phrase_boost' });
      }
      return { utterance_text: TEXT, words: WORDS.map((w) => ({ ...w })) };
    },
    diarize: async () => DIARIZATION,
    wordlists: () => KNOWN_WORDLISTS,
    dispose: async () => {},
    ...over,
  };
}

/**
 * Start the real server on a random loopback port.
 * @returns {Promise<{url:(p:string)=>string, close:Function, logs:string[]}>}
 */
async function startApi({ argv = [], engine = fakeEngine() } = {}) {
  const { options } = resolveOptions(['--model-dir', '/models', ...argv], {});
  const logs = [];
  const logger = {
    log: (m) => logs.push(String(m)),
    warn: (m) => logs.push(String(m)),
    error: (m) => logs.push(String(m)),
  };
  const api = createApiServer({ engine, options, logger });
  await new Promise((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const { port } = api.server.address();
  return {
    logs,
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => api.close(),
  };
}

/** A multipart body carrying a fake audio file plus text fields. */
function body(fields = {}, { fileField = 'file', bytes = Buffer.from('RIFFfake') } = {}) {
  const fd = new FormData();
  fd.set(fileField, new File([bytes], 'clip.wav', { type: 'audio/wav' }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
}

/** POST a transcription request; `headers` merges over the default (none). */
function post(api, fields, { path = '/v1/audio/transcriptions', headers = {}, ...opts } = {}) {
  return fetch(api.url(path), { method: 'POST', body: body(fields, opts), headers });
}

/** Run one server for the duration of `fn`, always closing it. */
async function withApi(setup, fn) {
  const api = await startApi(setup);
  try {
    return await fn(api);
  } finally {
    await api.close();
  }
}

// ── happy path ───────────────────────────────────────────────────────────────
test('POST /v1/audio/transcriptions returns the OpenAI json shape', async () => {
  await withApi({}, async (api) => {
    const res = await post(api);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await res.json(), { text: TEXT }, 'json is exactly {text}, like OpenAI');
    // Non-standard but useful for an operator watching throughput.
    assert.equal(res.headers.get('x-parakeet-audio-seconds'), '3.500');
    assert.equal(res.headers.get('x-parakeet-model'), 'parakeet-tdt-0.6b-v3-int8');
  });
});

test('every response carries the hardening headers and a request id', async () => {
  await withApi({}, async (api) => {
    const res = await post(api);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{8}$/);
  });
});

test('the access log names the request but never the transcript', async () => {
  await withApi({}, async (api) => {
    await post(api);
    const line = api.logs.find((l) => l.includes('/v1/audio/transcriptions'));
    assert.ok(line, `no access log line in ${JSON.stringify(api.logs)}`);
    assert.match(line, /200/);
    assert.match(line, /audio=3\.5s/);
    assert.match(line, /rtf=/);
    // A log file is a copy of the recording's content; this server may run on
    // audio its operator is not allowed to keep.
    for (const l of api.logs) assert.ok(!l.includes('bonjour'), `transcript leaked into a log: ${l}`);
  });
});

test('each response_format has its own content type and body', async () => {
  await withApi({}, async (api) => {
    const text = await post(api, { response_format: 'text' });
    assert.match(text.headers.get('content-type'), /^text\/plain/);
    assert.equal((await text.text()).trim(), TEXT);

    const srt = await post(api, { response_format: 'srt' });
    assert.match(srt.headers.get('content-type'), /application\/x-subrip/);
    assert.match(await srt.text(), /^1\n00:00:00,000 --> 00:00:01,100\nbonjour tout le monde\./);

    const vtt = await post(api, { response_format: 'vtt' });
    assert.match(vtt.headers.get('content-type'), /^text\/vtt/);
    assert.match(await vtt.text(), /^WEBVTT\n/);

    const verbose = await post(api, { response_format: 'verbose_json' });
    const v = await verbose.json();
    assert.equal(v.task, 'transcribe');
    assert.equal(v.duration, 3.5);
    assert.equal(v.text, TEXT);
    assert.equal(v.segments.length, 2, 'the 1.4 s pause must split the two sentences');
    assert.equal(v.words, undefined, 'segment granularity only, unless word is asked for');
  });
});

test('timestamp_granularities[]=word reaches the response through HTTP', async () => {
  await withApi({}, async (api) => {
    const res = await post(api, { response_format: 'verbose_json', 'timestamp_granularities[]': 'word' });
    const v = await res.json();
    assert.equal(v.segments, undefined);
    assert.equal(v.words.length, WORDS.length);
    assert.deepEqual(v.words[0], { word: 'bonjour', start: 0, end: 0.4, confidence: 0.9 });
  });
});

test('GET /v1/models describes the one served model', async () => {
  await withApi({}, async (api) => {
    const res = await fetch(api.url('/v1/models'));
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.object, 'list');
    assert.equal(b.data.length, 1, 'exactly one model is served, fixed at launch');
    assert.equal(b.data[0].id, 'parakeet-tdt-0.6b-v3-int8');
    assert.equal(b.data[0].parakeet.ort, 'wasm');
    assert.deepEqual(b.data[0].parakeet.wordlists, KNOWN_WORDLISTS);
  });
});

// ── whisper.cpp / whisper-asr-webservice compatibility ───────────────────────
test('the /inference alias accepts whisper.cpp bodies', async () => {
  await withApi({}, async (api) => {
    // whisper.cpp posts to /inference; whisper-asr-webservice names the part
    // `audio_file` and the format `output`.
    const res = await post(api, { output: 'txt' }, { path: '/inference', fileField: 'audio_file' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.equal((await res.text()).trim(), TEXT);
  });
});

test('--inference-path can move or disable the alias', async () => {
  await withApi({ argv: ['--inference-path', '/asr'] }, async (api) => {
    assert.equal((await post(api, {}, { path: '/asr' })).status, 200);
    assert.equal((await post(api, {}, { path: '/inference' })).status, 404);
  });
  await withApi({ argv: ['--inference-path', ''] }, async (api) => {
    assert.equal((await post(api, {}, { path: '/inference' })).status, 404);
  });
});

test('--request-path prefixes every route', async () => {
  await withApi({ argv: ['--request-path', '/asr'] }, async (api) => {
    assert.equal((await post(api, {}, { path: '/asr/v1/audio/transcriptions' })).status, 200);
    assert.equal((await fetch(api.url('/asr/health'))).status, 200);
    assert.equal((await post(api)).status, 404, 'the unprefixed route must be gone');
  });
});

test('a trailing slash is not a different route', async () => {
  await withApi({}, async (api) => {
    assert.equal((await post(api, {}, { path: '/v1/audio/transcriptions/' })).status, 200);
  });
});

test('translation and runtime model loading are 501, not silent no-ops', async () => {
  await withApi({}, async (api) => {
    const tr = await fetch(api.url('/v1/audio/translations'), { method: 'POST', body: body() });
    assert.equal(tr.status, 501);
    assert.match((await tr.json()).error.message, /no translation head/);

    const load = await fetch(api.url('/load'), { method: 'POST', body: body() });
    assert.equal(load.status, 501);
    assert.match((await load.json()).error.message, /fixed at launch/);
  });
});

test('stream=true is refused over HTTP as well', async () => {
  await withApi({}, async (api) => {
    const res = await post(api, { stream: 'true' });
    assert.equal(res.status, 501);
    // stream=false is the same thing we already do, so it must pass.
    assert.equal((await post(api, { stream: 'false' })).status, 200);
  });
});

// ── errors ───────────────────────────────────────────────────────────────────
test('errors use the OpenAI error envelope', async () => {
  await withApi({}, async (api) => {
    const res = await post(api, { response_format: 'nope' });
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    const b = await res.json();
    assert.equal(typeof b.error.message, 'string');
    assert.equal(b.error.type, 'invalid_request_error');
    assert.equal(b.error.param, 'response_format');
  });
});

test('a wrong method on a real route is a 405, an unknown path a 404', async () => {
  await withApi({}, async (api) => {
    const notAllowed = await fetch(api.url('/v1/audio/transcriptions'));
    assert.equal(notAllowed.status, 405);
    assert.match((await notAllowed.json()).error.message, /GET is not allowed/);

    const missing = await fetch(api.url('/v1/nonsense'));
    assert.equal(missing.status, 404);
    // The 404 lists the real routes: this server has few enough that saying so
    // is more useful than making the caller read the README.
    assert.match((await missing.json()).error.message, /\/v1\/audio\/transcriptions/);
  });
});

test('a request with no audio part is a 400 naming the accepted parts', async () => {
  await withApi({}, async (api) => {
    const fd = new FormData();
    fd.set('response_format', 'json');
    const res = await fetch(api.url('/v1/audio/transcriptions'), { method: 'POST', body: fd });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /"file" or "audio_file" or "audio"/);
  });
});

test('a non-multipart body is a 400, not a 500', async () => {
  await withApi({}, async (api) => {
    const res = await fetch(api.url('/v1/audio/transcriptions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"file":"nope"}',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /multipart\/form-data/);
  });
});

test('audio that decodes to nothing is a 400 against the file', async () => {
  await withApi({ engine: fakeEngine({ decode: async () => new Float32Array(0) }) }, async (api) => {
    const res = await post(api);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.param, 'file');
  });
});

test('an unknown wordlist is a 400 that lists the ones on disk', async () => {
  await withApi({ argv: ['--wordlist-dir', '/wordlists'] }, async (api) => {
    const res = await post(api, { phrase_boost: 'nope' });
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.match(b.error.message, /unknown wordlist "nope"/);
    assert.match(b.error.message, /french_medical/);
  });
});

test('--lock-params refuses a per-request knob over HTTP', async () => {
  await withApi({ argv: ['--lock-params', '--beam-width', '4'] }, async (api) => {
    const locked = await post(api, { beam_size: '8' });
    assert.equal(locked.status, 400);
    assert.match((await locked.json()).error.message, /--lock-params/);
    assert.equal((await post(api, { response_format: 'srt' })).status, 200);
  });
});

test('an engine crash is a 500 with no internals in the body', async () => {
  const engine = fakeEngine({ transcribe: async () => { throw new Error('ORT session died at 0xdeadbeef'); } });
  await withApi({ engine }, async (api) => {
    const res = await post(api);
    assert.equal(res.status, 500);
    const b = await res.json();
    assert.equal(b.error.type, 'server_error');
    // The stack goes to the log (an operator needs it); the client gets one line.
    assert.ok(!/\bat .*app\.mjs/.test(JSON.stringify(b)), 'no stack trace in the response body');
    assert.ok(api.logs.some((l) => l.includes('ORT session died')), 'the failure must be logged');
  });
});

// ── limits ───────────────────────────────────────────────────────────────────
test('an upload over --max-upload-mb is a 413 before it is buffered', async () => {
  await withApi({ argv: ['--max-upload-mb', '1'] }, async (api) => {
    const res = await post(api, {}, { bytes: Buffer.alloc(2 * 1024 * 1024, 0x41) });
    assert.equal(res.status, 413);
    const b = await res.json();
    assert.match(b.error.message, /over the 1\.0 MiB limit \(--max-upload-mb\)/);
    assert.equal(b.error.code, 'payload_too_large');
  });
});

test('a second request while the slot is taken is a 429 with Retry-After', async () => {
  // A gate makes this deterministic rather than timing-dependent: the first
  // request cannot finish until the second one has already been rejected.
  let release;
  let announceStart;
  const gate = new Promise((r) => { release = r; });
  const started = new Promise((r) => { announceStart = r; });
  const engine = fakeEngine({
    transcribe: async () => {
      announceStart();
      await gate;
      return { utterance_text: TEXT, words: WORDS };
    },
  });
  await withApi({ argv: ['--max-queue', '0'], engine }, async (api) => {
    const first = post(api);
    await started;
    const second = await post(api);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('retry-after'), '5');
    assert.match((await second.json()).error.message, /--max-queue 0/);
    release();
    assert.equal((await first).status, 200, 'the rejected request must not disturb the running one');
  });
});

test('/health reports the queue depth without a key, details only with one', async () => {
  await withApi({ argv: ['--api-key', 'sekret'] }, async (api) => {
    const anon = await fetch(api.url('/health'));
    assert.equal(anon.status, 200, 'an orchestrator probe must not need the secret');
    const b = await anon.json();
    assert.equal(b.status, 'ok');
    assert.deepEqual(b.queue, { busy: false, waiting: 0, maxQueue: 8 });
    assert.equal(b.model, undefined, 'model details are needless disclosure to a stranger');

    const auth = await fetch(api.url('/health'), { headers: { Authorization: 'Bearer sekret' } });
    assert.equal((await auth.json()).model.quant, 'int8');
  });
});

// ── auth ─────────────────────────────────────────────────────────────────────
test('with a key set, every route but /health needs it', async () => {
  await withApi({ argv: ['--api-key', 'sekret'] }, async (api) => {
    const anon = await post(api);
    assert.equal(anon.status, 401);
    assert.equal(anon.headers.get('www-authenticate'), 'Bearer');
    assert.equal((await anon.json()).error.code, 'invalid_api_key');

    assert.equal((await fetch(api.url('/v1/models'))).status, 401);
    assert.equal((await post(api, {}, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await post(api, {}, { headers: { Authorization: 'Bearer sekret' } })).status, 200);
    // Azure-flavoured clients send the key in its own header.
    assert.equal((await post(api, {}, { headers: { 'api-key': 'sekret' } })).status, 200);
    // Bearer is case-insensitive per RFC 6750.
    assert.equal((await post(api, {}, { headers: { Authorization: 'bearer sekret' } })).status, 200);
  });
});

test('an empty key means no auth at all (the documented single-user mode)', async () => {
  await withApi({ argv: ['--api-key', ''] }, async (api) => {
    assert.equal((await post(api)).status, 200);
    assert.equal((await fetch(api.url('/v1/models'))).status, 200);
    // A key sent to a keyless server is ignored, not rejected.
    assert.equal((await post(api, {}, { headers: { Authorization: 'Bearer whatever' } })).status, 200);
  });
});

// ── CORS ─────────────────────────────────────────────────────────────────────
test('no CORS headers unless --allowed-origins is set', async () => {
  await withApi({}, async (api) => {
    const res = await post(api, {}, { headers: { Origin: 'https://evil.example' } });
    // Not blocked (curl and server-to-server callers send no Origin and must
    // work), but no header is emitted, so a browser page cannot read the result.
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

test('--allowed-origins echoes an allowed origin and rejects the rest', async () => {
  await withApi({ argv: ['--allowed-origins', 'https://app.example'] }, async (api) => {
    const ok = await post(api, {}, { headers: { Origin: 'https://app.example' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.equal(ok.headers.get('vary'), 'Origin');

    const bad = await post(api, {}, { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);

    // The preflight a browser sends before the real POST.
    const pre = await fetch(api.url('/v1/audio/transcriptions'), {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  });
});

test('--allowed-origins "*" allows any origin', async () => {
  await withApi({ argv: ['--allowed-origins', '*'] }, async (api) => {
    const res = await post(api, {}, { headers: { Origin: 'https://anything.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ── diarization ──────────────────────────────────────────────────────────────
test('diarize=true labels words, segments and subtitles', async () => {
  await withApi({}, async (api) => {
    const verbose = await post(api, { diarize: 'true', response_format: 'verbose_json', 'timestamp_granularities[]': 'word' });
    const v = await verbose.json();
    assert.equal(v.speakers, 2);
    // The two diarization segments and the two sentences line up, so the first
    // four words are speaker 0 and the last two speaker 1.
    assert.deepEqual(v.words.map((w) => w.speaker), [0, 0, 0, 0, 1, 1]);

    const srt = await post(api, { diarize: 'true', response_format: 'srt' });
    const text = await srt.text();
    assert.match(text, /\[Speaker 0\] bonjour tout le monde\./);
    assert.match(text, /\[Speaker 1\] oui merci\./);
  });
});

test('diarize=true works even for plain json (labels are simply not shown)', async () => {
  let diarized = false;
  const engine = fakeEngine({ diarize: async () => { diarized = true; return DIARIZATION; } });
  await withApi({ engine }, async (api) => {
    assert.deepEqual(await (await post(api, { diarize: 'true' })).json(), { text: TEXT });
    assert.equal(diarized, true);
  });
});

test('json does not diarize unless asked', async () => {
  let diarized = false;
  const engine = fakeEngine({ diarize: async () => { diarized = true; return DIARIZATION; } });
  await withApi({ engine }, async (api) => {
    await post(api);
    assert.equal(diarized, false, 'diarization is the dominant cost; never run it speculatively');
  });
});

test('a diarization failure is reported, not silently dropped', async () => {
  const engine = fakeEngine({
    diarize: async () => { throw badRequest('diarization is unavailable: model.onnx not found', { param: 'diarize' }); },
  });
  await withApi({ engine }, async (api) => {
    const res = await post(api, { diarize: 'true' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /model\.onnx not found/);
  });
});

// ── parameter plumbing ───────────────────────────────────────────────────────
test('request fields reach the engine as decoding params', async () => {
  let seen = null;
  const engine = fakeEngine({
    transcribe: async ({ params }) => { seen = params; return { utterance_text: TEXT, words: WORDS }; },
  });
  await withApi({ engine, argv: ['--beam-width', '1'] }, async (api) => {
    await post(api, {
      beam_size: '8', temperature: '0.4', prompt: 'venlafaxine:10', language: 'fr', chunk_duration: '15',
    });
    assert.equal(seen.beamWidth, 8, 'the launch default must be overridable per request');
    assert.equal(seen.temperature, 0.4);
    assert.equal(seen.prompt, 'venlafaxine:10');
    assert.equal(seen.language, 'fr');
    assert.equal(seen.chunkDuration, 15);
  });
});

test('a warning about an ignored field is logged, not returned as an error', async () => {
  await withApi({}, async (api) => {
    const res = await post(api, { vad_filter: 'true' });
    assert.equal(res.status, 200, 'a field we can safely ignore must not break the client');
    assert.ok(api.logs.some((l) => l.includes('vad_filter')), 'but the operator must see it was ignored');
  });
});
