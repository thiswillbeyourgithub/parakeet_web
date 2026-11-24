// Opus compression for the remote-mic audio stream (WebCodecs), with the PCM
// path as the fallback whenever either side cannot do it.
//
// Negotiation: the desktop lists `codecs: ['opus']` in its encrypted
// audio-settings only when its AudioDecoder supports Opus; the phone then
// announces `format: 'opus'` in audio-config only when, in addition, its own
// AudioEncoder supports Opus at the capture rate AND that rate is one Opus
// natively runs at (8/12/16/24/48 kHz). Anything else (Safari without
// AudioEncoder, a 44.1 kHz capture, an old desktop) stays on 'pcm-s16'.
// Example: a 48 kHz Android capture to Chrome desktop goes Opus (~6 KB/s
// instead of 96 KB/s); a 44.1 kHz capture to the same desktop stays PCM.
//
// Gotchas this module handles, so callers do not have to:
//   - native rates only: no resampling before the encoder, and the desktop
//     decodes at the same rate, so the rate in audio-config stays the truth
//     (decoded AudioData at any other rate is refused, not resampled);
//   - packets are 20 ms, so they are GROUPED: one encrypted AUDIO frame
//     carries GROUP_PACKETS packets (500 ms, the same cadence as the PCM
//     batches), payload = repeated [uint16 LE length][packet bytes];
//   - decoded length != sent length (Opus pre-skip adds ~6.5 ms of priming at
//     the start and the last frame is padded), so the END frame's totals count
//     PAYLOAD BYTES for Opus instead of samples. The priming is left in: a few
//     ms of leading near-silence are harmless to ASR;
//   - the encoder must be flushed before END (the last partial packet only
//     appears on flush) and the decoder before audio-end is judged (decoding is
//     asynchronous, so the last PCM lands after the last frame arrived).
//
// Built with Claude Code.

export const OPUS_RATES = Object.freeze([8000, 12000, 16000, 24000, 48000]);
export const OPUS_BITRATE = 48000; // mono speech: well above transparency for ASR
export const OPUS_FRAME_US = 20000;
export const GROUP_PACKETS = 25; // 25 x 20 ms = 500 ms per encrypted frame

const configFor = (sampleRate) => ({ codec: 'opus', sampleRate, numberOfChannels: 1 });

async function supported(Codec, config) {
    try {
        if (typeof Codec?.isConfigSupported !== 'function') return false;
        return (await Codec.isConfigSupported(config))?.supported === true;
    } catch (_) {
        return false;
    }
}

/**
 * Probe Opus support at every native rate. Results land in the returned
 * object as they resolve, so callers can read them synchronously later:
 *   const s = probeOpusSupport(); ...later: s.encode[48000] === true
 * Anything not (yet) known reads as unsupported, which falls back to PCM.
 */
export function probeOpusSupport(scope = globalThis) {
    const result = { encode: {}, decode: {} };
    result.ready = Promise.all(OPUS_RATES.flatMap((rate) => [
        supported(scope.AudioEncoder, { ...configFor(rate), bitrate: OPUS_BITRATE }).then((ok) => { result.encode[rate] = ok; }),
        supported(scope.AudioDecoder, configFor(rate)).then((ok) => { result.decode[rate] = ok; }),
    ])).then(() => result);
    return result;
}

/** Phone side: may this recording go out as Opus? */
export function shouldSendOpus({ peerCodecs, sampleRate, support }) {
    return Array.isArray(peerCodecs) && peerCodecs.includes('opus')
        && OPUS_RATES.includes(sampleRate) && support?.encode?.[sampleRate] === true;
}

/** Desktop side: codecs to advertise (any native rate decodable). */
export function advertisedCodecs(support) {
    return OPUS_RATES.some((r) => support?.decode?.[r] === true) ? ['opus'] : [];
}

