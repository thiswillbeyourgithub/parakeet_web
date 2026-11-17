// Energy-based voice activity detector for the phone's hands-free mode.
//
// Pure and deterministic: no DOM, no timers, no Web Audio. The caller feeds
// mono Float32 chunks of any length (the AudioWorklet posts 128-sample quanta)
// and gets back a list of events describing utterance boundaries. Time is
// counted in samples, so a synthetic signal replays identically in tests.
//
// Per 20 ms frame:
//   - RMS in dBFS; the frame is speech when rms > max(floor + 10 dB, -50 dBFS);
//   - the noise floor then tracks the frame: quickly downwards (alpha 0.2),
//     slowly upwards (alpha 0.005), starting at -60 dBFS.
//
// Utterance lifecycle and the events push()/finish() return:
//   { type: 'onset' }            3 consecutive speech frames: a CANDIDATE
//                                utterance begins (UI can show "speech").
//   { type: 'start', preroll }   the candidate holds >= 250 ms of speech
//                                frames, so it is real speech. `preroll` is
//                                the 400 ms before the onset plus every frame
//                                since, so nothing said is clipped.
//   { type: 'audio', samples }   subsequent audio of a started utterance.
//   { type: 'end' }              900 ms without a speech frame (or finish())
//                                closes a started utterance.
//   { type: 'discard' }          the candidate ended before reaching 250 ms of
//                                speech (click, cough): nothing was emitted
//                                for it, so the caller sends nothing.
// A started utterance reaching 60 s is force-ended and a new one starts at
// once ('end' then 'start' with an empty preroll), so a long monologue is
// sent in pieces instead of hitting the receiver's length cap.
//
// Holding the candidate back until it is confirmed is what makes 'discard'
// free: the caller only opens a recording on 'start', so a cough never reaches
// the wire.
//
// Built with Claude Code.

export const VAD_DEFAULTS = Object.freeze({
    frameMs: 20,
    initialFloorDb: -60,
    floorAlphaDown: 0.2,
    floorAlphaUp: 0.005,
    marginDb: 10,
    minSpeechDb: -50,
    onsetFrames: 3,
    prerollMs: 400,
    hangoverMs: 900,
    minSpeechMs: 250,
    maxUtteranceMs: 60000,
});

// Floor for log10(0) so digital silence yields a finite level.
const SILENCE_DB = -120;

export function rmsDb(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / Math.max(1, frame.length));
    return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
}

function concatFrames(frames) {
    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Float32Array(total);
    let off = 0;
    for (const f of frames) { out.set(f, off); off += f.length; }
    return out;
}

const STATE = { IDLE: 'idle', CANDIDATE: 'candidate', ACTIVE: 'active' };

