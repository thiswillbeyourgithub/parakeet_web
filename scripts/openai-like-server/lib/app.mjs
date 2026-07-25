// HTTP layer: routing, auth, limits, and the request -> response shaping.
//
// It talks to the inference side through the small `engine` interface
// (engine.mjs: info/decode/transcribe/diarize/wordlists), which is what lets the
// tier-2 tests exercise every route, status code and response format against a
// fake engine, with no model weights and in milliseconds.
//
// Route map (all under --request-path, "" by default):
//   POST /v1/audio/transcriptions   the real endpoint
//   POST /inference                 whisper.cpp-style alias (--inference-path)
//   POST /v1/audio/translations     501, always: parakeet has no translation head
//   POST /load                      501, always: the model is fixed at launch
//   GET  /v1/models                 the one served model, OpenAI-shaped
//   GET  /health                    liveness + queue depth (no auth needed)
//
// Built with Claude Code.

import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { assignSpeakersToWords, speakerCount } from '../../../app/ui/src/lib/speakerAssign.js';
import { ApiError, badRequest, notFound, notImplemented, unauthorized } from './errors.mjs';
import { readBodyCapped, parseBody, extractFile, withTempFile, createUploadDir, removeUploadDir } from './multipart.mjs';
import { resolveRequestParams } from './params.mjs';
import { buildSegments, serialiseResult } from './formats.mjs';
import { createQueue } from './queue.mjs';
import { SAMPLE_RATE } from './constants.mjs';

/**
 * @param {object} a
 * @param {object} a.engine   engine.mjs instance (or a test double)
 * @param {object} a.options  resolved launch options
 * @param {object} [a.logger] console-like sink; defaults to console
 * @returns {{server: http.Server, routes: object, close: Function}}
 */