/** Pack packets as repeated [uint16 LE length][bytes]. */
export function packPackets(packets) {
    const total = packets.reduce((n, p) => n + 2 + p.byteLength, 0);
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let off = 0;
    for (const p of packets) {
        if (p.byteLength > 0xffff) throw new Error('opus packet too large');
        view.setUint16(off, p.byteLength, true);
        out.set(p, off + 2);
        off += 2 + p.byteLength;
    }
    return out;
}

/** Inverse of packPackets; throws on a truncated or empty payload. */
export function unpackPackets(buf) {
    const bytes = new Uint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const packets = [];
    let off = 0;
    while (off < bytes.byteLength) {
        if (off + 2 > bytes.byteLength) throw new Error('truncated opus packet header');
        const len = view.getUint16(off, true);
        if (len === 0 || off + 2 + len > bytes.byteLength) throw new Error('bad opus packet length');
        packets.push(bytes.subarray(off + 2, off + 2 + len));
        off += 2 + len;
    }
    if (packets.length === 0) throw new Error('empty opus frame');
    return packets;
}

/**
 * Phone side encoder. `sendGroup(payload)` is called with each packed group
 * of GROUP_PACKETS packets, in order, synchronously from the output callback
 * (so the caller stamps seqs in packet order).
 * encode(float32) returns the latest send promise, a mild backpressure for the
 * file pump; flush() emits the trailing partial group; close() releases it.
 */
export function createOpusEncoder(sampleRate, sendGroup, onError, scope = globalThis) {
    let pending = [];
    let lastSend = Promise.resolve();
    let timestampUs = 0;
    const emit = () => {
        if (pending.length === 0) return;
        const payload = packPackets(pending);
        pending = [];
        lastSend = Promise.resolve(sendGroup(payload));
    };
    const encoder = new scope.AudioEncoder({
        output: (chunk) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            pending.push(bytes);
            if (pending.length >= GROUP_PACKETS) emit();
        },
        error: (e) => onError(e),
    });
    encoder.configure({ ...configFor(sampleRate), bitrate: OPUS_BITRATE, opus: { frameDuration: OPUS_FRAME_US } });
    return {
        encode(float32) {
            const data = new scope.AudioData({
                format: 'f32', sampleRate, numberOfFrames: float32.length, numberOfChannels: 1,
                timestamp: timestampUs, data: float32.slice(),
            });
            timestampUs += Math.round(float32.length * 1e6 / sampleRate);
            encoder.encode(data);
            data.close?.();
            return lastSend;
        },
        async flush() {
            await encoder.flush();
            emit();
            return lastSend;
        },
        close() {
            try { encoder.close(); } catch (_) { /* already closed */ }
        },
    };
}

/**
 * Desktop side decoder. onPcm(float32) gets mono samples in order; a decoded
 * buffer at another rate than announced is reported through onError and
 * dropped. decode(payload) throws on a malformed group.
 */
export function createOpusDecoder(sampleRate, onPcm, onError, scope = globalThis) {
    let timestampUs = 0;
    const decoder = new scope.AudioDecoder({
        output: (data) => {
            try {
                if (data.sampleRate !== sampleRate) {
                    onError(new Error(`opus decoded at ${data.sampleRate} Hz, expected ${sampleRate}`));
                    return;
                }
                const pcm = new Float32Array(data.numberOfFrames);
                data.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
                onPcm(pcm);
            } finally {
                data.close?.();
            }
        },
        error: (e) => onError(e),
    });
    decoder.configure(configFor(sampleRate));
    return {
        decode(payload) {
            for (const packet of unpackPackets(payload)) {
                decoder.decode(new scope.EncodedAudioChunk({ type: 'key', timestamp: timestampUs, data: packet }));
                timestampUs += OPUS_FRAME_US;
            }
        },
        flush() { return decoder.flush(); },
        close() {
            try { decoder.close(); } catch (_) { /* already closed */ }
        },
    };
}