export function createVad({ sampleRate, ...overrides }) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error(`createVad: invalid sampleRate ${sampleRate}`);
    }
    const p = { ...VAD_DEFAULTS, ...overrides };
    const frameLen = Math.max(1, Math.round(sampleRate * p.frameMs / 1000));
    const framesFor = (ms) => Math.ceil(ms / p.frameMs);
    const prerollFrames = framesFor(p.prerollMs);
    const hangoverFrames = framesFor(p.hangoverMs);
    const minSpeechFrames = framesFor(p.minSpeechMs);
    const maxUtteranceSamples = Math.round(sampleRate * p.maxUtteranceMs / 1000);

    let floorDb = p.initialFloorDb;
    let state = STATE.IDLE;
    // Partial frame carried between push() calls.
    const partial = new Float32Array(frameLen);
    let partialLen = 0;
    // IDLE: ring of the most recent frames (preroll + the onset run).
    let recent = [];
    let speechRun = 0;
    // CANDIDATE: frames held back until the utterance is confirmed.
    let held = [];
    // CANDIDATE / ACTIVE bookkeeping.
    let speechFrames = 0;
    let silenceRun = 0;
    let utteranceSamples = 0;

    function toIdle() {
        state = STATE.IDLE;
        recent = [];
        held = [];
        speechRun = 0;
        speechFrames = 0;
        silenceRun = 0;
        utteranceSamples = 0;
    }

    // Process one full frame, appending events (and ACTIVE audio frames) to `out`.
    function processFrame(frame, out) {
        const db = rmsDb(frame);
        const isSpeech = db > Math.max(floorDb + p.marginDb, p.minSpeechDb);
        floorDb += (db < floorDb ? p.floorAlphaDown : p.floorAlphaUp) * (db - floorDb);

        switch (state) {
            case STATE.IDLE: {
                recent.push(frame);
                if (recent.length > prerollFrames + p.onsetFrames) recent.shift();
                speechRun = isSpeech ? speechRun + 1 : 0;
                if (speechRun >= p.onsetFrames) {
                    state = STATE.CANDIDATE;
                    held = recent;
                    recent = [];
                    speechFrames = speechRun;
                    silenceRun = 0;
                    out.events.push({ type: 'onset' });
                    confirmIfEnough(out);
                }
                return;
            }
            case STATE.CANDIDATE: {
                held.push(frame);
                trackSpeech(isSpeech);
                if (silenceRun >= hangoverFrames) {
                    out.events.push({ type: 'discard' });
                    toIdle();
                    return;
                }
                confirmIfEnough(out);
                return;
            }
            case STATE.ACTIVE: {
                trackSpeech(isSpeech);
                out.audio.push(frame);
                utteranceSamples += frame.length;
                if (silenceRun >= hangoverFrames) {
                    flushAudio(out);
                    out.events.push({ type: 'end' });
                    toIdle();
                } else if (utteranceSamples >= maxUtteranceSamples) {
                    flushAudio(out);
                    out.events.push({ type: 'end' });
                    out.events.push({ type: 'start', preroll: new Float32Array(0) });
                    // silenceRun is carried over: a split landing in a pause
                    // must not restart the 900 ms hangover from zero.
                    speechFrames = 0;
                    utteranceSamples = 0;
                }
                return;
            }
            default:
                throw new Error(`vad: unknown state ${state}`);
        }
    }

    function trackSpeech(isSpeech) {
        if (isSpeech) { speechFrames++; silenceRun = 0; } else { silenceRun++; }
    }

    function confirmIfEnough(out) {
        if (speechFrames < minSpeechFrames) return;
        const preroll = concatFrames(held);
        held = [];
        state = STATE.ACTIVE;
        utteranceSamples = preroll.length;
        out.events.push({ type: 'start', preroll });
    }

    // Coalesce ACTIVE frames gathered so far into a single 'audio' event, so
    // event order stays correct when an 'end' lands mid-chunk.
    function flushAudio(out) {
        if (out.audio.length === 0) return;
        out.events.push({ type: 'audio', samples: concatFrames(out.audio) });
        out.audio = [];
    }

    function push(chunk) {
        const out = { events: [], audio: [] };
        let i = 0;
        while (i < chunk.length) {
            const n = Math.min(frameLen - partialLen, chunk.length - i);
            partial.set(chunk.subarray(i, i + n), partialLen);
            partialLen += n;
            i += n;
            if (partialLen === frameLen) {
                processFrame(partial.slice(), out);
                partialLen = 0;
            }
        }
        flushAudio(out);
        return out.events;
    }

    // Close whatever is in progress (pause, stop, disconnect). The noise
    // floor is kept so resuming does not need to re-learn the room.
    function finish() {
        const events = [];
        if (state === STATE.ACTIVE) events.push({ type: 'end' });
        else if (state === STATE.CANDIDATE) events.push({ type: 'discard' });
        toIdle();
        partialLen = 0;
        return events;
    }

    return {
        push,
        finish,
        get floorDb() { return floorDb; },
        get state() { return state; },
    };
}
