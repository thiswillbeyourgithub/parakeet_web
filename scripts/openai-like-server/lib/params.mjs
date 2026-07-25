// Turn one parsed form into the exact parameter set a run needs, layered over
// the launch-time defaults.
//
// Three tables drive this, all next to each other so the accepted surface is
// readable in one screen:
//   REQUEST_OVERRIDES (options.mjs)  fields that map 1:1 onto a launch option
//   ALIASES                          other servers' spellings for the same thing
//   NOOP_FIELDS                      fields we accept and demonstrably ignore
// Anything else is a 400. An unknown field is a typo (`beam_wdith`) far more
// often than it is forward compatibility, and silently ignoring it hands back a
// transcript that is not what was asked for -- the same reasoning that makes an
// unknown CLI flag fatal.
//
// Built with Claude Code.

import {
  REQUEST_OVERRIDES, ALWAYS_ALLOWED_FIELDS, UNSUPPORTED, RESPONSE_FORMATS,
  GRANULARITIES, coerceValue,
} from './options.mjs';
import { getModelConfig } from '../../../app/src/models.js';
import { badRequest, notImplemented } from './errors.mjs';
import { FILE_FIELDS } from './multipart.mjs';

// Other servers' field names for things we already have. `to` is the canonical
// form field (a REQUEST_OVERRIDES key) or a '#special' handled inline below.
const ALIASES = new Map([
  ['initial_prompt', { to: 'prompt', why: 'faster-whisper / whisper-asr-webservice spelling' }],
  // faster-whisper's "hotwords" ARE phrase boosting, so they land on the same knob.
  ['hotwords', { to: 'prompt', why: 'faster-whisper hotwords are phrase boosts here' }],
  ['beam_width', { to: 'beam_size', why: 'this repo calls it beam width' }],
  ['word_timestamps', { to: '#word_timestamps', why: 'whisper-asr-webservice spelling' }],
  ['output', { to: '#output', why: 'whisper-asr-webservice spelling of response_format' }],
  ['task', { to: '#task', why: 'transcribe|translate selector' }],
  ['min_speakers', { to: '#speaker_bounds', why: 'exact counts only; min==max sets num_speakers' }],
  ['max_speakers', { to: '#speaker_bounds', why: 'exact counts only; min==max sets num_speakers' }],
  ['stream', { to: '#stream', why: 'SSE responses are not implemented' }],
]);

// Accepted, warned about once per request, and unable to change our output.
const NOOP_FIELDS = new Map([
  ['temperature_inc', 'there is no fallback-temperature retry loop to step through'],
  ['encode', 'uploads are always decoded through ffmpeg'],
  ['vad_filter', 'no VAD stage; chunk seams snap to silence instead (--snap-to-silence)'],
  ['suppress_tokens', 'parakeet emits no special tokens to suppress'],
  ['condition_on_previous_text', 'the RNN-T decoder carries no cross-window text context'],
  ['compression_ratio_threshold', 'no fallback/retry loop to threshold'],
  ['logprob_threshold', 'no fallback/retry loop to threshold'],
  ['no_speech_threshold', 'no no-speech head to threshold'],
]);

const UNSUPPORTED_BY_FIELD = new Map();
for (const u of UNSUPPORTED) for (const f of u.req || []) UNSUPPORTED_BY_FIELD.set(f, u);

/**
 * Resolve the parameters for one request.
 *
 * @param {object} a
 * @param {FormData} a.form
 * @param {object} a.options resolved launch options
 * @returns {{params: object, warnings: string[]}}
 */
