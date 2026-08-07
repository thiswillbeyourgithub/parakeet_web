// Tier-1 tests for per-request parameter resolution and the job queue
// (scripts/openai-like-server/lib/params.mjs + lib/queue.mjs).
//
// The parameter layer is the server's whole compatibility story: a request from
// the OpenAI SDK, from whisper.cpp's client, or from whisper-asr-webservice must
// all land on the same knobs, while a field we cannot honour has to fail loudly
// instead of producing a transcript that ignores it. Each accepted spelling and
// each rejection therefore gets a case.
//
// The queue tests pin the contract the HTTP layer depends on: strict FIFO, 429
// when full, 504 on the deadline, and a waiting job that times out never runs at
// all.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions } from '../../scripts/openai-like-server/lib/options.mjs';
import { MAX_CHUNK_DURATION_SEC } from '../../app/src/models.js';
import { resolveRequestParams } from '../../scripts/openai-like-server/lib/params.mjs';
import { createQueue } from '../../scripts/openai-like-server/lib/queue.mjs';

/** Launch options, with overrides applied as CLI flags. */
function opts(...argv) {
  return resolveOptions(['--model-dir', '/models', ...argv], {}).options;
}

/** A form carrying `file` plus the given text fields. */
function form(fields = {}) {
  const fd = new FormData();
  fd.set('file', new File([Buffer.from('AUDIO')], 'clip.wav', { type: 'audio/wav' }));
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, String(v));
  }
  return fd;
}

const resolve = (fields, options = opts()) => resolveRequestParams({ form: form(fields), options });

test('an empty request inherits every launch default', () => {
  const { params } = resolve({}, opts('--beam-width', '4', '--response-format', 'text'));
  assert.equal(params.beamWidth, 4);
  assert.equal(params.responseFormat, 'text');
  assert.equal(params.chunking, true);
});

test('json/text ask for no timestamps; verbose_json/srt/vtt do', () => {
  assert.equal(resolve({}).params.returnTimestamps, false);
  assert.equal(resolve({ response_format: 'verbose_json' }).params.returnTimestamps, true);
  assert.equal(resolve({ response_format: 'srt' }).params.returnTimestamps, true);
  assert.equal(resolve({ response_format: 'vtt' }).params.returnTimestamps, true);
  // Confidences feed verbose_json's avg_logprob only.
  assert.equal(resolve({ response_format: 'verbose_json' }).params.returnConfidences, true);
  assert.equal(resolve({ response_format: 'srt' }).params.returnConfidences, false);
});

test('diarize forces word timestamps even for a plain json response', () => {
  // Speakers are assigned by overlapping word times with diarization segments, so
  // without timestamps the labels would have nothing to attach to.
  const { params } = resolve({ diarize: 'true' });
  assert.equal(params.diarize, true);
  assert.equal(params.returnTimestamps, true);
});

test('timestamp_granularities: default, both spellings, and the array form', () => {
  assert.deepEqual(resolve({ response_format: 'verbose_json' }).params.granularities, ['segment']);
  assert.deepEqual(
    resolve({ response_format: 'verbose_json', 'timestamp_granularities[]': ['word'] }).params.granularities,
    ['word'],
  );
  assert.deepEqual(
    resolve({ response_format: 'verbose_json', timestamp_granularities: 'word,segment' }).params.granularities,
    ['word', 'segment'],
  );
  assert.throws(() => resolve({ response_format: 'verbose_json', timestamp_granularities: 'phoneme' }),
    /must be one of segment, word/);
});

test('srt/vtt always use segments, and say so when told otherwise', () => {
  const { params, warnings } = resolve({ response_format: 'srt', 'timestamp_granularities[]': ['word'] });
  assert.deepEqual(params.granularities, ['segment']);
  assert.match(warnings.join('\n'), /always uses segment timestamps/);
});

test('granularities on a json response are ignored with a warning', () => {
  const { params, warnings } = resolve({ 'timestamp_granularities[]': ['word'] });
  assert.deepEqual(params.granularities, []);
  assert.match(warnings.join('\n'), /only applies to response_format=verbose_json/);
});

test('other servers\' field names map onto the same knobs', () => {
  assert.equal(resolve({ initial_prompt: 'venlafaxine:5' }).params.prompt, 'venlafaxine:5');
  // faster-whisper's "hotwords" are exactly phrase boosting.
  assert.equal(resolve({ hotwords: 'venlafaxine:5' }).params.prompt, 'venlafaxine:5');
  assert.equal(resolve({ beam_width: '8' }).params.beamWidth, 8);
  assert.equal(resolve({ beam_size: '8' }).params.beamWidth, 8);
  assert.equal(resolve({ output: 'txt' }).params.responseFormat, 'text');
  assert.equal(resolve({ output: 'vtt' }).params.responseFormat, 'vtt');
  assert.throws(() => resolve({ output: 'tsv' }), /output must be one of/);
});

