// Limits shared by the remote-mic phone page and the desktop receiver, kept in
// one place so the two sides cannot drift apart.
//
// Built with Claude Code.

/**
 * Hard cap on raw (pre-resample) PCM samples per recording. A memory guard, not
 * a duration promise: a compromised phone that completes the handshake but
 * never sends `audio-end` would otherwise grow the desktop's buffer without
 * bound and OOM the tab. It is counted in samples on purpose, because samples
 * are what cost memory (57.6M Float32 = ~230 MB whatever the rate). The
 * wall-clock length therefore depends on the rate: 10 min at 96 kHz, 20 min at
 * 48 kHz, 60 min at 16 kHz. The phone truncates files to the same cap so it
 * never sends samples the desktop would drop.
 */
export const REMOTE_MIC_MAX_SAMPLES = 10 * 60 * 96000;

/**
 * Largest audio file the phone will read. sendFile used to call
 * file.arrayBuffer() and decodeAudioData() before any size check, so picking a
 * multi-GB video held the whole file plus its decoded PCM in memory and could
 * crash the phone tab. 512 MiB holds ~46 min of 48 kHz stereo 16-bit WAV
 * (48000 * 2 ch * 2 B = 192 kB/s), more than the 20 min REMOTE_MIC_MAX_SAMPLES
 * keeps at that rate, and hours of any compressed format, while refusing the
 * pathological cases before reading a byte.
 */
export const FILE_MAX_BYTES = 512 * 1024 * 1024;

/**
 * Largest frame a relay transport accepts from the server, in bytes: binary
 * (AES-GCM IV + ciphertext + tag, as sent) and control (text) frames. Same
 * values as the signaling server's defaults RELAY_LP_FRAME_BODY_LIMIT (256kb)
 * and RELAY_MAX_CONTROL_MSG_BYTES (16 KiB), which an honest relay never
 * forwards past. Kept as plain numbers because the server is a separate
 * CommonJS package. A hostile or broken relay could otherwise make the
 * transport buffer a body of any size.
 */
export const RELAY_FRAME_MAX_BYTES = 256 * 1024;
export const RELAY_CONTROL_MAX_BYTES = 16 * 1024;

/**
 * Range of the remote-mic gain (a GainNode multiplier on the phone). The desktop
 * input clamps to it, and the phone refuses an `audio-settings` gain above the
 * max: it used to accept any finite value >= 0, so a peer could push e.g. 1e6
 * and turn the capture into clipped noise. The phone keeps 0 as its floor (a
 * mute) so that only the upper bound is new behaviour.
 */
export const REMOTE_MIC_GAIN_MIN = 0.5;
export const REMOTE_MIC_GAIN_MAX = 5;

/** Clamp a desktop-side gain to the range above. @param {number} v */
export function clampRemoteMicGain(v) {
    return Math.max(REMOTE_MIC_GAIN_MIN, Math.min(REMOTE_MIC_GAIN_MAX, v));
}

/** Whether the phone applies a received gain. @param {unknown} g */
export function isAcceptedRemoteMicGain(g) {
    return typeof g === 'number' && Number.isFinite(g) && g >= 0 && g <= REMOTE_MIC_GAIN_MAX;
}

/** @param {{size: number}} file */
export function fileTooLargeToDecode(file) {
    return !file || !Number.isFinite(file.size) || file.size > FILE_MAX_BYTES;
}