export function createApiServer({ engine, options, logger = console }) {
  const startedAt = Date.now();
  const uploadDir = createUploadDir();
  const queue = createQueue({
    maxQueue: options.maxQueue,
    timeoutMs: options.requestTimeoutSec * 1000,
  });
  const maxUploadBytes = Math.floor(options.maxUploadMb * 1024 * 1024);

  const prefix = options.requestPath.replace(/\/$/, '');
  const routes = {
    transcriptions: `${prefix}/v1/audio/transcriptions`,
    translations: `${prefix}/v1/audio/translations`,
    inference: options.inferencePath ? `${prefix}${options.inferencePath}` : null,
    load: `${prefix}/load`,
    models: `${prefix}/v1/models`,
    health: `${prefix}/health`,
  };

  // Hash the configured key once. Comparing digests (not raw strings) keeps
  // timingSafeEqual's equal-length requirement satisfied for any key length,
  // and never branches on the secret's length.
  const keyDigest = options.apiKey ? sha256(options.apiKey) : null;

  const server = http.createServer(handle);
  // Our own deadline (queue.mjs) is the meaningful one; Node's default 300 s
  // requestTimeout would otherwise cut off a legitimately long transcription.
  // Keep it slightly above ours so the socket outlives the 504 we send.
  server.requestTimeout = (options.requestTimeoutSec + 60) * 1000;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  async function handle(req, res) {
    const requestId = randomUUID().slice(0, 8);
    const t0 = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // Facts filled in as we go, so the access log line is useful even on failure.
    const log = { requestId, method: req.method, path, bytes: 0, audioSec: null, extra: '' };

    baseHeaders(res, requestId);
    try {
      if (!applyCors(req, res)) return finish(res, 403, 'text/plain', 'origin not allowed\n', log, t0);
      if (req.method === 'OPTIONS') return finish(res, 204, null, '', log, t0);

      if (req.method === 'GET' && path === routes.health) return await handleHealth(req, res, log, t0);
      if (req.method === 'GET' && path === routes.models) {
        requireAuth(req);
        return finish(res, 200, 'application/json', JSON.stringify(modelsBody()), log, t0);
      }
      if (req.method === 'POST' && path === routes.translations) {
        requireAuth(req);
        throw notImplemented(
          'translation is not supported: parakeet transcribes only, it has no translation head. '
          + 'Use /v1/audio/transcriptions and translate the text with a separate tool.',
        );
      }
      if (req.method === 'POST' && path === routes.load) {
        requireAuth(req);
        throw notImplemented(
          'the model is fixed at launch (--model-dir / --quant / --ort) and cannot be swapped at runtime; '
          + 'restart the server with different options instead.',
        );
      }
      if (req.method === 'POST' && (path === routes.transcriptions || (routes.inference && path === routes.inference))) {
        requireAuth(req);
        return await handleTranscription(req, res, log, t0);
      }

      // Method mismatch on a known path is a 405, not a 404: it is a client bug
      // worth naming (a GET on /v1/audio/transcriptions is a common one).
      const known = Object.values(routes).filter(Boolean);
      if (known.includes(path)) {
        throw new ApiError(405, `${req.method} is not allowed on ${path}`, { code: 'method_not_allowed' });
      }
      throw notFound(`no route ${req.method} ${path}. Available: ${known.join(', ')}`);
    } catch (err) {
      return sendError(res, err, log, t0);
    }
  }

  async function handleHealth(req, res, log, t0) {
    // Unauthenticated on purpose: container/orchestrator probes should not need
    // the secret. It therefore exposes only liveness and load; the model/wordlist
    // details (useful to an operator, needless disclosure to a stranger) are
    // added only for an authenticated caller, or when no auth is configured.
    const body = {
      status: 'ok',
      uptime_sec: Math.round((Date.now() - startedAt) / 1000),
      queue: queue.stats(),
    };
    if (isAuthorised(req)) body.model = engine.info();
    return finish(res, 200, 'application/json', JSON.stringify(body), log, t0);
  }

  function modelsBody() {
    const info = engine.info();
    return {
      object: 'list',
      data: [{
        id: info.modelId,
        object: 'model',
        created: Math.floor(startedAt / 1000),
        owned_by: 'parakeet_web',
        // Non-standard but harmless extras: a client can see what it is actually
        // talking to (which quant, which backend, which wordlists exist).
        parakeet: {
          model: info.model, quant: info.quant, decoder_quant: info.decoderQuant,
          ort: info.ort, wordlists: info.wordlists, diarization: info.diarization.available,
        },
      }],
    };
  }

  async function handleTranscription(req, res, log, t0) {
    const buffer = await readBodyCapped(req, maxUploadBytes);
    log.bytes = buffer.length;
    const form = await parseBody({ contentType: req.headers['content-type'], buffer });
    const file = await extractFile(form);
    const { params, warnings } = resolveRequestParams({ form, options });
    for (const w of warnings) logger.warn(`[api ${log.requestId}] ${w}`);

    // Everything below runs inside the single job slot: the decode is included
    // deliberately, so `--max-queue` counts whole requests and one ffmpeg cannot
    // steal CPU from the transcription that is already running.
    const outcome = await queue.run(async () => {
      const pcm = await withTempFile(uploadDir, file.bytes, (path) => engine.decode(path));
      const durationSec = pcm.length / SAMPLE_RATE;
      if (!pcm.length) throw badRequest('the uploaded file decoded to zero audio samples', { param: 'file' });
      const result = await engine.transcribe({ pcm, params });

      let speakers;
      let words = result.words || [];
      if (params.diarize) {
        const segments = await engine.diarize({ pcm, params });
        speakers = speakerCount(segments);
        // Word times come from the TDT durations; the speaker of a word is the
        // diarization segment it overlaps most (app/ui/src/lib/speakerAssign.js,
        // shared with the browser app so both label identically).
        words = assignSpeakersToWords(words, segments);
      }
      return { result, words, durationSec, speakers };
    });

    const { result, words, durationSec, speakers } = outcome;
    const segments = params.granularities.includes('segment') || params.responseFormat === 'text'
      ? buildSegments(words, { maxChars: params.maxSegmentChars, gapSec: params.segmentGapSec })
      : [];
    const { contentType, body } = serialiseResult(params.responseFormat, {
      result: { ...result, words },
      durationSec,
      language: params.language || 'unknown',
      segments,
      granularities: params.granularities,
      speakers,
      temperature: params.temperature,
    });

    log.audioSec = durationSec;
    const elapsedSec = (Date.now() - t0) / 1000;
    log.extra = `rtf=${(elapsedSec / Math.max(durationSec, 0.001)).toFixed(2)}`
      + (speakers !== undefined ? ` speakers=${speakers}` : '');
    res.setHeader('X-Parakeet-Audio-Seconds', durationSec.toFixed(3));
    res.setHeader('X-Parakeet-Model', engine.info().modelId);
    return finish(res, 200, contentType, body, log, t0);
  }

  // ── auth ────────────────────────────────────────────────────────────────
  function isAuthorised(req) {
    if (!keyDigest) return true;                       // no key configured
    const header = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    // `api-key` is what Azure-flavoured clients send; accepting it costs nothing.
    const presented = m ? m[1].trim() : (req.headers['api-key'] || '').trim();
    if (!presented) return false;
    return timingSafeEqual(sha256(presented), keyDigest);
  }

  function requireAuth(req) {
    if (!isAuthorised(req)) throw unauthorized();
  }

  // ── CORS ────────────────────────────────────────────────────────────────
  // Off entirely unless --allowed-origins is set: this API is normally called
  // server-to-server, and a permissive default would let any page in a user's
  // browser spend the server's CPU.
  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!options.allowedOrigins.length) return true;   // no CORS headers, no blocking
    if (!origin) return true;                          // not a browser request
    const allowAll = options.allowedOrigins.includes('*');
    if (!allowAll && !options.allowedOrigins.includes(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, api-key, content-type');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  // ── responses ───────────────────────────────────────────────────────────
  function baseHeaders(res, requestId) {
    res.setHeader('X-Request-Id', requestId);
    // An API that only ever emits JSON/text/subtitles: keep browsers from
    // sniffing, caching or rendering any of it.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
  }

  function finish(res, status, contentType, body, log, t0) {
    if (contentType) res.setHeader('Content-Type', contentType.includes('charset') ? contentType : `${contentType}; charset=utf-8`);
    res.statusCode = status;
    res.end(body);
    access(log, status, t0);
  }

  function sendError(res, err, log, t0) {
    const apiErr = err instanceof ApiError
      ? err
      : new ApiError(500, `internal error: ${err?.message || err}`, { code: 'internal_error' });
    if (apiErr.status >= 500) logger.error(`[api ${log.requestId}] ${err?.stack || err}`);
    for (const [k, v] of Object.entries(apiErr.headers)) res.setHeader(k, v);
    if (apiErr.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    // A response may already be streaming if the failure came late; nothing to
    // do then but drop the socket.
    if (res.headersSent) { res.destroy(); access(log, apiErr.status, t0); return; }
    log.extra = `${log.extra} err=${apiErr.code || apiErr.type}`.trim();
    finish(res, apiErr.status, 'application/json', JSON.stringify(apiErr.toBody()), log, t0);
  }

  // One line per request. Never logs the transcript or the API key: this server
  // may run over recordings its operator is not allowed to keep copies of, and a
  // log file is a copy.
  function access(log, status, t0) {
    const parts = [
      `[api ${log.requestId}]`, log.method, log.path, status,
      `${(log.bytes / 1024).toFixed(0)}KiB`,
    ];
    if (log.audioSec != null) parts.push(`audio=${log.audioSec.toFixed(1)}s`);
    parts.push(`q=${queue.stats().waiting}`, `${((Date.now() - t0) / 1000).toFixed(2)}s`);
    if (log.extra) parts.push(log.extra);
    logger.log(parts.join(' '));
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    removeUploadDir(uploadDir);
  }

  return { server, routes, close, queue };
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest();
}
