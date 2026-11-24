// Integrity framing for the remote-mic audio stream.
//
// Every encrypted binary frame the phone sends carries an 8-byte header INSIDE
// the AES-GCM plaintext, so the header is authenticated along with the audio:
//
//   byte 0      kind: FRAME_AUDIO (0), FRAME_END (1) or FRAME_CONTROL (2)
//   bytes 1-3   reserved, zero
//   bytes 4-7   seq, uint32 little-endian
//   bytes 8..   payload (PCM for AUDIO; END_PAYLOAD for END; UTF-8 JSON for
//               CONTROL, e.g. {"type":"audio-config","sampleRate":48000})
//
// Control messages travel as FRAME_CONTROL once the pair is verified, in both
// directions (each direction has its own key, see deriveSessionKeys). They used
// to be plaintext JSON, so the relay could read the phone's sample rate and
// when it paused, and could inject {"type":"stop"} or a gain of 0. Only the
// handshake (public keys, verify-deny) stays plaintext.
//
// 8 bytes keeps the payload aligned for both Int16Array and Float32Array views.
//
// `seq` is a per-session counter (0, 1, 2, ...) that never resets between
// recordings; a session has its own ECDH-derived key, so frames cannot be
// replayed across sessions, and a session-wide counter means a frame from an
// earlier recording cannot be replayed into a later one either.
//
// A recording ends with one FRAME_END whose payload is the number of AUDIO
// frames and samples the phone sent for that recording:
//   bytes 0-3   chunks, uint32 LE
//   bytes 4-7   samples, uint32 LE
//
// Why: frames used to be bare ciphertext. GCM stops tampering with a single
// frame, but a frame silently dropped (5 s backpressure timeout, relay queue
// overflow, a malicious relay) or reordered produced a truncated or spliced
// recording that was transcribed as if it were whole. The receiver now checks
// contiguous seq and the END totals, and refuses the recording otherwise.
//
// Example, a 3-chunk recording of 8000 samples each:
//   phone sends AUDIO seq 0 (8000), AUDIO seq 1 (8000), AUDIO seq 2 (8000),
//   END seq 3 payload { chunks: 3, samples: 24000 }
//   if seq 1 is lost the receiver sees 0, 2 and reports "expected seq 1, got 2".
//
// Built with Claude Code.

export const FRAME_AUDIO = 0;
export const FRAME_END = 1;
export const FRAME_CONTROL = 2;
export const FRAME_HEADER_BYTES = 8;
const END_PAYLOAD_BYTES = 8;
// Same 4 KiB bound the plaintext control path always had (F-122).
export const CONTROL_MAX_BYTES = 4096;

/**
 * @param {number} kind FRAME_AUDIO, FRAME_END or FRAME_CONTROL
 * @param {number} seq uint32 session sequence number
 * @param {ArrayBufferView|null} payload bytes to append after the header
 * @returns {ArrayBuffer}
 */
export function packFrame(kind, seq, payload) {
    const body = payload
        ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        : new Uint8Array(0);
    const out = new Uint8Array(FRAME_HEADER_BYTES + body.byteLength);
    const view = new DataView(out.buffer);
    view.setUint8(0, kind);
    view.setUint32(4, seq >>> 0, true);
    out.set(body, FRAME_HEADER_BYTES);
    return out.buffer;
}

/** Build the END frame closing a recording. */
export function packEndFrame(seq, { chunks, samples }) {
    const payload = new DataView(new ArrayBuffer(END_PAYLOAD_BYTES));
    payload.setUint32(0, chunks >>> 0, true);
    payload.setUint32(4, samples >>> 0, true);
    return packFrame(FRAME_END, seq, payload);
}

/** Build a CONTROL frame carrying `msg` as JSON. */
export function packControlFrame(seq, msg) {
    const bytes = new TextEncoder().encode(JSON.stringify(msg));
    if (bytes.byteLength > CONTROL_MAX_BYTES) throw new Error('control message too large');
    return packFrame(FRAME_CONTROL, seq, bytes);
}

/** The control message a CONTROL payload carries: a JSON object with a string type. */
function parseControl(payload) {
    if (payload.byteLength > CONTROL_MAX_BYTES) throw new Error('control frame too large');
    const msg = JSON.parse(new TextDecoder().decode(payload));
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        throw new Error('control frame without a type');
    }
    return msg;
}

