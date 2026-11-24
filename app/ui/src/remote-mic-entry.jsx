/**
 * Phone page for ParakeetWeb remote microphone feature.
 * Built with the help of Claude Code.
 *
 * Opens from QR code URL, captures microphone audio, encrypts it with
 * ECDH + AES-GCM, and streams PCM chunks over a WebRTC data channel
 * to the computer running ParakeetWeb.
 *
 * Supports multiple recordings in a row (Stop → Start New), Pause/Resume,
 * and keeps the screen awake via the Wake Lock API while recording.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteMicRTC } from './lib/remote-webrtc.js';
import {
    generateKeyPair, exportPublicKey, importPublicKey,
    deriveSessionKeys, DIRECTION_PHONE_TO_DESKTOP, DIRECTION_DESKTOP_TO_PHONE
} from './lib/remote-crypto.js';
import {
    waitForDecision, KEY_CONFIRM,
    REMOTE_MIC_PROTOCOL, peerProtocolMatches, mustBeEncrypted
} from './lib/remote-mic-handshake.js';
import { packFrame, packEndFrame, unpackFrame, createSeqGate, FRAME_AUDIO, FRAME_CONTROL } from './lib/remote-mic-frames.js';
import { createFrameChannel } from './lib/remote-mic-channel.js';
import { createSendRatchet, createRecvRatchet } from './lib/remote-mic-rekey.js';
import { probeOpusSupport, shouldSendOpus, createOpusEncoder } from './lib/remote-mic-opus.js';
import { REMOTE_MIC_MAX_SAMPLES, fileTooLargeToDecode, isAcceptedRemoteMicGain } from './lib/remote-mic-limits.js';
import { I18nProvider, useI18n } from './i18n.jsx';
import { acquireKeepalive, releaseKeepalive } from './lib/keepalive.js';
import { verifiedAddModule } from './lib/asset-integrity.js';
import { createLevelMonitor, pickRemoteMicCaptureRate, AUDIO_FILE_ACCEPT } from './lib/audio.js';
import { formatTime } from './lib/format.js';
import { parseRemoteMicLink, parseRemoteMicHash } from './lib/remote-mic-link.js';
import { createVad } from './lib/vad.js';
import { createSerialQueue } from './lib/writeQueue.js';

const STATUS = {
    INIT: 'init',
    CONNECTING: 'connecting',
    RECONNECTING: 'reconnecting', // session dropped, auto-retrying the same room
    WAITING_KEY: 'waiting_key',
    RECORDING: 'recording',
    PAUSED: 'paused',    // audio paused, RTC still open
    READY: 'ready',      // connected, not recording — between recordings
    SENDING_FILE: 'sending_file', // pumping a decoded saved file through the tunnel
    STOPPED: 'stopped',  // RTC closed
    ERROR: 'error',
};

// Statuses during which a desktop session is open (screen kept awake).
const SESSION_STATUSES = new Set([
    STATUS.RECONNECTING, STATUS.WAITING_KEY, STATUS.RECORDING,
    STATUS.PAUSED, STATUS.READY, STATUS.SENDING_FILE,
]);

// Hands-free mode: the mic stays open (STATUS.RECORDING doubles as
// "listening") and the VAD turns each detected utterance into its own
// recording on the wire, so the desktop sees ordinary recordings.
const HANDS_FREE_STORAGE_KEY = 'parakeetweb_remote_mic_hands_free';
const VAD_PHASE = {
    LISTENING: 'listening', // mic open, no speech
    SPEECH: 'speech',       // utterance in progress
    SENDING: 'sending',     // utterance just closed (flush + audio-end)
};
// How long the "sending" indicator stays up after an utterance closes.
const SENDING_INDICATOR_MS = 1000;
// Minimum gap between an audio-end and the next audio-config. The desktop
// clears its per-recording state asynchronously after audio-end and treats
// an audio-config arriving before that as a protocol violation (closing the
// session), so back-to-back utterances (the 60 s forced split) wait here.
// Audio keeps queueing meanwhile, so nothing is lost.
const MIN_RECORDING_GAP_MS = 1500;
// Longest Opus recording kept as a PCM copy for a codec-nack re-send
// (10 min of Int16 is ~19 MB at 16 kHz).
const OPUS_COPY_MAX_SEC = 600;

function loadHandsFree() {
    try { return localStorage.getItem(HANDS_FREE_STORAGE_KEY) === '1'; } catch (_) { return false; }
}

// Global log buffer so we can capture logs before React renders.
// Previously the buffer was an Array with a `_notify` property hung off
// it; that was fragile (Array methods don't preserve own props, two
// concurrent mounts overwrote each other's listener) so it's now a
// plain object with a Set of listeners.
const logBuffer = {
    lines: [],
    listeners: new Set(),
    push(line) {
        this.lines.push(line);
        for (const fn of this.listeners) fn(line);
    },
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    },
    snapshot() { return this.lines.slice(); },
};
// Install console.log/warn/error wrappers that mirror into logBuffer.
// Returns a function that restores the originals — called from the
// component's unmount cleanup so we don't leak a global patch.
function installConsoleCapture() {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    // F-123: JSON.stringify throws on circular refs (RTCPeerConnection events,
    // WasmModule, Error.cause chains). Without this guard the intercept
    // wrapper would propagate the throw back to the original caller and
    // silently drop exactly the rich-object logs a stuck-handshake user
    // needs to see. String(a) can also throw if toString is overridden, so
    // fall through to a constant sentinel.
    const safeStringify = (a) => {
        try { return JSON.stringify(a); } catch {}
        try { return String(a); } catch {}
        return '[unserializable]';
    };
    const intercept = (level, origFn) => (...args) => {
        origFn.apply(console, args);
        const line = `[${level}] ${args.map(a => (typeof a === 'object' && a !== null ? safeStringify(a) : String(a))).join(' ')}`;
        logBuffer.push(line);
    };
    console.log   = intercept('LOG',   orig.log.bind(console));
    console.warn  = intercept('WARN',  orig.warn.bind(console));
    console.error = intercept('ERR',   orig.error.bind(console));
    return () => {
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
    };
}

function RemoteMicSender() {
    const { t, lang, setLang } = useI18n();
    const [status, setStatus] = useState(STATUS.INIT);
    const [errorMsg, setErrorMsg] = useState('');
    const [audioLevel, setAudioLevel] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [logs, setLogs] = useState(() => logBuffer.snapshot());
    const [logsOpen, setLogsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [hasRecorded, setHasRecorded] = useState(false);
    const [sendErrorCount, setSendErrorCount] = useState(0);
    // Saved-file send: 0..1 progress, picked filename, and a non-fatal
    // warning (e.g. the file was truncated to the receiver's length cap).
    const [fileProgress, setFileProgress] = useState(0);
    const [fileName, setFileName] = useState('');
    const [fileWarning, setFileWarning] = useState('');
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    // Auto-reconnect: how many retries we're into the current drop, surfaced
    // in the RECONNECTING UI.
    const [reconnectAttempt, setReconnectAttempt] = useState(0);
    // Camera QR re-scan (WebSend-style): open the rear camera, decode the
    // desktop's QR with jsQR, and re-pair without leaving the page.
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scannerError, setScannerError] = useState('');
    // Handshake waiting for the desktop's key-confirm: { key, gate, channel,
    // resolve } or null. The keys only reach channelRef / controlInRef once
    // the confirm decrypts, so nothing treats the session as bound early.
    const pendingRef = useRef(null);
    // F-137: synchronous handshake-in-progress flag. pendingRef is only set
    // after several awaits (generateKeyPair, importPublicKey, key
    // derivation), so back-to-back public-key messages would otherwise all
    // pass the duplicate guard. Set true before the first await.
    const handshakeInProgressRef = useRef(false);
    const logsEndRef = useRef(null);

    // Room id/secret for the CURRENT pairing, kept in a ref so auto-reconnect
    // (and a camera re-scan) can re-join the same room without re-reading the
    // URL hash (which we scrub right after the first connect). Set on every
    // start(); cleared on a deliberate full disconnect.
    const roomInfoRef = useRef(null);
    // Auto-reconnect bookkeeping. reconnectAttemptsRef counts retries within
    // the current drop (reset to 0 once a session binds), reconnectTimerRef
    // holds the pending backoff timer so teardown can cancel it.
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    // Pointer to the latest start() so the stable reconnect handler can call
    // it without a circular useCallback dependency.
    const startRef = useRef(null);

    // Camera QR scanner state. jsQR is loaded lazily from a vendored,
    // SRI-pinned script (same discipline as the desktop's qrcode.min.js).
    // The camera stream + decode loop are owned by the scanner effect (keyed
    // on scannerOpen); only the <video> element needs a ref here.
    const jsqrLibRef = useRef(null);
    const loadJsQRRef = useRef(null);
    const scanVideoRef = useRef(null);   // <video> showing the camera feed

    const rtcRef = useRef(null);
    // Bound once the pairing is verified (null before): channelRef sends our
    // audio, END and control frames (phone-to-desktop key), controlInRef
    // decrypts the desktop's control frames (desktop-to-phone key) and gates
    // their seq so a replayed frame is refused.
    const channelRef = useRef(null);
    const controlInRef = useRef(null);
    const streamRef = useRef(null);
    const audioCtxRef = useRef(null);
    const workletRef = useRef(null);
    const timerRef = useRef(null);
    const timerStartRef = useRef(null);
    const levelMonitorRef = useRef(null);
    // sourceRef is kept across pause/resume so resume can re-attach a
    // fresh level monitor to the same MediaStreamSource.
    const sourceRef = useRef(null);
    const keepaliveHeldRef = useRef(false);
    // Hidden <input type=file> trigger, and an abort flag the cleanup paths
    // raise so an in-flight saved-file pump stops promptly (disconnect,
    // BFCache eviction, error) instead of pushing into a dead transport.
    const fileInputRef = useRef(null);
    const fileAbortRef = useRef(false);
    // Hands-free mode. The switch is only shown between recordings, so the
    // state is stable for the whole capture; handsFreeRef mirrors it for the
    // callbacks the RTC message handler captured at connect time.
    const [handsFree, setHandsFree] = useState(loadHandsFree);
    const handsFreeRef = useRef(handsFree);
    const [vadPhase, setVadPhase] = useState(VAD_PHASE.LISTENING);
    // While a hands-free capture is open: the VAD, the serial queue its
    // events are handled on (keeps audio-config / frames / audio-end in
    // order across async encrypts), and the capture rate for audio-config.
    const vadRef = useRef(null);
    const vadQueueRef = useRef(null);
    const captureRateRef = useRef(0);
    const lastAudioEndRef = useRef(0);
    const sendingTimerRef = useRef(null);
    // Audio capture settings pushed from the desktop. Defaults match the
    // historical hardcoded values; overwritten when the desktop sends an
    // `audio-settings` control message. Toggles are read inside
    // startMicCapture so each new recording picks up the latest values;
    // `gain` is also pushed live onto gainNodeRef so the slider gives
    // immediate feedback mid-recording.
    const audioSettingsRef = useRef({
        noiseSuppression: true,
        autoGainControl: true,
        gain: 2.0,
    });
    const gainNodeRef = useRef(null);
    // Opus (lib/remote-mic-opus.js): this browser's AudioEncoder support,
    // probed once; the codecs the desktop advertised in audio-settings; and
    // the current recording's encoder as { encoder, failed } or null (PCM).
    const opusSupportRef = useRef(null);
    if (!opusSupportRef.current) opusSupportRef.current = probeOpusSupport();
    const peerCodecsRef = useRef([]);
    const opusRef = useRef(null);
    // Opus fallback: until the computer confirms it decodes our Opus
    // (codec-ok), each Opus recording keeps an Int16 copy so a codec-nack can
    // re-send it as PCM. Capped so a very long first recording cannot exhaust
    // the phone's memory (past the cap a nack loses that recording).
    const opusRejectedRef = useRef(false);
    const opusConfirmedRef = useRef(false);
    const lastOpusRecordingRef = useRef(null);

    // AudioWorklet emits one 128-sample Float32 chunk per render quantum
    // (~125 chunks/sec at 16 kHz, ~375/sec at 48 kHz). The WebRTC data
    // channel and the WS relay both swallow that rate fine, but the HTTP
    // relay fallback POSTs one chunk per binary frame and a cellular link
    // can only push ~10-20 POSTs/sec serially; the 200-frame send queue
    // overflows in seconds and silently drops the rest of the recording.
    // Coalesce worklet quanta into ~500 ms batches so the POST rate drops
    // to ~2/sec, well within the slowest path's headroom. WebRTC/WS pay a
    // ~500 ms minimum latency, which is invisible for batch transcription
    // and acceptable for the live transcriber's 1-2 s windows.
    const SEND_BATCH_MS = 500;
    // Auto-reconnect budget: after an unexpected drop we re-join the SAME room
    // (the desktop keeps the QR up and re-arms it) with exponential backoff,
    // giving up after this many tries so a permanently-dead session lands on
    // the STOPPED screen (where "Scan QR" offers a fresh pairing) instead of
    // hammering the signaling server forever.
    const RECONNECT_MAX_ATTEMPTS = 6;
    const pendingBatchRef = useRef({ buf: null, len: 0 });
    const batchTargetSamplesRef = useRef(0);

    // Saved-file send: decode + downmix to mono ON THE PHONE, then stream the
    // Int16 PCM through the exact same batch framing the mic uses and let the
    // DESKTOP resample to 16 kHz (the proven mic path). We deliberately do NOT
    // resample on the phone: phone-side OfflineAudioContext at 16 kHz is a
    // brand-new code path on iOS Safari (the mic path never resamples on the
    // phone), so avoiding it removes the only iOS-specific risk. We still
    // *request* a 16 kHz decode context, so on platforms that honour it
    // (Chrome, modern Safari) decodeAudioData already yields 16 kHz and the
    // desktop resample is a no-op; otherwise we send native rate and the
    // desktop downsamples exactly as it does for a 48 kHz phone mic.
    const FILE_DECODE_TARGET_RATE = 16000;

    // --- Wake lock + background-throttling helpers (shared with main app) ---
    const acquireWakeLock = useCallback(async () => {
        if (keepaliveHeldRef.current) return;
        keepaliveHeldRef.current = true;
        acquireKeepalive();
    }, []);

    const releaseWakeLock = useCallback(() => {
        if (!keepaliveHeldRef.current) return;
        keepaliveHeldRef.current = false;
        releaseKeepalive();
    }, []);

    // Keep the screen on for the whole session, not just while recording:
    // a phone that sleeps between two dictations suspends the page, which
    // drops the relay and forces a re-scan. The keepalive is ref-counted, so
    // this hold stacks with the recording one above.
    const sessionOpen = SESSION_STATUSES.has(status);
    useEffect(() => {
        if (!sessionOpen) return undefined;
        acquireKeepalive();
        return releaseKeepalive;
    }, [sessionOpen]);

    // --- Audio-only cleanup (keeps RTC alive) ---
    const cleanupAudio = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (levelMonitorRef.current) { levelMonitorRef.current.stop(); levelMonitorRef.current = null; }
        if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null; }
        if (gainNodeRef.current) { try { gainNodeRef.current.disconnect(); } catch (_) {} gainNodeRef.current = null; }
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        sourceRef.current = null;
        pendingBatchRef.current = { buf: null, len: 0 };
        opusRef.current?.encoder.close();
        opusRef.current = null;
        vadRef.current = null;
        vadQueueRef.current = null;
        if (sendingTimerRef.current) { clearTimeout(sendingTimerRef.current); sendingTimerRef.current = null; }
        releaseWakeLock();
    }, [releaseWakeLock]);

    // Persist the mode switch and mirror it into the ref the RTC message
    // handler's callbacks read.
    useEffect(() => {
        handsFreeRef.current = handsFree;
        try { localStorage.setItem(HANDS_FREE_STORAGE_KEY, handsFree ? '1' : '0'); } catch (_) { /* private mode */ }
    }, [handsFree]);

    // Quantise Float32 PCM (range [-1, 1]) to little-endian Int16.
    // Lossless for our pipeline because the desktop writes the WAV at
    // 16-bit anyway (App.jsx createWavBlob), so the Float32 precision
    // is thrown away on arrival. Halves the wire size, which matters
    // on cellular and on the HTTP relay's per-POST overhead.
    function _quantiseFloat32ToInt16(float32) {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            const s = float32[i] < -1 ? -1 : float32[i] > 1 ? 1 : float32[i];
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }

    // Stop the worklet delivering more quanta so a final flush cannot race
    // new audio. Called before tearing a capture down.
    const detachWorklet = useCallback(() => {
        if (workletRef.current) {
            try { workletRef.current.port.onmessage = null; } catch (_) { /* ignore */ }
        }
    }, []);

    // Cut one Int16 audio chunk into a seq-stamped AUDIO frame and send it
    // (lib/remote-mic-channel.js: encrypted, sent in seq order).
    const sendAudioChunk = useCallback((int16) => {
        const ch = channelRef.current;
        if (!ch) return Promise.resolve();
        return ch.send(packFrame(FRAME_AUDIO, ch.sender.nextAudio(int16.length), int16));
    }, []);

    // Encrypted control message to the desktop ({type:'paused'}...); dropped
    // before pairing, when nothing may be sent anyway.
    const sendControl = useCallback((msg) => {
        const ch = channelRef.current;
        return ch ? ch.sendControl(msg) : Promise.resolve();
    }, []);

    // Flush whatever partial batch is pending so the trailing fragment of
    // a recording reaches the desktop. Safe to call multiple times. Does NOT
    // detach the worklet: hands-free mode closes recordings while the mic
    // keeps listening (callers tearing the capture down use detachWorklet).
    const flushPendingBatch = useCallback(async () => {
        const p = pendingBatchRef.current;
        if (!p.buf || p.len === 0) return;
        if (!channelRef.current || !rtcRef.current) {
            pendingBatchRef.current = { buf: null, len: 0 };
            return;
        }
        const int16 = _quantiseFloat32ToInt16(p.buf.subarray(0, p.len));
        pendingBatchRef.current = { buf: null, len: 0 };
        await sendAudioChunk(int16);
    }, [sendAudioChunk]);

    // Append Float32 PCM into the pending batch; once a full batch
    // (batchTargetSamplesRef samples) has accumulated, quantise to Int16,
    // encrypt, and send it over the transport. Shared verbatim by the live
    // AudioWorklet handler and the saved-file pump (sendFile) so both produce
    // the EXACT same on-the-wire framing (audio-config -> Int16 chunks ->
    // audio-end). The snapshot+reset (p.len = 0) is synchronous before the
    // await so concurrent callers append into a fresh batch instead of
    // clobbering the one in flight. Awaiting the returned promise lets the
    // file pump apply backpressure (the worklet handler fires-and-forgets).
    const pushPcmIntoBatch = useCallback(async (float32) => {
        if (!channelRef.current || !rtcRef.current) return;
        // Opus does its own 500 ms grouping (lib/remote-mic-opus.js).
        const opus = opusRef.current;
        if (opus) {
            if (opus.copy && opus.copyLen + float32.length <= OPUS_COPY_MAX_SEC * opus.sampleRate) {
                opus.copy.push(_quantiseFloat32ToInt16(float32));
                opus.copyLen += float32.length;
            } else {
                opus.copy = null;
            }
            return opus.encoder.encode(float32);
        }
        const p = pendingBatchRef.current;
        if (!p.buf) return; // torn down mid-flight
        if (p.len + float32.length > p.buf.length) {
            // Defensive grow: never fires for 128-sample worklet quanta (the
            // buffer carries a +128 headroom), but a file pump may hand in a
            // slice larger than one batch, so size to fit it.
            const grown = new Float32Array(Math.max(p.buf.length * 2, p.len + float32.length));
            grown.set(p.buf.subarray(0, p.len));
            p.buf = grown;
        }
        p.buf.set(float32, p.len);
        p.len += float32.length;
        if (p.len < batchTargetSamplesRef.current) return;

        const int16 = _quantiseFloat32ToInt16(p.buf.subarray(0, p.len));
        p.len = 0;
        await sendAudioChunk(int16);
    }, [sendAudioChunk]);

    // Open a recording on the wire: announce the rate (audio-config, which
    // the desktop also reads as "new recording started") and reset the
    // batch buffer, sized to one batch plus a worklet quantum of headroom.
    // `format: 'pcm-s16'` opts in to Int16 wire encoding (-50% bytes vs
    // Float32, no quality loss because the desktop quantises to Int16 anyway
    // when writing the WAV); older desktops default to 'pcm-f32'. `extra`
    // carries optional hints such as source:'file'.
    // Opus replaces pcm-s16 when both ends support it at this rate
    // (lib/remote-mic-opus.js); each 500 ms group is one AUDIO frame whose
    // integrity unit is its byte length.
    const beginWireRecording = useCallback((sampleRate, extra = {}) => {
        const ch = channelRef.current;
        ch?.sender.beginRecording();
        opusRef.current?.encoder.close();
        opusRef.current = null;
        lastOpusRecordingRef.current = null;
        let format = 'pcm-s16';
        const peerCodecs = opusRejectedRef.current ? [] : peerCodecsRef.current;
        if (ch && shouldSendOpus({ peerCodecs, sampleRate, support: opusSupportRef.current })) {
            try {
                const opus = {
                    failed: false, sampleRate, extra,
                    copy: opusConfirmedRef.current ? null : [], copyLen: 0,
                };
                opus.encoder = createOpusEncoder(sampleRate,
                    (payload) => ch.send(packFrame(FRAME_AUDIO, ch.sender.nextAudio(payload.byteLength), payload)),
                    (err) => {
                        console.warn('[RemoteMic] Opus encode error:', err.message);
                        opus.failed = true;
                        setSendErrorCount((n) => n + 1);
                    });
                opusRef.current = opus;
                format = 'opus';
            } catch (err) {
                console.warn('[RemoteMic] Opus unavailable, sending PCM:', err.message);
            }
        }
        sendControl({ type: 'audio-config', sampleRate, format, ...extra });
        batchTargetSamplesRef.current = Math.max(128, Math.round(sampleRate * SEND_BATCH_MS / 1000));
        pendingBatchRef.current = {
            buf: new Float32Array(batchTargetSamplesRef.current + 128),
            len: 0,
        };
    }, [sendControl]);

    // Close a recording on the wire. Flush before audio-end so the trailing
    // <500 ms that has not filled a batch yet still reaches the desktop. Then
    // an encrypted END frame carries this recording's chunk/sample totals so
    // the desktop can tell a whole recording from a truncated one. All frames
    // enqueue in order on the transport, so audio-end stays the last thing the
    // receiver sees for this recording.
    // With Opus the encoder is flushed first (the trailing partial packet only
    // appears then). An encoder that failed mid-recording lost audio the
    // totals cannot show, so no END is sent and the desktop refuses the
    // recording instead of transcribing a hole.
    const endWireRecording = useCallback(async () => {
        await flushPendingBatch();
        const opus = opusRef.current;
        opusRef.current = null;
        if (opus) {
            try { await opus.encoder.flush(); } catch (_) { opus.failed = true; }
            opus.encoder.close();
            if (opus.copy) lastOpusRecordingRef.current = opus;
        }
        const ch = channelRef.current;
        if (ch) {
            const { seq, totals } = ch.sender.nextEnd();
            if (!opus?.failed) await ch.send(packEndFrame(seq, totals));
            await ch.sendControl({ type: 'audio-end' });
        }
        lastAudioEndRef.current = Date.now();
    }, [flushPendingBatch]);

    // codec-nack: the computer could not decode our Opus. Stop using Opus for
    // the session and re-send the affected recording as PCM from its copy: a
    // live one restarts as PCM and carries on, a finished one is re-sent whole.
    // The PCM frames are stamped synchronously (no await in the loop), so live
    // worklet audio arriving meanwhile still lands after them, in order.
    const handleCodecNack = useCallback(async () => {
        opusRejectedRef.current = true;
        const live = opusRef.current;
        const rec = live ?? lastOpusRecordingRef.current;
        if (!rec?.copy) {
            console.warn('[RemoteMic] Computer could not decode Opus; no copy to re-send');
            return;
        }
        console.warn('[RemoteMic] Computer could not decode Opus, re-sending as PCM');
        if (!live) {
            const wait = lastAudioEndRef.current + MIN_RECORDING_GAP_MS - Date.now();
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            if (opusRef.current || lastOpusRecordingRef.current !== rec) return; // a new recording began
        }
        beginWireRecording(rec.sampleRate, rec.extra);
        const all = new Int16Array(rec.copyLen);
        let off = 0;
        for (const c of rec.copy) { all.set(c, off); off += c.length; }
        const batch = batchTargetSamplesRef.current;
        const sends = [];
        for (let i = 0; i < all.length; i += batch) sends.push(sendAudioChunk(all.subarray(i, i + batch)));
        await Promise.all(sends);
        if (!live) await endWireRecording();
    }, [beginWireRecording, sendAudioChunk, endWireRecording]);

    // Hands-free: act on one VAD event. Always runs on vadQueueRef so events
    // are handled strictly in order, each awaiting its sends.
    const handleVadEvent = useCallback(async (ev) => {
        switch (ev.type) {
            case 'onset':
                setVadPhase(VAD_PHASE.SPEECH);
                return;
            case 'start': {
                setVadPhase(VAD_PHASE.SPEECH);
                const wait = lastAudioEndRef.current + MIN_RECORDING_GAP_MS - Date.now();
                if (wait > 0) await new Promise((r) => setTimeout(r, wait));
                if (!channelRef.current || !rtcRef.current || !vadRef.current) return;
                beginWireRecording(captureRateRef.current);
                setHasRecorded(true);
                // The preroll can hold seconds of held-back audio: feed it in
                // batch-sized slices so no single frame is oversized.
                const batch = batchTargetSamplesRef.current;
                for (let off = 0; off < ev.preroll.length; off += batch) {
                    await pushPcmIntoBatch(ev.preroll.subarray(off, Math.min(off + batch, ev.preroll.length)));
                }
                return;
            }
            case 'audio':
                await pushPcmIntoBatch(ev.samples);
                return;
            case 'end':
                setVadPhase(VAD_PHASE.SENDING);
                await endWireRecording();
                if (sendingTimerRef.current) clearTimeout(sendingTimerRef.current);
                sendingTimerRef.current = setTimeout(() => {
                    sendingTimerRef.current = null;
                    setVadPhase((p) => (p === VAD_PHASE.SENDING ? VAD_PHASE.LISTENING : p));
                }, SENDING_INDICATOR_MS);
                return;
            case 'discard':
                setVadPhase(VAD_PHASE.LISTENING);
                return;
            default:
                console.warn('[RemoteMic] Unknown VAD event:', ev.type);
        }
    }, [beginWireRecording, pushPcmIntoBatch, endWireRecording]);

    // Hands-free: close the utterance in progress, if any (sent if started,
    // dropped if still a candidate). Queued behind every pending event so it
    // lands after the audio already detected.
    const finishUtterance = useCallback(() => {
        const vad = vadRef.current;
        const enqueue = vadQueueRef.current;
        if (!vad || !enqueue) return Promise.resolve();
        return enqueue(async () => {
            for (const ev of vad.finish()) await handleVadEvent(ev);
        });
    }, [handleVadEvent]);

    // End the open capture's audio on the wire before tearing it down: a
    // button-press recording is always open, a hands-free one only while an
    // utterance is in progress.
    const closeCapture = useCallback(async () => {
        detachWorklet();
        if (vadRef.current) await finishUtterance();
        else await endWireRecording();
    }, [detachWorklet, finishUtterance, endWireRecording]);

    // --- Full cleanup (audio + RTC) ---
    const cleanupAll = useCallback(() => {
        // Abort any in-flight saved-file pump so it stops pushing into the
        // transport we're about to tear down.
        fileAbortRef.current = true;
        // Cancel any pending auto-reconnect backoff timer. roomInfoRef and the
        // attempt counter are intentionally left alone: the reconnect handler
        // calls cleanupAll between tries and relies on both surviving. Only a
        // deliberate full disconnect clears roomInfoRef.
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        cleanupAudio();
        if (rtcRef.current) { rtcRef.current.close(); rtcRef.current = null; }
        channelRef.current = null;
        controlInRef.current = null;
        // Fail a pending key-confirm wait so the awaiting Promise in start()
        // does not pin the ECDH private key in a dead closure if cleanup
        // runs mid-handshake.
        const pending = pendingRef.current;
        pendingRef.current = null;
        pending?.resolve(false);
        // F-137: cleanupAll is the funnel for every teardown path; reset the
        // synchronous handshake-in-progress flag so a re-pair can claim a
        // fresh slot. The success path clears it explicitly after binding.
        handshakeInProgressRef.current = false;
    }, [cleanupAudio]);

    useEffect(() => {
        return cleanupAll;
    }, [cleanupAll]);

    // Handle an UNEXPECTED transport loss (rtc.onDisconnected, or a join error
    // while reconnecting). Tears down the dead session but keeps roomInfoRef,
    // then re-joins the same room with exponential backoff. The desktop keeps
    // the same QR on screen and re-arms the room, so a successful re-join just
    // runs the handshake again. Gives up after RECONNECT_MAX_ATTEMPTS, landing
    // on STOPPED where the user can scan a fresh QR. Uses startRef to avoid a
    // circular dependency with start().
    const handleConnectionLost = useCallback(() => {
        cleanupAll();
        if (!roomInfoRef.current) { setStatus(STATUS.STOPPED); return; }
        if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) {
            console.warn('[RemoteMic] Reconnect attempts exhausted, giving up');
            setStatus(STATUS.STOPPED);
            return;
        }
        const attempt = ++reconnectAttemptsRef.current;
        // 1s, 2s, 4s, 8s, 8s, 8s ...
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        setReconnectAttempt(attempt);
        setStatus(STATUS.RECONNECTING);
        console.log(`[RemoteMic] Reconnect attempt ${attempt}/${RECONNECT_MAX_ATTEMPTS} in ${delay}ms`);
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (startRef.current && roomInfoRef.current) startRef.current(roomInfoRef.current);
        }, delay);
    }, [cleanupAll]);

    // Lazily load the vendored, SRI-pinned jsQR decoder. Mirrors the desktop's
    // qrcode.min.js loader (App.jsx): a tampered serving path can't swap the
    // bytes without the integrity check failing. Resolves with the jsQR fn.
    const ensureJsQR = useCallback(() => {
        if (jsqrLibRef.current) return Promise.resolve(jsqrLibRef.current);
        if (loadJsQRRef.current) return loadJsQRRef.current;
        loadJsQRRef.current = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/jsqr.min.js';
            // SRI hash of app/ui/public/js/jsqr.min.js. If you replace that
            // file, recompute with: openssl dgst -sha384 -binary <file> | base64
            script.integrity = 'sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx';
            script.crossOrigin = 'anonymous';
            let settled = false;
            const settle = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
            const timer = setTimeout(() => settle(() => {
                loadJsQRRef.current = null;
                reject(new Error('jsQR script load timed out'));
            }), 15000);
            script.onload = () => settle(() => {
                jsqrLibRef.current = window.jsQR;
                console.log('[RemoteMic] jsQR library loaded');
                resolve(window.jsQR);
            });
            script.onerror = () => settle(() => {
                loadJsQRRef.current = null;
                reject(new Error('jsQR script load error'));
            });
            document.head.appendChild(script);
        });
        loadJsQRRef.current.catch(() => {});
        return loadJsQRRef.current;
    }, []);

    const openScanner = useCallback(() => {
        setScannerError('');
        setScannerOpen(true);
    }, []);

    const closeScanner = useCallback(() => {
        setScannerOpen(false);
    }, []);

    // Drive the rear camera + jsQR decode loop while the scanner is open. Keyed
    // on scannerOpen so the <video> element is guaranteed mounted (refs
    // populated) before we attach the stream, and so the cleanup reliably stops
    // the camera on close, unmount, or a successful scan. On a valid scan we
    // refill the reconnect budget and re-pair with the scanned room (which may
    // be the same room still on the desktop, or a fresh one).
    useEffect(() => {
        if (!scannerOpen) return;
        let cancelled = false;
        let raf = null;
        let stream = null;

        const stop = () => {
            cancelled = true;
            if (raf) cancelAnimationFrame(raf);
            if (stream) stream.getTracks().forEach(track => track.stop());
            const v = scanVideoRef.current;
            if (v) { try { v.srcObject = null; } catch (_) { /* ignore */ } }
        };

        (async () => {
            let jsQR;
            try {
                jsQR = await ensureJsQR();
            } catch (_) {
                if (!cancelled) setScannerError(t('mobileScanLoadError'));
                return;
            }
            if (cancelled) return;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } },
                    audio: false,
                });
            } catch (e) {
                console.warn('[RemoteMic] Camera access failed:', e.message);
                if (!cancelled) {
                    setScannerError(e.name === 'NotAllowedError'
                        ? t('mobileScanCameraDenied')
                        : t('mobileScanCameraFailed'));
                }
                return;
            }
            if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
            const video = scanVideoRef.current;
            if (!video) { stream.getTracks().forEach(track => track.stop()); return; }
            video.srcObject = stream;
            video.setAttribute('playsinline', 'true');
            try { await video.play(); } catch (_) { /* autoplay may need a gesture; the modal opened from one */ }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            const tick = () => {
                if (cancelled) return;
                if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    let imageData;
                    try {
                        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    } catch (_) {
                        // Frame not yet readable; try again next paint.
                        raf = requestAnimationFrame(tick);
                        return;
                    }
                    const result = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: 'dontInvert',
                    });
                    if (result && result.data) {
                        const link = parseRemoteMicLink(result.data, window.location.origin);
                        if (link) {
                            // Fresh manual pairing: refill the auto-reconnect
                            // budget so the new session gets full retries.
                            reconnectAttemptsRef.current = 0;
                            setReconnectAttempt(0);
                            setScannerOpen(false); // runs stop() via cleanup
                            if (startRef.current) startRef.current(link);
                            return;
                        }
                        // A QR that isn't one of ours: keep scanning, hint why.
                        setScannerError(t('mobileScanWrongQr'));
                    }
                }
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        })();

        return stop;
    }, [scannerOpen, ensureJsQR, t]);

    // F-131: BFCache hardening on the phone side. Mirror App.jsx's
    // pagehide/pageshow pattern so a phone parked in BFCache mid-session
    // (Home button, app-switcher, deep link) does not revive with a stale
    // MediaStream + AES-GCM session keys + ECDH private CryptoKey pinned in
    // memory. On pagehide(persisted=true) tear down the session; on
    // pageshow(persisted=true) reload so the user lands on a fresh INIT
    // state and must re-scan QR to re-pair.
    useEffect(() => {
        const handlePageHide = (e) => { if (e.persisted) cleanupAll(); };
        const handlePageShow = (e) => { if (e.persisted) window.location.reload(); };
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('pageshow', handlePageShow);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('pageshow', handlePageShow);
        };
    }, [cleanupAll]);

    // Install console capture and subscribe to log buffer updates.
    useEffect(() => {
        const restoreConsole = installConsoleCapture();
        const unsubscribe = logBuffer.subscribe((line) => {
            setLogs(prev => [...prev, line]);
        });
        return () => { unsubscribe(); restoreConsole(); };
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        if (logsOpen && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, logsOpen]);

    // `override` ({ roomId, secret }) re-joins a known room without re-reading
    // the URL hash: used by auto-reconnect and the camera re-scan. Without it
    // start() parses the hash exactly as on the initial deep-link open.
    const start = useCallback(async (override = null) => {
        // Hoisted so the catch block below can clear it on early failure;
        // otherwise a join error left the timer to fire 30s later and call
        // rtc.close() on an already-closed connection.
        let keyTimeout = null;
        // Whether this attempt is a reconnect (auto-retry or re-scan) vs the
        // first deep-link connect, so the catch can retry instead of erroring.
        const isReconnect = !!override;
        try {
            let roomId, secret, qrSecret;
            if (override) {
                ({ roomId, secret, qrSecret } = override);
            } else {
                // Parse room info from the URL hash: #roomId:secret:K
                // (lib/remote-mic-link.js). A v3 link without K is refused.
                const hash = window.location.hash.substring(1);
                const link = parseRemoteMicHash(hash);
                if (!link) {
                    setStatus(STATUS.ERROR);
                    setErrorMsg(t(hash.includes(':') ? 'mobileInvalidLinkMissing' : 'mobileInvalidLink'));
                    return;
                }
                ({ roomId, secret, qrSecret } = link);

                // Scrub the secret out of the visible URL before the browser
                // commits it to history / autocomplete / Chrome Sync / OBS
                // screenshots of the phone. The secret now lives only in
                // roomInfoRef for the duration of the session.
                try {
                    window.history.replaceState(
                        null,
                        document.title,
                        window.location.pathname + window.location.search
                    );
                } catch (_) {
                    // history.replaceState is allowed on same-origin pages; if a
                    // sandboxing edge case blocks it we still proceed because the
                    // attack surface is the long-term hash residue, not the
                    // single-page lifetime in memory.
                }
            }

            // Remember the room so auto-reconnect / re-scan can rejoin it.
            roomInfoRef.current = { roomId, secret, qrSecret };

            // A fresh deep-link connect resets the reconnect budget; an
            // auto-retry keeps counting (handleConnectionLost owns the count).
            if (!isReconnect) reconnectAttemptsRef.current = 0;

            // CONNECTING means "actively dialing". The RECONNECTING status is
            // owned by handleConnectionLost for the backoff wait between tries.
            setStatus(STATUS.CONNECTING);

            // Connect to signaling server
            const rtc = new RemoteMicRTC('/api/signal');
            rtcRef.current = rtc;

            await rtc.init();

            rtc.onDisconnected = () => {
                // Unexpected drop: auto-reconnect to the same room (the desktop
                // keeps its QR up and re-arms). Gives up to STOPPED after the
                // retry budget is spent.
                handleConnectionLost();
            };

            // Surface dropped/failed sends so the user sees data loss instead
            // of "connected" while audio quietly disappears.
            rtc.onSendError = (stage, reason) => {
                setSendErrorCount((n) => n + 1);
                console.warn(`[RemoteMic] send-error stage=${stage} reason=${reason}`);
            };

            // If the receiver never sends its public key, give up after 30s
            // instead of hanging in CONNECTING/WAITING_KEY forever.
            keyTimeout = setTimeout(() => {
                if (!channelRef.current) {
                    console.warn('[RemoteMic] Timed out waiting for receiver public key');
                    setErrorMsg(t('mobileConnectionError'));
                    setStatus(STATUS.ERROR);
                    rtc.close();
                }
            }, 30000);

            // A control message from the desktop, already decrypted and
            // seq-checked (only FRAME_CONTROL frames reach this).
            const handleDesktopControl = (msg) => {
                if (msg.type === 'stop-recording') {
                    // Computer requested end of current recording (keep connection alive)
                    stopRecording();
                } else if (msg.type === 'stop') {
                    // Computer requested full disconnect
                    stopAndDisconnect();
                } else if (msg.type === 'pause') {
                    // Computer requested pause
                    pauseRecording();
                } else if (msg.type === 'resume') {
                    // Computer requested resume
                    resumeRecording();
                } else if (msg.type === 'codec-nack' && msg.codec === 'opus') {
                    handleCodecNack();
                } else if (msg.type === 'codec-ok' && msg.codec === 'opus') {
                    // Opus proven to work: stop keeping PCM copies.
                    opusConfirmedRef.current = true;
                    lastOpusRecordingRef.current = null;
                    if (opusRef.current) opusRef.current.copy = null;
                } else if (msg.type === 'audio-settings') {
                    // Desktop is pushing the user's audio toggles.
                    // Toggles are stored; getUserMedia constraints
                    // are applied on the next startMicCapture
                    // (mid-recording changes don't retroactively
                    // mutate an active track). Gain is also pushed
                    // live onto the active GainNode so the slider
                    // moves the volume in real time.
                    if (typeof msg.noiseSuppression === 'boolean') {
                        audioSettingsRef.current.noiseSuppression = msg.noiseSuppression;
                    }
                    if (typeof msg.autoGainControl === 'boolean') {
                        audioSettingsRef.current.autoGainControl = msg.autoGainControl;
                    }
                    // Codecs the computer can decode; anything not an array
                    // of strings means PCM only. Applies from the next recording.
                    peerCodecsRef.current = Array.isArray(msg.codecs) && msg.codecs.every((c) => typeof c === 'string')
                        ? msg.codecs : [];
                    if (isAcceptedRemoteMicGain(msg.gain)) {
                        audioSettingsRef.current.gain = msg.gain;
                        if (gainNodeRef.current && audioCtxRef.current) {
                            // Ramp instead of step to avoid an
                            // audible click when the slider moves.
                            try {
                                gainNodeRef.current.gain.setTargetAtTime(
                                    msg.gain,
                                    audioCtxRef.current.currentTime,
                                    0.02,
                                );
                            } catch (e) {
                                gainNodeRef.current.gain.value = msg.gain;
                            }
                        }
                    }
                } else {
                    console.warn(`[RemoteMic] Unknown control ${msg.type}`);
                }
            };
            // Desktop control frames are decrypted on one serial queue so they
            // apply in the order they were sent.
            const controlQueue = createSerialQueue();
            const onBinary = (data) => controlQueue(async () => {
                const ctl = controlInRef.current;
                if (!ctl) {
                    // Handshake pending: the only acceptable frame is the
                    // desktop's key-confirm at seq 0. Anything else, or a
                    // frame that does not decrypt, fails the pairing.
                    const pending = pendingRef.current;
                    if (!pending) return; // before pairing nothing binary is expected
                    try {
                        const frame = unpackFrame(await pending.key.decrypt(data));
                        const ok = frame.kind === FRAME_CONTROL && frame.seq === 0 && frame.control.type === KEY_CONFIRM.type;
                        if (ok) {
                            // Bind HERE, synchronously, so the next queued
                            // frame already finds the session keys.
                            pending.gate.accept(frame.seq);
                            channelRef.current = pending.channel;
                            controlInRef.current = { key: pending.key, gate: pending.gate };
                        }
                        pending.resolve(ok);
                    } catch (e) {
                        console.warn('[RemoteMic] Key-confirm frame did not decrypt:', e.message);
                        pending.resolve(false);
                    }
                    return;
                }
                try {
                    const frame = unpackFrame(await ctl.key.decrypt(data));
                    if (frame.kind !== FRAME_CONTROL || !ctl.gate.accept(frame.seq)) {
                        console.warn('[RemoteMic] Dropping unexpected or replayed frame from the computer');
                        return;
                    }
                    handleDesktopControl(frame.control);
                } catch (e) {
                    console.warn('[RemoteMic] Undecryptable frame from the computer:', e.message);
                }
            });

            // Handshake messages arrive as JSON text, control frames as
            // encrypted binary.
            rtc.onMessage = async (data) => {
                if (typeof data === 'string') {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.type === 'public-key') {
                            // F-135: refuse a second handshake once one is in
                            // flight or already bound. Mirrors the desktop's
                            // F-86 guard (App.jsx:1448). Without this, a
                            // hostile peer can re-send public-key mid-handshake
                            // and orphan the prior ECDH private key.
                            //
                            // F-137: include the synchronous in-progress flag.
                            // The other refs are only populated after several
                            // awaits below, so a flood of public-key messages
                            // would all pass this guard before any of them
                            // reached the pendingRef assignment.
                            if (channelRef.current || pendingRef.current || handshakeInProgressRef.current) {
                                console.warn('[RemoteMic] Ignoring duplicate public-key, handshake already bound or in-flight');
                                return;
                            }
                            handshakeInProgressRef.current = true;
                            clearTimeout(keyTimeout);
                            if (!peerProtocolMatches(msg)) {
                                // An old (or newer) computer page: it would not
                                // understand our frames, say so instead.
                                console.warn(`[RemoteMic] Computer speaks protocol ${msg.v}, we speak ${REMOTE_MIC_PROTOCOL}`);
                                rtc.sendMessage({ type: 'verify-deny' });
                                setErrorMsg(t('remoteMicComputerVersionMismatch'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                                return;
                            }
                            setStatus(STATUS.WAITING_KEY);
                            const keyPair = await generateKeyPair();
                            const theirKey = await importPublicKey(msg.key);
                            // The QR secret K (never seen by the signaling
                            // server) is mixed into HKDF: a relay that swapped
                            // public keys derives different keys and the
                            // key-confirm frames below fail to decrypt.
                            const sessionKeys = await deriveSessionKeys(keyPair.privateKey, theirKey, {
                                receiverPub: theirKey,
                                senderPub: keyPair.publicKey,
                                qrSecret: roomInfoRef.current?.qrSecret,
                            });
                            const ourKeyBase64 = await exportPublicKey(keyPair.publicKey);
                            rtc.sendMessage({ type: 'sender-public-key', key: ourKeyBase64, v: REMOTE_MIC_PROTOCOL });

                            // Key confirmation: send our encrypted key-confirm
                            // and wait for the computer's. onBinary binds the
                            // session synchronously when it decrypts.
                            const confirmed = await waitForDecision((resolve) => {
                                const channel = createFrameChannel(createSendRatchet(sessionKeys.master, DIRECTION_PHONE_TO_DESKTOP), rtc, (err) => {
                                    console.warn('[RemoteMic] Encrypt/send error:', err.message);
                                    setSendErrorCount((n) => n + 1);
                                });
                                pendingRef.current = { key: createRecvRatchet(sessionKeys.master, DIRECTION_DESKTOP_TO_PHONE), gate: createSeqGate(), channel, resolve };
                                channel.sendControl(KEY_CONFIRM);
                            });
                            pendingRef.current = null;
                            handshakeInProgressRef.current = false;
                            if (!confirmed || !channelRef.current) {
                                console.warn('[RemoteMic] Key confirmation failed, aborting');
                                rtc.sendMessage({ type: 'verify-deny' });
                                setErrorMsg(t('remoteMicKeyConfirmFailed'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                                return;
                            }
                            // Session bound: a stable connection refills the
                            // auto-reconnect budget for the next drop.
                            reconnectAttemptsRef.current = 0;
                            setReconnectAttempt(0);
                            setStatus(STATUS.READY);
                        } else if (msg.type === 'verify-deny') {
                            if (pendingRef.current) {
                                pendingRef.current.resolve(false);
                            } else if (channelRef.current) {
                                // F-136: once bound, verify-deny is a stale
                                // control message and must be ignored.
                                console.warn('[RemoteMic] Ignoring verify-deny after session bound');
                            } else {
                                setErrorMsg(t('remoteMicKeyConfirmFailed'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                            }
                        } else if (mustBeEncrypted(msg)) {
                            // Only the relay (or a peer on another protocol)
                            // sends these in plaintext.
                            console.warn(`[RemoteMic] Dropping plaintext ${msg.type}`);
                        }
                    } catch (e) {
                        console.error('[RemoteMic] Error handling message:', e);
                    }
                } else {
                    await onBinary(data);
                }
            };

            // Join the room (creates WebRTC connection)
            await rtc.joinRoom(roomId, secret);

        } catch (e) {
            if (keyTimeout) clearTimeout(keyTimeout);
            console.error('[RemoteMic] Connection error:', e);
            if (isReconnect) {
                // The room may not be re-armed yet (desktop still tearing the
                // old session down) so a join error here is expected: keep
                // retrying on the backoff schedule instead of dead-ending.
                handleConnectionLost();
            } else {
                setStatus(STATUS.ERROR);
                setErrorMsg(e.message || t('mobileConnectionError'));
            }
        }
    }, [cleanupAll, t, handleConnectionLost]);

    const startMicCapture = useCallback(async () => {
        try {
            // Request microphone access. Toggles come from the desktop
            // (audio-settings message) so the phone honours the same user
            // preferences as the local mic path.
            const { noiseSuppression, autoGainControl } = audioSettingsRef.current;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: { ideal: 16000 },
                    noiseSuppression,
                    autoGainControl,
                }
            });
            streamRef.current = stream;

            // Pick the capture rate. We stream PCM over WebRTC, so 16 kHz keeps
            // the wire small. Forcing a 16 kHz AudioContext is safe on browsers
            // that report the mic rate and resample a live mic correctly
            // (Chrome/Safari); Firefox reports no rate and mislabels the
            // downsampled live stream when the context rate differs from the mic
            // (mdn/browser-compat-data #16213), which streamed ~3x slowed audio.
            // For those, capture at the native rate and let the desktop resample.
            // See pickRemoteMicCaptureRate.
            const reportedRate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
            const requestedRate = pickRemoteMicCaptureRate(reportedRate);
            let audioCtx;
            try {
                audioCtx = new AudioContext(requestedRate ? { sampleRate: requestedRate } : undefined);
            } catch (e) {
                console.warn('[RemoteMic] AudioContext at requested rate failed, using default:', e.message);
                audioCtx = new AudioContext();
            }
            audioCtxRef.current = audioCtx;

            const actualRate = audioCtx.sampleRate;
            console.log(`[RemoteMic] Capture rate: requested=${requestedRate ?? 'native'} reported=${reportedRate ?? 'n/a'} actual=${actualRate}`);

            // Button press: the recording starts now. Hands-free: the mic only
            // listens; each utterance the VAD detects opens its own recording.
            const handsFreeCapture = handsFreeRef.current;
            captureRateRef.current = actualRate;
            if (handsFreeCapture) {
                vadRef.current = createVad({ sampleRate: actualRate });
                vadQueueRef.current = createSerialQueue();
                setVadPhase(VAD_PHASE.LISTENING);
            } else {
                beginWireRecording(actualRate);
            }

            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;

            // GainNode between source and worklet so the desktop's
            // remoteMicGain slider boosts (or attenuates) the signal
            // before it's encoded and sent. Default 2.0 because phone
            // AGC tends to under-amplify a close voice.
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = audioSettingsRef.current.gain;
            gainNodeRef.current = gainNode;

            // Level monitor reads post-gain so the bar reflects what's
            // actually being sent. createLevelMonitor connects its own
            // analyser to whatever node we pass in.
            levelMonitorRef.current = createLevelMonitor(audioCtx, gainNode, setAudioLevel);

            // PCM capture via AudioWorklet (same worklet as main app)
            await verifiedAddModule(audioCtx.audioWorklet, '/pcm-recorder-worklet.js');
            const worklet = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor');
            workletRef.current = worklet;

            worklet.port.onmessage = (e) => {
                const pcmChunk = e.data; // Float32Array
                // Defensive: the worklet should only ever post 128-sample
                // Float32Arrays. Anything else is a bug or a hijacked port.
                if (!(pcmChunk instanceof Float32Array)) {
                    console.warn('[RemoteMic] Dropping non-Float32 worklet payload:', typeof pcmChunk);
                    return;
                }
                const vad = vadRef.current;
                const enqueue = vadQueueRef.current;
                if (handsFreeCapture) {
                    if (!vad || !enqueue) return; // torn down
                    for (const ev of vad.push(pcmChunk)) enqueue(() => handleVadEvent(ev));
                    return;
                }
                // Fire-and-forget: the worklet is rate-limited by real time,
                // so backpressure is handled inside sendBinary. The file pump
                // (sendFile) instead awaits pushPcmIntoBatch for pacing.
                pushPcmIntoBatch(pcmChunk);
            };

            source.connect(gainNode);
            gainNode.connect(worklet);
            // AudioWorklet needs a destination to process (even if silent)
            worklet.connect(audioCtx.destination);

            setStatus(STATUS.RECORDING);
            if (!handsFreeCapture) setHasRecorded(true);
            setElapsed(0);

            // Start elapsed timer
            timerStartRef.current = Date.now();
            timerRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000));
            }, 1000);

            // Prevent screen from sleeping
            await acquireWakeLock();

        } catch (e) {
            console.error('[RemoteMic] Mic capture error:', e);
            setStatus(STATUS.ERROR);
            if (e.name === 'NotAllowedError') {
                setErrorMsg(t('mobileMicDenied'));
            } else {
                setErrorMsg(t('mobileMicFailed') + e.message);
            }
        }
    }, [acquireWakeLock, t, pushPcmIntoBatch, beginWireRecording, handleVadEvent]);

    // Decode a saved audio file ON THE PHONE and stream it through the SAME
    // encrypted Int16 tunnel the live mic uses (audio-config -> chunks ->
    // audio-end). The desktop receiver treats the stream as opaque PCM, so it
    // chunks/resamples/transcribes a file exactly like a recording with zero
    // receiver-side changes. The file is decoded and encrypted locally, so the
    // signaling server and relay still only ever see ciphertext. Paced via
    // rtc.drain() so the all-at-once decode does not flood the transport and
    // trip sendBinary's drop path.
    const sendFile = useCallback(async (file) => {
        if (!file) return;
        // Reuse the recording gate: only stream once the handshake is bound.
        if (!channelRef.current || !rtcRef.current) {
            console.warn('[RemoteMic] Ignoring file send — not connected/verified');
            return;
        }
        // Refuse a huge file BEFORE arrayBuffer()/decodeAudioData() pull it
        // (and its decoded PCM) into memory.
        if (fileTooLargeToDecode(file)) {
            console.warn(`[RemoteMic] File of ${file.size} bytes is too large to decode`);
            setFileWarning(t('mobileFileTooLarge'));
            return;
        }
        fileAbortRef.current = false;
        let configSent = false;
        let decodeCtx = null;
        setFileWarning('');
        setFileName(file.name);
        setFileProgress(0);
        setStatus(STATUS.SENDING_FILE);

        try {
            // 1. Decode, requesting a 16 kHz context (honoured on Chrome/modern
            //    Safari -> no desktop resample needed; ignored elsewhere -> we
            //    send native rate and the desktop downsamples). The browser's
            //    own hardened decoder rejects malformed files here, so nothing
            //    bad reaches the wire.
            const arrayBuf = await file.arrayBuffer();
            try {
                decodeCtx = new AudioContext({ sampleRate: FILE_DECODE_TARGET_RATE });
            } catch (_) {
                decodeCtx = new AudioContext();
            }
            const decoded = await decodeCtx.decodeAudioData(arrayBuf);
            const sentRate = decoded.sampleRate; // actual rate of the decoded PCM

            // 2. Downmix to mono. No phone-side resample (see constant comment):
            //    the desktop resamples whatever rate we report, exactly as it
            //    does for a live phone mic.
            const nCh = decoded.numberOfChannels;
            let mono;
            if (nCh <= 1) {
                mono = decoded.getChannelData(0).slice();
            } else {
                mono = new Float32Array(decoded.length);
                for (let c = 0; c < nCh; c++) {
                    const ch = decoded.getChannelData(c);
                    for (let i = 0; i < ch.length; i++) mono[i] += ch[i];
                }
                for (let i = 0; i < mono.length; i++) mono[i] /= nCh;
            }

            // 3. Truncate to the receiver's raw-sample cap, warn if we did.
            if (mono.length > REMOTE_MIC_MAX_SAMPLES) {
                console.warn(`[RemoteMic] File ${mono.length} samples exceeds cap ${REMOTE_MIC_MAX_SAMPLES}, truncating`);
                mono = mono.subarray(0, REMOTE_MIC_MAX_SAMPLES);
                setFileWarning(t('mobileFileTruncated'));
            }
            if (fileAbortRef.current || !channelRef.current || !rtcRef.current) return;

            // 4. Announce config and reset the batch buffer (identical framing
            //    to a live recording) at the decoded rate. source:'file' is an
            //    optional hint older desktops ignore.
            beginWireRecording(sentRate, { source: 'file' });
            configSent = true;
            setHasRecorded(true);

            // 5. Paced pump: one batch worth at a time, awaiting the send and a
            //    drain so we throttle to the link instead of overrunning it.
            const batch = batchTargetSamplesRef.current;
            const total = mono.length;
            for (let off = 0; off < total; off += batch) {
                if (fileAbortRef.current || !channelRef.current || !rtcRef.current) {
                    console.warn('[RemoteMic] File send aborted mid-pump');
                    // User cancelled while the transport is still alive: finalise
                    // in order (flush + audio-end) so the desktop transcribes what
                    // it received. A disconnect-driven abort instead nulls rtcRef
                    // and owns its own teardown, so we just return there.
                    if (rtcRef.current) {
                        try { await endWireRecording(); } catch (_) { /* ignore */ }
                        setStatus(STATUS.READY);
                    }
                    return;
                }
                await pushPcmIntoBatch(mono.subarray(off, Math.min(off + batch, total)));
                await rtcRef.current.drain();
                setFileProgress(Math.min(1, (off + batch) / total));
            }
            if (fileAbortRef.current || !rtcRef.current) return;

            // 6. Flush trailing partial batch, then close the recording.
            await endWireRecording();
            setFileProgress(1);
            setStatus(STATUS.READY);
        } catch (e) {
            console.error('[RemoteMic] File send error:', e);
            // The tunnel is independent of file problems, so keep the session
            // alive (no rescan needed) and let the user pick another file. If
            // we already announced audio-config, close the recording cleanly
            // so the desktop finalises what it got instead of waiting forever.
            if (configSent && rtcRef.current) {
                try { await endWireRecording(); } catch (_) { /* ignore */ }
            }
            setFileWarning(
                (e?.name === 'EncodingError' || e?.name === 'NotSupportedError')
                    ? t('mobileFileDecodeError')
                    : (t('mobileFileSendError') + (e?.message || ''))
            );
            setStatus(STATUS.READY);
        } finally {
            if (decodeCtx) { try { await decodeCtx.close(); } catch (_) { /* ignore */ } }
        }
    }, [t, beginWireRecording, pushPcmIntoBatch, endWireRecording]);

    // Cancel an in-flight saved-file send. The pump detects the flag on its
    // next iteration and finalises the recording in order (see sendFile).
    const cancelFileSend = useCallback(() => {
        fileAbortRef.current = true;
    }, []);

    // Stop current recording (hands-free: stop listening, sending the
    // utterance in progress) but keep RTC alive for the next one.
    const stopRecording = useCallback(async () => {
        await closeCapture();
        cleanupAudio();
        setAudioLevel(0);
        setStatus(STATUS.READY);
    }, [cleanupAudio, closeCapture]);

    // Pause: suspend AudioContext (no data sent, timer paused). Hands-free
    // closes the utterance in progress instead of leaving it open across the
    // pause, and sends no paused/resumed (the desktop only honours them
    // inside a recording, and there is none between utterances).
    const pauseRecording = useCallback(() => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
            audioCtxRef.current.suspend().catch(() => {});
        }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (levelMonitorRef.current) { levelMonitorRef.current.stop(); levelMonitorRef.current = null; }
        releaseWakeLock();
        setAudioLevel(0);
        setStatus(STATUS.PAUSED);
        if (vadRef.current) {
            finishUtterance();
        } else if (rtcRef.current) {
            sendControl({ type: 'paused' });
        }
    }, [releaseWakeLock, finishUtterance, sendControl]);

    // Resume from pause
    const resumeRecording = useCallback(async () => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
            await audioCtxRef.current.resume().catch(() => {});
        }
        // Re-attach level monitor to the post-gain node so the bar
        // reflects the boosted signal that's actually being sent.
        if (audioCtxRef.current && (gainNodeRef.current || sourceRef.current)) {
            const tap = gainNodeRef.current || sourceRef.current;
            levelMonitorRef.current = createLevelMonitor(audioCtxRef.current, tap, setAudioLevel);
        }
        // Resume timer (adjust startRef so elapsed continues from where it left off)
        timerStartRef.current = Date.now() - elapsed * 1000;
        timerRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000));
        }, 1000);
        await acquireWakeLock();
        setStatus(STATUS.RECORDING);
        if (vadRef.current) {
            setVadPhase(VAD_PHASE.LISTENING);
        } else if (rtcRef.current) {
            sendControl({ type: 'resumed' });
        }
    }, [elapsed, acquireWakeLock, sendControl]);

    // Full disconnect — close RTC, show goodbye screen. This is a DELIBERATE
    // teardown (user tapped Disconnect, or the desktop sent 'stop'), so clear
    // roomInfoRef and reset the retry budget: we must NOT auto-reconnect.
    const stopAndDisconnect = useCallback(async () => {
        await closeCapture();
        roomInfoRef.current = null;
        reconnectAttemptsRef.current = 0;
        setReconnectAttempt(0);
        cleanupAll();
        setAudioLevel(0);
        setStatus(STATUS.STOPPED);
    }, [cleanupAll, closeCapture]);

    // Keep startRef pointing at the latest start() so the stable
    // handleConnectionLost can re-invoke it without depending on it.
    useEffect(() => { startRef.current = start; }, [start]);

    // Auto-start on mount
    useEffect(() => {
        start();
    }, [start]);

    const audioHint = audioLevel < 5 ? t('mobileNoAudio')
        : audioLevel < 20 ? t('mobileSpeakLouder')
        : t('mobileGoodLevel');

    // Live indicator colour/label: button-press recording is red; hands-free
    // is blue while listening, red on speech, green while sending; paused is
    // amber in both modes.
    const HANDS_FREE_PHASE_UI = {
        [VAD_PHASE.LISTENING]: { color: '#60a5fa', rgb: '96,165,250', label: t('mobileListening') },
        [VAD_PHASE.SPEECH]: { color: '#ef4444', rgb: '239,68,68', label: t('mobileSpeechDetected') },
        [VAD_PHASE.SENDING]: { color: '#10b981', rgb: '16,185,129', label: t('mobileSendingUtterance') },
    };
    const captureUi = status === STATUS.PAUSED
        ? { color: '#fbbf24', rgb: '251,191,36', label: t('mobilePaused') }
        : handsFree
            ? HANDS_FREE_PHASE_UI[vadPhase]
            : { color: '#ef4444', rgb: '239,68,68', label: t('mobileRecording') };

    return (
        <div style={{ textAlign: 'center', position: 'relative' }}>

            {/* Hidden picker for the "Send a file" action. Reset value on
                change so re-picking the same file fires onChange again. */}
            <input
                ref={fileInputRef}
                type="file"
                accept={AUDIO_FILE_ACCEPT}
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (f) sendFile(f);
                }}
            />

            {/* Top-right menu button — always visible */}
            <button
                onClick={() => setMenuOpen(true)}
                aria-label={t('mobileOpenMenu')}
                style={styles.menuButton}
            >
                {t('mobileOpenMenu')}
            </button>

            {/* Sidebar overlay */}
            {menuOpen && (
                <div
                    onClick={() => setMenuOpen(false)}
                    style={styles.sidebarOverlay}
                />
            )}

            {/* Sidebar drawer */}
            <div style={{
                ...styles.sidebar,
                transform: menuOpen ? 'translateX(0)' : 'translateX(100%)',
            }}>
                <button onClick={() => setMenuOpen(false)} style={styles.sidebarCloseBtn}>
                    {t('mobileCloseMenu')}
                </button>

                {/* Language section */}
                <div style={styles.sidebarSection}>
                    <p style={styles.sidebarHeading}>{t('mobileLanguageHeading')}</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => setLang('en')}
                            style={{ ...styles.langBtn, ...(lang === 'en' ? styles.langBtnActive : {}) }}
                        >
                            English
                        </button>
                        <button
                            onClick={() => setLang('fr')}
                            style={{ ...styles.langBtn, ...(lang === 'fr' ? styles.langBtnActive : {}) }}
                        >
                            Français
                        </button>
                    </div>
                </div>

                {/* About section */}
                <div style={styles.sidebarSection}>
                    <p style={styles.sidebarHeading}>{t('mobileAboutHeading')}</p>
                    <p style={styles.sidebarText}>{t('mobileAboutBlurb')}</p>
                    <a
                        href="https://github.com/thiswillbeyourgithub/parakeet_web/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.sidebarLink}
                    >
                        {t('mobileOpenSource')}
                    </a>
                </div>
            </div>

            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.3rem' }}>
                {t('mobileTitle')}
            </h2>

            {/* Disconnect button — always visible when connected, at top to avoid accidental tap */}
            {(status === STATUS.RECORDING || status === STATUS.PAUSED || status === STATUS.READY) && (
                <div style={{ marginBottom: '1rem' }}>
                    <button
                        onClick={() => setShowDisconnectConfirm(true)}
                        style={{
                            background: 'transparent', border: '1px solid #6b7280',
                            color: '#9ca3af', borderRadius: '6px',
                            padding: '0.35rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer',
                        }}
                    >
                        {t('mobileDisconnectBtn')}
                    </button>
                </div>
            )}

            {/* Disconnect confirmation modal */}
            {showDisconnectConfirm && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }}>
                    <div style={{
                        background: '#1e1e3a', borderRadius: '16px', padding: '1.5rem',
                        maxWidth: '320px', width: '90%', textAlign: 'center', color: '#e0e0e0',
                    }}>
                        <h3 style={{ marginBottom: '0.75rem', fontSize: '1.1rem' }}>
                            {t('mobileConfirmDisconnectTitle')}
                        </h3>
                        <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                            {t('mobileConfirmDisconnectBody')}
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                            <button
                                onClick={() => { setShowDisconnectConfirm(false); stopAndDisconnect(); }}
                                style={{
                                    background: '#ef4444', color: 'white', border: 'none',
                                    borderRadius: '8px', padding: '0.5rem 1.2rem',
                                    cursor: 'pointer', fontWeight: 'bold',
                                }}
                            >
                                {t('mobileConfirmDisconnectYes')}
                            </button>
                            <button
                                onClick={() => setShowDisconnectConfirm(false)}
                                style={{
                                    background: 'transparent', color: '#9ca3af',
                                    border: '1px solid #4b5563', borderRadius: '8px',
                                    padding: '0.5rem 1.2rem', cursor: 'pointer',
                                }}
                            >
                                {t('mobileConfirmDisconnectNo')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Camera QR scanner overlay (WebSend-style re-pairing) */}
            {scannerOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: '#000', zIndex: 9999, display: 'flex',
                    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                    <p style={{ color: '#e0e0e0', fontSize: '1rem', margin: '1rem', textAlign: 'center' }}>
                        {t('mobileScanTitle')}
                    </p>
                    <div style={{ position: 'relative', width: '90%', maxWidth: '400px', aspectRatio: '1 / 1' }}>
                        <video
                            ref={scanVideoRef}
                            muted
                            playsInline
                            style={{
                                width: '100%', height: '100%', objectFit: 'cover',
                                borderRadius: '12px', background: '#111',
                            }}
                        />
                        {/* Framing reticle */}
                        <div style={{
                            position: 'absolute', top: '12%', left: '12%', right: '12%', bottom: '12%',
                            border: '3px solid rgba(96,165,250,0.9)', borderRadius: '12px',
                            pointerEvents: 'none',
                        }} />
                    </div>
                    {scannerError && (
                        <p style={{ color: '#fbbf24', fontSize: '0.85rem', margin: '1rem', textAlign: 'center' }}>
                            ⚠ {scannerError}
                        </p>
                    )}
                    <button onClick={closeScanner} style={{
                        marginTop: '1.5rem', background: '#ef4444', color: 'white', border: 'none',
                        borderRadius: '12px', padding: '0.8rem 2.5rem', fontSize: '1rem',
                        fontWeight: 'bold', cursor: 'pointer',
                    }}>
                        {t('mobileScanCancelBtn')}
                    </button>
                </div>
            )}

            {status === STATUS.INIT && (
                <p style={{ color: '#9ca3af' }}>{t('mobileInitializing')}</p>
            )}

            {status === STATUS.CONNECTING && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa' }}>{t('mobileConnecting')}</p>
                </div>
            )}

            {status === STATUS.RECONNECTING && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#fbbf24' }}>{t('mobileReconnecting')}</p>
                    <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                        {t('mobileReconnectAttempt', { n: reconnectAttempt, max: RECONNECT_MAX_ATTEMPTS })}
                    </p>
                    <p style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '1rem' }}>
                        {t('mobileReconnectHint')}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', marginTop: '1.25rem' }}>
                        <button onClick={openScanner} style={styles.sendFileButton}>
                            {t('mobileScanQrBtn')}
                        </button>
                        <button onClick={stopAndDisconnect} style={{
                            background: 'transparent', border: '1px solid #6b7280', color: '#9ca3af',
                            borderRadius: '8px', padding: '0.5rem 1.5rem', fontSize: '0.9rem', cursor: 'pointer',
                        }}>
                            {t('mobileStopReconnectBtn')}
                        </button>
                    </div>
                </div>
            )}

            {status === STATUS.WAITING_KEY && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa' }}>{t('mobileEstablishingEncryption')}</p>
                </div>
            )}

            {(status === STATUS.RECORDING || status === STATUS.PAUSED) && (
                <div>
                    <div style={{
                        width: '120px', height: '120px', borderRadius: '50%',
                        background: status === STATUS.PAUSED
                            ? `radial-gradient(circle, rgba(${captureUi.rgb},0.3) 0%, rgba(${captureUi.rgb},0.1) 70%)`
                            : `radial-gradient(circle, rgba(${captureUi.rgb},${0.3 + audioLevel / 150}) 0%, rgba(${captureUi.rgb},0.1) 70%)`,
                        border: `3px solid ${captureUi.color}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '1rem auto',
                        transition: 'background 0.1s',
                    }}>
                        {status === STATUS.PAUSED ? (
                            <span style={{ fontSize: '2rem' }}>⏸</span>
                        ) : (
                            <div style={{
                                width: `${30 + audioLevel * 0.5}px`,
                                height: `${30 + audioLevel * 0.5}px`,
                                borderRadius: '50%',
                                background: captureUi.color,
                                transition: 'width 0.1s, height 0.1s, background 0.2s',
                            }} />
                        )}
                    </div>

                    <p style={{
                        color: captureUi.color,
                        fontWeight: 'bold', fontSize: '1.2rem',
                    }}>
                        {captureUi.label} {formatTime(elapsed)}
                    </p>

                    {/* Level bar */}
                    <div style={{
                        margin: '1rem auto', width: '80%', height: '8px',
                        background: '#2a2a4a', borderRadius: '4px', overflow: 'hidden',
                    }}>
                        <div style={{
                            width: `${audioLevel}%`, height: '100%',
                            background: audioLevel < 20 ? '#f59e0b' : '#10b981',
                            transition: 'width 0.1s',
                        }} />
                    </div>

                    {status === STATUS.RECORDING && (
                        <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                            {audioHint}
                        </p>
                    )}

                    {sendErrorCount > 0 && (
                        <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                            ⚠ {sendErrorCount} dropped chunk{sendErrorCount === 1 ? '' : 's'}
                        </p>
                    )}

                    {/* Pause / Resume / Stop / Disconnect */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
                        {status === STATUS.RECORDING ? (
                            <button onClick={pauseRecording} style={styles.pauseButton}>
                                {t('mobilePauseBtn')}
                            </button>
                        ) : (
                            <button onClick={resumeRecording} style={styles.resumeButton}>
                                {t('mobileResumeBtn')}
                            </button>
                        )}
                        <button onClick={stopRecording} style={styles.stopButton}>
                            {handsFree ? t('mobileStopListeningBtn') : t('mobileStopBtn')}
                        </button>
                    </div>
                </div>
            )}

            {status === STATUS.READY && (
                <div>
                    <p style={{ color: '#10b981', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {hasRecorded ? t('mobileRecordingSent') : t('mobileConnectedReady')}
                    </p>
                    {hasRecorded && (
                        <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                            {t('mobileStartAnother')}
                        </p>
                    )}
                    {fileWarning && (
                        <p style={{ color: '#fbbf24', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            ⚠ {fileWarning}
                        </p>
                    )}
                    {/* Recording mode switch, remembered across sessions */}
                    <div style={{ marginTop: hasRecorded ? 0 : '1.5rem', marginBottom: '1rem' }}>
                        <p style={styles.sidebarHeading}>{t('mobileModeLabel')}</p>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                                onClick={() => setHandsFree(false)}
                                style={{ ...styles.langBtn, ...(!handsFree ? styles.langBtnActive : {}) }}
                            >
                                {t('mobileModePushBtn')}
                            </button>
                            <button
                                onClick={() => setHandsFree(true)}
                                style={{ ...styles.langBtn, ...(handsFree ? styles.langBtnActive : {}) }}
                            >
                                {t('mobileModeHandsFreeBtn')}
                            </button>
                        </div>
                        {handsFree && (
                            <p style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                {t('mobileHandsFreeHint')}
                            </p>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
                        <button onClick={startMicCapture} style={styles.newRecordingButton}>
                            {handsFree ? t('mobileStartListeningBtn') : t('mobileStartNewBtn')}
                        </button>
                        <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={styles.sendFileButton}>
                            {t('mobileSendFileBtn')}
                        </button>
                    </div>
                </div>
            )}

            {status === STATUS.SENDING_FILE && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa', fontWeight: 'bold' }}>
                        {t('mobileSendingFile')}
                    </p>
                    {fileName && (
                        <p style={{ color: '#9ca3af', fontSize: '0.85rem', wordBreak: 'break-all', marginBottom: '1rem' }}>
                            {fileName}
                        </p>
                    )}
                    {/* Progress bar */}
                    <div style={{
                        margin: '1rem auto', width: '80%', height: '8px',
                        background: '#2a2a4a', borderRadius: '4px', overflow: 'hidden',
                    }}>
                        <div style={{
                            width: `${Math.round(fileProgress * 100)}%`, height: '100%',
                            background: '#10b981', transition: 'width 0.2s',
                        }} />
                    </div>
                    <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                        {Math.round(fileProgress * 100)}%
                    </p>
                    {sendErrorCount > 0 && (
                        <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                            ⚠ {sendErrorCount} dropped chunk{sendErrorCount === 1 ? '' : 's'}
                        </p>
                    )}
                    <button onClick={cancelFileSend} style={styles.stopButton}>
                        {t('mobileCancelSendBtn')}
                    </button>
                </div>
            )}

            {status === STATUS.STOPPED && (
                <div>
                    <p style={{ color: '#10b981', fontSize: '1.1rem', marginBottom: '1rem' }}>
                        {t('mobileSessionEnded')}
                    </p>
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        {t('mobileSessionEndedHint')}
                    </p>
                    <button onClick={openScanner} style={styles.newRecordingButton}>
                        {t('mobileScanQrBtn')}
                    </button>
                </div>
            )}

            {status === STATUS.ERROR && (
                <div>
                    <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{errorMsg}</p>
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        {t('mobileRescanHint')}
                    </p>
                    <button onClick={openScanner} style={styles.newRecordingButton}>
                        {t('mobileScanQrBtn')}
                    </button>
                </div>
            )}

            {/* Debug log dropdown */}
            <div style={{ marginTop: '2rem', textAlign: 'left' }}>
                <button
                    onClick={() => setLogsOpen(o => !o)}
                    style={{
                        background: 'transparent', border: '1px solid #3a3a5a',
                        color: '#9ca3af', borderRadius: '6px',
                        padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer',
                        width: '100%', textAlign: 'left',
                    }}
                >
                    {logsOpen ? '▲' : '▼'} {t('mobileDebugLogs')} ({logs.length})
                </button>
                {logsOpen && (
                    <div style={{
                        marginTop: '0.5rem', background: '#0d0d1a',
                        border: '1px solid #2a2a4a', borderRadius: '6px',
                        padding: '0.5rem', maxHeight: '200px', overflowY: 'auto',
                        fontFamily: 'monospace', fontSize: '0.7rem', lineHeight: '1.4',
                    }}>
                        {logs.length === 0 && <span style={{ color: '#4b5563' }}>No logs yet.</span>}
                        {logs.map((line, i) => (
                            <div key={i} style={{
                                color: line.startsWith('[ERR]') ? '#f87171'
                                     : line.startsWith('[WARN]') ? '#fbbf24'
                                     : '#86efac',
                                wordBreak: 'break-all',
                            }}>{line}</div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}

const styles = {
    menuButton: {
        position: 'fixed', top: '1rem', right: '1rem',
        background: 'rgba(30,30,58,0.85)', color: '#e0e0e0',
        border: '1px solid #3a3a5a', borderRadius: '8px',
        padding: '0.5rem 0.75rem', fontSize: '1.4rem',
        cursor: 'pointer', zIndex: 200, lineHeight: 1,
    },
    sidebarOverlay: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.45)', zIndex: 300,
    },
    sidebar: {
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '280px', background: '#1e1e3a',
        borderLeft: '1px solid #3a3a5a',
        zIndex: 301, padding: '1.5rem 1rem',
        display: 'flex', flexDirection: 'column', gap: '0',
        transition: 'transform 0.25s ease',
        overflowY: 'auto',
    },
    sidebarCloseBtn: {
        alignSelf: 'flex-end', background: 'transparent',
        color: '#9ca3af', border: '1px solid #3a3a5a',
        borderRadius: '6px', padding: '0.3rem 0.7rem',
        fontSize: '0.85rem', cursor: 'pointer', marginBottom: '1.5rem',
    },
    sidebarSection: {
        borderTop: '1px solid #2a2a4a', paddingTop: '1rem', marginBottom: '1rem',
    },
    sidebarHeading: {
        color: '#9ca3af', fontSize: '0.75rem', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: '0.6rem', marginTop: 0,
    },
    sidebarText: {
        color: '#d1d5db', fontSize: '0.85rem', lineHeight: '1.5', marginBottom: '0.75rem',
    },
    sidebarLink: {
        color: '#60a5fa', fontSize: '0.85rem', textDecoration: 'none',
    },
    langBtn: {
        background: 'transparent', color: '#9ca3af',
        border: '1px solid #3a3a5a', borderRadius: '6px',
        padding: '0.4rem 0.9rem', fontSize: '0.9rem', cursor: 'pointer',
    },
    langBtnActive: {
        background: '#3b82f6', color: 'white', borderColor: '#3b82f6',
    },
    spinner: {
        width: '40px', height: '40px', margin: '1rem auto',
        border: '4px solid #2a2a4a', borderTopColor: '#60a5fa',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    stopButton: {
        background: '#ef4444', color: 'white', border: 'none',
        borderRadius: '12px', padding: '0.9rem 2.5rem', fontSize: '1.05rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    pauseButton: {
        background: '#f59e0b', color: 'white', border: 'none',
        borderRadius: '12px', padding: '0.9rem 2.5rem', fontSize: '1.05rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    resumeButton: {
        background: '#10b981', color: 'white', border: 'none',
        borderRadius: '12px', padding: '0.9rem 2.5rem', fontSize: '1.05rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    newRecordingButton: {
        background: '#ef4444', color: 'white', border: 'none',
        borderRadius: '12px', padding: '1rem 2.5rem', fontSize: '1.1rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    sendFileButton: {
        background: 'transparent', color: '#60a5fa', border: '1px solid #3b82f6',
        borderRadius: '12px', padding: '0.9rem 2.5rem', fontSize: '1rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    disconnectButton: {
        background: 'transparent', color: '#6b7280', border: '1px solid #3a3a5a',
        borderRadius: '8px', padding: '0.6rem 1.5rem', fontSize: '0.9rem',
        cursor: 'pointer', width: '60%',
    },
};

// Inject keyframe animation for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleSheet);

const root = createRoot(document.getElementById('root'));
root.render(
    <I18nProvider>
        <RemoteMicSender />
    </I18nProvider>
);