export function resolveRequestParams({ form, options }) {
  const warnings = [];
  // Start from the launch options: an absent field means "as configured".
  const params = { ...options };
  let explicitGranularities = null;
  let explicitFormat = null;
  const speakerBounds = {};

  for (const rawKey of new Set([...form.keys()])) {
    // OpenAI sends repeated array fields as `timestamp_granularities[]`.
    const key = rawKey.replace(/\[\]$/, '');
    // The audio part itself is extractFile()'s business, and it is the ONLY part
    // allowed to be a file: every other field is text, so a file there is a
    // client bug worth naming rather than stringifying into "[object File]".
    if (FILE_FIELDS.includes(key)) continue;
    if (typeof form.get(rawKey) !== 'string') {
      throw badRequest(`field "${key}" must be a text field, not a file part`, { param: key });
    }
    if (ALWAYS_ALLOWED_FIELDS.has(rawKey) || ALWAYS_ALLOWED_FIELDS.has(key)) {
      if (key === 'timestamp_granularities') {
        explicitGranularities = form.getAll(rawKey).flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
        for (const g of explicitGranularities) {
          if (!GRANULARITIES.includes(g)) {
            throw badRequest(`timestamp_granularities must be one of ${GRANULARITIES.join(', ')}, got "${g}"`,
              { param: 'timestamp_granularities' });
          }
        }
      } else if (key === 'response_format') {
        explicitFormat = readFormat(form.get(rawKey));
      }
      // `file` is handled by the caller; `model` is echoed, never enforced (a
      // client hard-coding "whisper-1" must still work against one served model).
      continue;
    }

    const unsupported = UNSUPPORTED_BY_FIELD.get(key);
    if (unsupported) {
      const msg = `field "${key}" is not supported: ${unsupported.why} (instead: ${unsupported.alt})`;
      if (options.ignoreUnsupported) { warnings.push(`${msg} [--ignore-unsupported]`); continue; }
      throw notImplemented(msg);
    }

    if (NOOP_FIELDS.has(key)) {
      warnings.push(`ignoring "${key}": ${NOOP_FIELDS.get(key)}`);
      continue;
    }

    const alias = ALIASES.get(key);
    const target = alias ? alias.to : key;
    const raw = form.get(rawKey);

    // Inline specials: fields that are not a 1:1 option override.
    if (target === '#task') {
      const task = raw.trim().toLowerCase();
      if (task && task !== 'transcribe') {
        throw notImplemented(`task "${task}" is not supported: parakeet transcribes only, it has no translation head`);
      }
      continue;
    }
    if (target === '#stream') {
      if (coerceValue({ type: 'bool', req: 'stream' }, raw, { source: 'field' })) {
        throw notImplemented('stream=true is not supported: streamed (SSE) transcription responses are not implemented');
      }
      continue;
    }
    if (target === '#word_timestamps') {
      if (coerceValue({ type: 'bool', req: 'word_timestamps' }, raw, { source: 'field' })) {
        explicitGranularities = [...new Set([...(explicitGranularities || ['segment']), 'word'])];
      }
      continue;
    }
    if (target === '#output') {
      // whisper-asr-webservice spells the formats differently.
      const map = { txt: 'text', text: 'text', json: 'json', vtt: 'vtt', srt: 'srt', verbose_json: 'verbose_json' };
      const v = raw.trim().toLowerCase();
      if (!map[v]) {
        throw badRequest(`output must be one of ${Object.keys(map).join(', ')}, got "${v}"`, { param: 'output' });
      }
      explicitFormat = map[v];
      continue;
    }
    if (target === '#speaker_bounds') {
      speakerBounds[key] = coerceValue({ type: 'int', min: 1, max: 100, req: key }, raw, { source: 'field' });
      continue;
    }

    const spec = REQUEST_OVERRIDES.get(target);
    if (!spec) {
      throw badRequest(
        `unknown field "${key}". Accepted: ${[...ALWAYS_ALLOWED_FIELDS, ...REQUEST_OVERRIDES.keys(), ...ALIASES.keys()]
          .sort().join(', ')}`,
        { param: key },
      );
    }
    if (options.lockParams) {
      throw badRequest(
        `this server was started with --lock-params, so "${key}" cannot be overridden per request `
        + `(it is fixed at ${JSON.stringify(options[spec.key] ?? null)})`,
        { param: key },
      );
    }
    // An empty string means "none" for the two string knobs where that is
    // meaningful (phrase_boost="" turns the default wordlist off); for every
    // other type it is a client sending a blank field, which we treat as absent.
    if (raw === '' && spec.type !== 'string') continue;
    params[spec.key] = coerceValue(spec, raw, { source: 'field' });
    if (alias) warnings.push(`mapped "${key}" to ${spec.req} (${alias.why})`);
  }

  if (Object.keys(speakerBounds).length) {
    const { min_speakers: lo, max_speakers: hi } = speakerBounds;
    if (lo != null && hi != null && lo === hi) params.numSpeakers = lo;
    else warnings.push('ignoring min_speakers/max_speakers: only an exact count is supported (num_speakers), '
      + 'or leave it out for automatic clustering');
  }

  params.responseFormat = explicitFormat || options.responseFormat;
  params.granularities = resolveGranularities(explicitGranularities, params.responseFormat, warnings);
  if (params.language && !languageAllowed(options, params.language)) {
    throw badRequest(`language "${params.language}" is not in ${options.model}'s supported set`, { param: 'language' });
  }

  // Word times are what the subtitle formats, the word granularity and the
  // speaker assignment are all built from, so they are forced on whenever any of
  // those is in play rather than left to the client to remember.
  params.returnTimestamps = params.responseFormat !== 'json' && params.responseFormat !== 'text'
    ? true
    : Boolean(params.diarize);
  if (params.diarize) params.returnTimestamps = true;
  // Confidences only feed verbose_json's avg_logprob, and computing them is not
  // free, so they follow that one format.
  params.returnConfidences = params.responseFormat === 'verbose_json';

  return { params, warnings };
}

function readFormat(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!RESPONSE_FORMATS.includes(v)) {
    throw badRequest(`response_format must be one of ${RESPONSE_FORMATS.join(', ')}, got "${v}"`,
      { param: 'response_format' });
  }
  return v;
}

// OpenAI only allows timestamp_granularities with verbose_json, and defaults to
// ['segment'] there. srt/vtt need segments regardless of what was asked for, so
// they always get them.
function resolveGranularities(explicit, format, warnings) {
  if (format === 'srt' || format === 'vtt') {
    if (explicit && !explicit.includes('segment')) {
      warnings.push(`response_format ${format} always uses segment timestamps; ignoring timestamp_granularities`);
    }
    return ['segment'];
  }
  if (format !== 'verbose_json') {
    if (explicit) warnings.push(`timestamp_granularities only applies to response_format=verbose_json; ignoring it`);
    return [];
  }
  return explicit && explicit.length ? [...new Set(explicit)] : ['segment'];
}

// models.js owns the per-model language list; a model config without one (or an
// unknown key) is treated as permissive so a future model cannot 400 every
// request that names a language.
function languageAllowed(options, language) {
  const cfg = getModelConfig(options.model);
  if (!cfg || !Array.isArray(cfg.languages) || !cfg.languages.length) return true;
  return cfg.languages.includes(String(language).toLowerCase());
}