test('word_timestamps=true adds the word granularity', () => {
  const { params } = resolve({ response_format: 'verbose_json', word_timestamps: 'true' });
  assert.deepEqual(params.granularities.sort(), ['segment', 'word']);
  // false must not add it.
  assert.deepEqual(resolve({ response_format: 'verbose_json', word_timestamps: 'false' }).params.granularities,
    ['segment']);
});

test('task=transcribe passes; task=translate is a 501', () => {
  assert.doesNotThrow(() => resolve({ task: 'transcribe' }));
  const err = assertThrows(() => resolve({ task: 'translate' }));
  assert.equal(err.status, 501);
  assert.match(err.message, /no translation head/);
});

test('stream=true is a 501; stream=false is fine', () => {
  assert.doesNotThrow(() => resolve({ stream: 'false' }));
  assert.equal(assertThrows(() => resolve({ stream: 'true' })).status, 501);
});

test('an unknown field is a 400 that lists what is accepted', () => {
  const err = assertThrows(() => resolve({ beam_wdith: '4' }));
  assert.equal(err.status, 400);
  assert.match(err.message, /unknown field "beam_wdith"/);
  assert.match(err.message, /response_format/, 'the error should enumerate the accepted fields');
});

test('fields we cannot honour are rejected, and downgradable', () => {
  assert.equal(assertThrows(() => resolve({ best_of: '5' })).status, 501);
  const { warnings } = resolve({ best_of: '5' }, opts('--ignore-unsupported'));
  assert.match(warnings.join('\n'), /best_of/);
});

test('fields that cannot change our output are accepted with a warning', () => {
  const { warnings } = resolve({ vad_filter: 'true', temperature_inc: '0.2', encode: 'true' });
  assert.equal(warnings.length, 3);
  assert.match(warnings.join('\n'), /vad_filter/);
});

test('--lock-params refuses knob overrides but still allows output selection', () => {
  const locked = opts('--lock-params', '--beam-width', '4');
  const err = assertThrows(() => resolve({ beam_size: '8' }, locked));
  assert.equal(err.status, 400);
  assert.match(err.message, /--lock-params/);
  assert.match(err.message, /fixed at 4/, 'the error should say what the value is pinned to');
  // response_format / timestamp_granularities / model / file remain allowed: they
  // select what comes back, not how the audio was decoded.
  assert.doesNotThrow(() => resolve({ response_format: 'srt', model: 'whisper-1' }, locked));
});

test('a hard-coded model name is accepted (one model is served, never enforced)', () => {
  // Every OpenAI client sends model=whisper-1 or similar; rejecting it would break
  // all of them for no benefit.
  assert.doesNotThrow(() => resolve({ model: 'whisper-1' }));
});

test('phrase_boost picks a wordlist, and empty turns the default off', () => {
  const withDefault = opts('--wordlist-dir', '/wordlists', '--wordlist', 'medical');
  assert.equal(resolve({}, withDefault).params.wordlist, 'medical');
  assert.equal(resolve({ phrase_boost: 'legal' }, withDefault).params.wordlist, 'legal');
  assert.equal(resolve({ phrase_boost: '' }, withDefault).params.wordlist, '', 'empty must mean "no list"');
});

test('numeric request fields are range-checked like the CLI flags', () => {
  assert.equal(resolve({ temperature: '0.5' }).params.temperature, 0.5);
  assert.throws(() => resolve({ temperature: '3' }), /must be <= 1/);
  assert.throws(() => resolve({ beam_size: '99' }), /must be <= 25/);
  // The chunk bound follows models.js MAX_CHUNK_DURATION_SEC (measured, not
  // hardcoded here, so a re-measured cap cannot silently desync this test).
  assert.throws(() => resolve({ chunk_duration: '600' }), new RegExp(`must be <= ${MAX_CHUNK_DURATION_SEC}`));
});

test('language is validated against the model, and echoed', () => {
  assert.equal(resolve({ language: 'fr' }).params.language, 'fr');
  assert.equal(assertThrows(() => resolve({ language: 'zz' })).status, 400);
});