/**
 * Parse a decrypted frame. Throws on a malformed header.
 * @param {ArrayBuffer} buf
 * @returns {{kind: number, seq: number, payload: ArrayBuffer, end?: {chunks: number, samples: number}, control?: object}}
 */
export function unpackFrame(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < FRAME_HEADER_BYTES) {
        throw new Error('frame shorter than its header');
    }
    const view = new DataView(buf);
    const kind = view.getUint8(0);
    const seq = view.getUint32(4, true);
    const payload = buf.slice(FRAME_HEADER_BYTES);
    if (kind === FRAME_AUDIO) return { kind, seq, payload };
    if (kind === FRAME_END) {
        if (payload.byteLength !== END_PAYLOAD_BYTES) throw new Error('END frame has a bad payload size');
        const p = new DataView(payload);
        return { kind, seq, payload, end: { chunks: p.getUint32(0, true), samples: p.getUint32(4, true) } };
    }
    if (kind === FRAME_CONTROL) return { kind, seq, payload, control: parseControl(payload) };
    throw new Error(`unknown frame kind ${kind}`);
}

/**
 * Sender-side counters: one session-wide seq plus per-recording totals.
 * `nextAudio(samples)` / `nextEnd()` / `nextControl()` return the seq to stamp; call them
 * synchronously when the frame is cut so the seq order is the cut order.
 */
export function createFrameSender() {
    let seq = 0;
    let chunks = 0;
    let samples = 0;
    return {
        beginRecording() { chunks = 0; samples = 0; },
        nextAudio(sampleCount) { chunks += 1; samples += sampleCount; return seq++; },
        nextEnd() { return { seq: seq++, totals: { chunks, samples } }; },
        nextControl() { return seq++; },
    };
}

/**
 * Receiver-side checker. Feed it every successfully decrypted frame (whether or
 * not the receiver keeps the audio), in arrival order, then ask `finish()`
 * whether the current recording arrived whole.
 */
export function createFrameVerifier() {
    let expectedSeq = 0;
    let chunks = 0;
    let samples = 0;
    let problem = null;
    let endOk = false;
    let ended = false;
    return {
        beginRecording() { chunks = 0; samples = 0; problem = null; endOk = false; ended = false; },
        /**
         * @param {{kind:number, seq:number, end?:{chunks:number, samples:number}}} frame
         * @param {number} [sampleCount] samples carried by an AUDIO frame
         */
        accept(frame, sampleCount = 0) {
            if (frame.seq !== expectedSeq && !problem) {
                problem = `expected seq ${expectedSeq}, got ${frame.seq}`;
            }
            // Resync so a later recording can still verify cleanly.
            expectedSeq = frame.seq + 1;
            // Control frames share the seq stream (a lost audio-config shows
            // up as a gap) but carry no audio.
            if (frame.kind === FRAME_CONTROL) return;
            if (frame.kind === FRAME_AUDIO) {
                if (ended && !problem) problem = 'audio after the END frame';
                chunks += 1;
                samples += sampleCount;
                return;
            }
            ended = true;
            if (!problem && (frame.end.chunks !== chunks || frame.end.samples !== samples)) {
                problem = `END says ${frame.end.chunks} chunks / ${frame.end.samples} samples, received ${chunks} / ${samples}`;
            }
            endOk = !problem;
        },
        /**
         * @param {{requireEnd: boolean}} opts requireEnd is false when the
         *   receiver itself stopped the recording (no END will come).
         * @returns {{ok: true} | {ok: false, reason: string}}
         */
        finish({ requireEnd }) {
            if (problem) return { ok: false, reason: problem };
            if (requireEnd && !(ended && endOk)) return { ok: false, reason: 'no valid END frame' };
            return { ok: true };
        },
    };
}

/**
 * Replay guard for the desktop's control frames: the phone obeys a frame only
 * if its seq is above every seq seen so far. Gaps are allowed (a lost
 * audio-settings must not block every later command), going back is not, so a
 * relay cannot replay an old {"type":"stop"}.
 *
 * Example: accept(0) true, accept(2) true, accept(1) false, accept(2) false.
 */
export function createSeqGate() {
    let next = 0;
    return {
        accept(seq) {
            if (!Number.isInteger(seq) || seq < next) return false;
            next = seq + 1;
            return true;
        },
    };
}