test('min_speakers/max_speakers collapse to an exact count only when equal', () => {
  const equal = resolve({ diarize: 'true', min_speakers: '2', max_speakers: '2' });
  assert.equal(equal.params.numSpeakers, 2);
  const range = resolve({ diarize: 'true', min_speakers: '2', max_speakers: '5' });
  assert.equal(range.params.numSpeakers, -1, 'a range must fall back to automatic clustering');
  assert.match(range.warnings.join('\n'), /only an exact count is supported/);
});

test('the audio part may be named file, audio_file or audio', () => {
  // whisper-asr-webservice posts `audio_file`; the field-name list lives in
  // multipart.mjs, and params.mjs must skip exactly that list or the alternative
  // spellings come back as "unknown field".
  for (const field of ['file', 'audio_file', 'audio']) {
    const fd = new FormData();
    fd.set(field, new File([Buffer.from('AUDIO')], 'clip.wav', { type: 'audio/wav' }));
    assert.doesNotThrow(() => resolveRequestParams({ form: fd, options: opts() }),
      `"${field}" must not be rejected as an unknown field`);
  }
});

test('a file part sent where a text field belongs is a 400', () => {
  const fd = form();
  fd.set('response_format', new File([Buffer.from('x')], 'x.txt'));
  assert.throws(() => resolveRequestParams({ form: fd, options: opts() }), /must be a text field/);
});

// ── queue ────────────────────────────────────────────────────────────────────
test('queue runs jobs strictly FIFO, one at a time', async () => {
  const q = createQueue({ maxQueue: 10, timeoutMs: 5000 });
  const order = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const job = (n) => async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 5));
    order.push(n);
    concurrent -= 1;
    return n;
  };
  const results = await Promise.all([q.run(job(1)), q.run(job(2)), q.run(job(3))]);
  assert.deepEqual(order, [1, 2, 3], 'arrival order must be preserved');
  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(maxConcurrent, 1, 'the model session cannot be shared, so never two at once');
});

test('a full queue is a 429 with Retry-After', async () => {
  const q = createQueue({ maxQueue: 1, timeoutMs: 5000 });
  const slow = () => new Promise((r) => setTimeout(() => r('done'), 50));
  const first = q.run(slow);          // takes the slot
  const second = q.run(slow);         // takes the single waiting place
  const err = assertThrows(() => q.run(slow));
  assert.equal(err.status, 429);
  assert.equal(err.headers['Retry-After'], '5');
  assert.match(err.message, /--max-queue 1/);
  await Promise.all([first, second]);
});

test('maxQueue 0 rejects any overlap at all', async () => {
  const q = createQueue({ maxQueue: 0, timeoutMs: 5000 });
  const running = q.run(() => new Promise((r) => setTimeout(r, 30)));
  assert.equal(assertThrows(() => q.run(async () => 'x')).status, 429);
  await running;
});

test('a job that times out while waiting never runs', async () => {
  const q = createQueue({ maxQueue: 5, timeoutMs: 20 });
  let ran = false;
  // The blocker outlives the deadline too, so its own 504 must be swallowed here
  // (the point of this test is what happens to the WAITER behind it).
  const blocker = q.run(() => new Promise((r) => setTimeout(r, 200))).catch(() => {});
  await assert.rejects(q.run(async () => { ran = true; }), (err) => {
    assert.equal(err.status, 504);
    assert.match(err.message, /waiting in the queue/);
    return true;
  });
  await blocker;
  // Give the (now removed) entry every chance to have been picked up.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ran, false, 'a timed-out waiter must be dropped, not run later');
});

test('a running job that overruns rejects the caller and says it keeps running', async () => {
  const q = createQueue({ maxQueue: 5, timeoutMs: 20 });
  let finished = false;
  const p = q.run(async () => { await new Promise((r) => setTimeout(r, 120)); finished = true; return 'late'; });
  await assert.rejects(p, (err) => {
    assert.equal(err.status, 504);
    assert.match(err.message, /cannot be cancelled/);
    return true;
  });
  // The work itself is not interruptible, so it must still complete and free the slot.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(finished, true);
  assert.equal(q.busy, false, 'the slot must be released once the overrunning job ends');
});

test('a job that throws frees the slot for the next one', async () => {
  const q = createQueue({ maxQueue: 5, timeoutMs: 1000 });
  await assert.rejects(q.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await q.run(async () => 'ok'), 'ok');
  assert.deepEqual(q.stats(), { busy: false, waiting: 0, maxQueue: 5 });
});

/** Run `fn`, assert it threw, and return the error for further assertions. */
function assertThrows(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected the call to throw');
}
