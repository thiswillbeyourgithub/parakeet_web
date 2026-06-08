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
    deriveSharedKey, encrypt
} from './lib/remote-crypto.js';
import {
    getAdaptiveFingerprintLength, computePairFingerprintForRole
} from './lib/remote-mic-handshake.js';
import VerificationModal from './components/VerificationModal.jsx';
import { I18nProvider, useI18n } from './i18n.jsx';
import { acquireKeepalive, releaseKeepalive } from './lib/keepalive.js';
import { verifiedAddModule } from './lib/asset-integrity.js';
import { createLevelMonitor, resamplePcmTo16k } from './lib/audio.js';
import { formatTime } from './lib/format.js';

const STATUS = {
    INIT: 'init',
    CONNECTING: 'connecting',
    WAITING_KEY: 'waiting_key',
    RECORDING: 'recording',
    PAUSED: 'paused',    // audio paused, RTC still open
    READY: 'ready',      // connected, not recording — between recordings
    SENDING_FILE: 'sending_file', // pumping a decoded saved file through the tunnel
    STOPPED: 'stopped',  // RTC closed
    ERROR: 'error',
};

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
    const [fingerprint, setFingerprint] = useState('');
    const verifyResolveRef = useRef(null); // (boolean) => void
    // F-63: bilateral verify-ok ack. The phone must not bind the shared key
    // (and thus start accepting/sending encrypted audio) until the receiver
    // has reciprocated with its own verify-ok. Otherwise an attacker who
    // gets the phone's user to confirm a poisoned fingerprint while the
    // desktop user denies it would still leave the phone in a streaming-
    // ready state on the next interaction. Waiting on the peer ack closes
    // that asymmetry.
    const peerAckResolveRef = useRef(null); // (boolean) => void
    // Buffer for a peer verify-ok that arrives BEFORE the local user clicks
    // confirm on the phone's fingerprint modal (i.e. the desktop user
    // confirmed first). Without this, the early message would be discarded
    // as "stray", and the phone would later wait the full 60s peer-ack
    // timeout for a message that already arrived. Mirrors the desktop's
    // remoteMicEarlyPeerVerifyRef. Cleared on every cleanup path.
    const earlyPeerVerifyRef = useRef(null);
    // F-137: synchronous handshake-in-progress flag. The duplicate-handshake
    // guard at the top of the 'public-key' branch checks sharedKeyRef /
    // verifyResolveRef / peerAckResolveRef, but those refs are only
    // populated AFTER several awaits (generateKeyPair, importPublicKey,
    // deriveSharedKey, exportPublicKey, getAdaptiveFingerprintLength,
    // computePairFingerprintForRole). A hostile receiver that sends two
    // public-key messages back-to-back would otherwise see both pass the
    // guard and clobber the resolver. Set true synchronously before the
    // first await to close the multi-await window.
    const handshakeInProgressRef = useRef(false);
    const logsEndRef = useRef(null);

    const rtcRef = useRef(null);
    const sharedKeyRef = useRef(null);
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
    // Audio capture settings pushed from the desktop. Defaults match the
    // historical hardcoded values; overwritten when the desktop sends an
    // `audio-settings` control message. Toggles are read inside
    // startMicCapture so each new recording picks up the latest values;
    // `gain` is also pushed live onto gainNodeRef so the slider gives
    // immediate feedback mid-recording.
    const audioSettingsRef = useRef({
        noiseSuppression: true,
        echoCancellation: false,
        autoGainControl: true,
        gain: 2.0,
    });
    const gainNodeRef = useRef(null);

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
    const pendingBatchRef = useRef({ buf: null, len: 0 });
    const batchTargetSamplesRef = useRef(0);

    // Saved-file send is decoded/resampled to 16 kHz mono on the phone, then
    // streamed through the exact same Int16 batch framing the mic uses. The
    // desktop receiver enforces a per-session sample cap (REMOTE_MIC_MAX_SAMPLES
    // = 10*60*96000 -> 60 min at 16 kHz); mirror it here so we truncate-and-warn
    // locally rather than pumping minutes of audio the receiver will silently
    // drop. 16 kHz mono Float32 at 60 min is ~230 MB, the same ceiling the
    // desktop already tolerates.
    const FILE_TARGET_SAMPLE_RATE = 16000;
    const FILE_MAX_SAMPLES_16K = 60 * 60 * FILE_TARGET_SAMPLE_RATE;

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
        releaseWakeLock();
    }, [releaseWakeLock]);

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

    // Flush whatever partial batch is pending so the trailing fragment of
    // a recording reaches the desktop. Detaches the worklet port first so
    // no new quanta race the snapshot. Safe to call multiple times.
    const flushPendingBatch = useCallback(async () => {
        if (workletRef.current) {
            try { workletRef.current.port.onmessage = null; } catch (_) { /* ignore */ }
        }
        const p = pendingBatchRef.current;
        if (!p.buf || p.len === 0) return;
        if (!sharedKeyRef.current || !rtcRef.current) {
            pendingBatchRef.current = { buf: null, len: 0 };
            return;
        }
        const int16 = _quantiseFloat32ToInt16(p.buf.subarray(0, p.len));
        pendingBatchRef.current = { buf: null, len: 0 };
        try {
            const encrypted = await encrypt(int16.buffer, sharedKeyRef.current);
            await rtcRef.current.sendBinary(encrypted);
        } catch (err) {
            console.warn('[RemoteMic] Flush encrypt/send error:', err.message);
            setSendErrorCount((n) => n + 1);
        }
    }, []);

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
        if (!sharedKeyRef.current || !rtcRef.current) return;
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
        try {
            const encrypted = await encrypt(int16.buffer, sharedKeyRef.current);
            await rtcRef.current.sendBinary(encrypted);
        } catch (err) {
            console.warn('[RemoteMic] Encrypt/send error:', err.message);
            setSendErrorCount((n) => n + 1);
        }
    }, []);

    // --- Full cleanup (audio + RTC) ---
    const cleanupAll = useCallback(() => {
        // Abort any in-flight saved-file pump so it stops pushing into the
        // transport we're about to tear down.
        fileAbortRef.current = true;
        cleanupAudio();
        if (rtcRef.current) { rtcRef.current.close(); rtcRef.current = null; }
        sharedKeyRef.current = null;
        // Release any pending fingerprint or peer-ack waits so the awaiting
        // Promises in start() don't pin the ECDH private key in a dead
        // closure if cleanup runs mid-handshake.
        if (verifyResolveRef.current) {
            verifyResolveRef.current(false);
            verifyResolveRef.current = null;
        }
        if (peerAckResolveRef.current) {
            peerAckResolveRef.current(false);
            peerAckResolveRef.current = null;
        }
        earlyPeerVerifyRef.current = null;
        // F-137: cleanupAll is the funnel for every teardown path; reset the
        // synchronous handshake-in-progress flag so a re-pair can claim a
        // fresh slot. The success path clears it explicitly after binding.
        handshakeInProgressRef.current = false;
    }, [cleanupAudio]);

    useEffect(() => {
        return cleanupAll;
    }, [cleanupAll]);

    // F-131: BFCache hardening on the phone side. Mirror App.jsx's
    // pagehide/pageshow pattern so a phone parked in BFCache mid-session
    // (Home button, app-switcher, deep link) does not revive with a stale
    // MediaStream + AES-GCM sharedKey + ECDH private CryptoKey pinned in
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

    const start = useCallback(async () => {
        // Hoisted so the catch block below can clear it on early failure;
        // otherwise a join error left the timer to fire 30s later and call
        // rtc.close() on an already-closed connection.
        let keyTimeout = null;
        try {
            // Parse room info from URL hash: #roomId:secret
            // JS String#split(sep, limit) truncates rather than packing the
            // tail, so split(':', 2) on "ROOM:abc:def" yields ["ROOM","abc"]
            // and silently drops ":def". Today the secret alphabet excludes
            // `:`, but slicing at the first separator removes the latent
            // footgun if the secret format ever widens.
            const hash = window.location.hash.substring(1);
            const sep = hash.indexOf(':');
            if (sep < 0) {
                setStatus(STATUS.ERROR);
                setErrorMsg(t('mobileInvalidLink'));
                return;
            }
            const roomId = hash.slice(0, sep);
            const secret = hash.slice(sep + 1);
            if (!roomId || !secret) {
                setStatus(STATUS.ERROR);
                setErrorMsg(t('mobileInvalidLinkMissing'));
                return;
            }

            // Scrub the secret out of the visible URL before the browser
            // commits it to history / autocomplete / Chrome Sync / OBS
            // screenshots of the phone. The secret is now held only in the
            // local `secret` variable for the duration of the handshake.
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

            setStatus(STATUS.CONNECTING);

            // Connect to signaling server
            const rtc = new RemoteMicRTC('/api/signal');
            rtcRef.current = rtc;

            await rtc.init();

            rtc.onDisconnected = () => {
                cleanupAll();
                setStatus(STATUS.STOPPED);
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
                if (!sharedKeyRef.current) {
                    console.warn('[RemoteMic] Timed out waiting for receiver public key');
                    setErrorMsg(t('mobileConnectionError'));
                    setStatus(STATUS.ERROR);
                    rtc.close();
                }
            }, 30000);

            // Handle incoming messages (JSON control messages)
            rtc.onMessage = async (data) => {
                if (typeof data === 'string') {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.type === 'public-key') {
                            // F-135: refuse a second handshake once one is in
                            // flight or already bound. Mirrors the desktop's
                            // F-86 guard (App.jsx:1448). Without this, a
                            // hostile peer can re-send public-key mid-modal,
                            // swap the displayed fingerprint under the user's
                            // eyes, and orphan the prior ECDH private key.
                            //
                            // F-137: include the synchronous in-progress flag.
                            // The other refs are only populated after several
                            // awaits below, so a flood of public-key messages
                            // would all pass this guard before any of them
                            // reached the verifyResolveRef assignment.
                            if (sharedKeyRef.current || verifyResolveRef.current || peerAckResolveRef.current || handshakeInProgressRef.current) {
                                console.warn('[RemoteMic] Ignoring duplicate public-key — handshake already bound or in-flight');
                                return;
                            }
                            handshakeInProgressRef.current = true;
                            clearTimeout(keyTimeout);
                            // Computer sent its public key, derive shared key
                            setStatus(STATUS.WAITING_KEY);
                            const keyPair = await generateKeyPair();
                            const theirKey = await importPublicKey(msg.key);
                            const sharedKey = await deriveSharedKey(keyPair.privateKey, theirKey);

                            // Send our public key back
                            const ourKeyBase64 = await exportPublicKey(keyPair.publicKey);
                            rtc.sendMessage({ type: 'sender-public-key', key: ourKeyBase64 });

                            // Compute the same short fingerprint as the
                            // receiver via the shared helper, which enforces a
                            // fixed receiver-first byte order on both sides.
                            // Defends against a malicious signaling server
                            // that swapped keys to MITM the data channel.
                            const hexLen = await getAdaptiveFingerprintLength();
                            const fp = await computePairFingerprintForRole('sender', keyPair.publicKey, theirKey, hexLen);
                            setFingerprint(fp);
                            const confirmed = await new Promise((resolve) => {
                                verifyResolveRef.current = resolve;
                            });
                            setFingerprint('');
                            verifyResolveRef.current = null;

                            if (!confirmed) {
                                console.warn('[RemoteMic] User denied fingerprint match, aborting');
                                rtc.sendMessage({ type: 'verify-deny' });
                                setErrorMsg(t('verifyAborted'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                                return;
                            }
                            rtc.sendMessage({ type: 'verify-ok' });

                            // F-63: wait for the receiver's reciprocal
                            // verify-ok before binding the shared key. 60s
                            // cap is consistent with the desktop side.
                            const PEER_ACK_TIMEOUT_MS = 60000;
                            let peerAckTimer = null;
                            const peerAcked = await new Promise((resolve) => {
                                // If the desktop confirmed before us, its
                                // verify-ok was buffered while our modal
                                // was up. Consume it now rather than
                                // arming a 60s wait for a message that
                                // already arrived.
                                if (earlyPeerVerifyRef.current !== null) {
                                    const early = earlyPeerVerifyRef.current;
                                    earlyPeerVerifyRef.current = null;
                                    resolve(early);
                                    return;
                                }
                                peerAckResolveRef.current = resolve;
                                peerAckTimer = setTimeout(() => {
                                    if (peerAckResolveRef.current) {
                                        peerAckResolveRef.current(false);
                                        peerAckResolveRef.current = null;
                                    }
                                }, PEER_ACK_TIMEOUT_MS);
                            });
                            if (peerAckTimer) clearTimeout(peerAckTimer);
                            peerAckResolveRef.current = null;

                            if (!peerAcked) {
                                console.warn('[RemoteMic] Receiver did not ack verify-ok (deny or timeout), aborting');
                                setErrorMsg(t('verifyAborted'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                                return;
                            }
                            sharedKeyRef.current = sharedKey;
                            // F-137: handshake is now bound, future public-key
                            // messages are caught by the sharedKeyRef guard.
                            handshakeInProgressRef.current = false;

                            // Phone is connected, let the user tap Start Recording when ready
                            setStatus(STATUS.READY);
                        } else if (msg.type === 'verify-ok') {
                            // F-63: receiver confirmed its end. Three cases:
                            //  (a) Our peer-ack wait is armed -> resolve.
                            //  (b) Session already bound -> stale replay,
                            //      ignore.
                            //  (c) Otherwise desktop confirmed before us;
                            //      buffer the arrival so the peer-ack wait
                            //      consumes it as soon as the local user
                            //      taps confirm. Without (c) the locally-
                            //      late side waits the full 60s timeout
                            //      and surfaces a misleading abort.
                            if (peerAckResolveRef.current) {
                                peerAckResolveRef.current(true);
                            } else if (sharedKeyRef.current) {
                                console.warn('[RemoteMic] Stray verify-ok ignored (session already bound)');
                            } else {
                                earlyPeerVerifyRef.current = true;
                                console.log('[RemoteMic] Peer verify-ok arrived before local confirm, buffered');
                            }
                        } else if (msg.type === 'verify-deny') {
                            // Receiver denied the fingerprint match, abort.
                            // Could arrive (a) before local confirm
                            // (verifyResolve in flight) or (b) after local
                            // confirm while awaiting peer ack
                            // (peerAckResolve in flight).
                            if (verifyResolveRef.current) {
                                verifyResolveRef.current(false);
                            } else if (peerAckResolveRef.current) {
                                peerAckResolveRef.current(false);
                            } else if (sharedKeyRef.current) {
                                // F-136: a malicious peer can send verify-deny
                                // mid-session to wipe an in-flight recording
                                // and surface a misleading 'fingerprints did
                                // not match' error. Mirrors the desktop F-87
                                // fix: once the session is bound, verify-deny
                                // is a stale control message and must be
                                // ignored.
                                console.warn('[RemoteMic] Ignoring verify-deny after session bound');
                            } else {
                                setErrorMsg(t('verifyAborted'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                            }
                        } else if (msg.type === 'stop-recording') {
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
                            if (typeof msg.echoCancellation === 'boolean') {
                                audioSettingsRef.current.echoCancellation = msg.echoCancellation;
                            }
                            if (typeof msg.autoGainControl === 'boolean') {
                                audioSettingsRef.current.autoGainControl = msg.autoGainControl;
                            }
                            if (typeof msg.gain === 'number' && Number.isFinite(msg.gain) && msg.gain >= 0) {
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
                        }
                    } catch (e) {
                        console.error('[RemoteMic] Error handling message:', e);
                    }
                }
            };

            // Join the room (creates WebRTC connection)
            await rtc.joinRoom(roomId, secret);

        } catch (e) {
            if (keyTimeout) clearTimeout(keyTimeout);
            console.error('[RemoteMic] Connection error:', e);
            setStatus(STATUS.ERROR);
            setErrorMsg(e.message || t('mobileConnectionError'));
        }
    }, [cleanupAll, t]);

    const startMicCapture = useCallback(async () => {
        try {
            // Request microphone access. Toggles come from the desktop
            // (audio-settings message) so the phone honours the same user
            // preferences as the local mic path.
            const { noiseSuppression, echoCancellation, autoGainControl } = audioSettingsRef.current;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: { ideal: 16000 },
                    noiseSuppression,
                    echoCancellation,
                    autoGainControl,
                }
            });
            streamRef.current = stream;

            // Create AudioContext — try 16kHz, fall back to browser default
            let audioCtx;
            try {
                audioCtx = new AudioContext({ sampleRate: 16000 });
            } catch (e) {
                console.warn('[RemoteMic] 16kHz AudioContext failed, using default:', e.message);
                audioCtx = new AudioContext();
            }
            audioCtxRef.current = audioCtx;

            const actualRate = audioCtx.sampleRate;
            console.log(`[RemoteMic] AudioContext sample rate: ${actualRate}`);

            // Always tell computer the sample rate (also serves as "new recording started" signal).
            // `format: 'pcm-s16'` opts us in to Int16 wire encoding (-50% bytes vs Float32, no
            // quality loss because the desktop quantises to Int16 anyway when writing the WAV).
            // Older desktops missing this awareness default to 'pcm-f32' on receive, so omitting
            // the field is the backwards-compatible signal — but we always send it from this
            // build so the format is observable in logs.
            if (rtcRef.current) {
                rtcRef.current.sendMessage({ type: 'audio-config', sampleRate: actualRate, format: 'pcm-s16' });
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

            // Reset the batch buffer for this recording. Size it to one full
            // batch plus a quantum of headroom; the worklet appends in
            // 128-sample increments, so this never grows in practice.
            batchTargetSamplesRef.current = Math.max(128, Math.round(actualRate * SEND_BATCH_MS / 1000));
            pendingBatchRef.current = {
                buf: new Float32Array(batchTargetSamplesRef.current + 128),
                len: 0,
            };

            worklet.port.onmessage = (e) => {
                const pcmChunk = e.data; // Float32Array
                // Defensive: the worklet should only ever post 128-sample
                // Float32Arrays. Anything else is a bug or a hijacked port.
                if (!(pcmChunk instanceof Float32Array)) {
                    console.warn('[RemoteMic] Dropping non-Float32 worklet payload:', typeof pcmChunk);
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
            setHasRecorded(true);
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
    }, [acquireWakeLock, t, pushPcmIntoBatch]);

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
        if (!sharedKeyRef.current || !rtcRef.current) {
            console.warn('[RemoteMic] Ignoring file send — not connected/verified');
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
            // 1. Decode at (ideally) 16 kHz; the browser's own hardened decoder
            //    rejects malformed files here, so nothing bad reaches the wire.
            const arrayBuf = await file.arrayBuffer();
            try {
                decodeCtx = new AudioContext({ sampleRate: FILE_TARGET_SAMPLE_RATE });
            } catch (_) {
                decodeCtx = new AudioContext();
            }
            const decoded = await decodeCtx.decodeAudioData(arrayBuf);

            // 2. Downmix to mono.
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

            // 3. Resample to 16 kHz (shared helper; no-op when already 16 kHz).
            let pcm16k = await resamplePcmTo16k(mono, decoded.sampleRate);

            // 4. Truncate to the receiver's per-session cap, warn if we did.
            if (pcm16k.length > FILE_MAX_SAMPLES_16K) {
                console.warn(`[RemoteMic] File ${pcm16k.length} samples exceeds cap ${FILE_MAX_SAMPLES_16K}, truncating`);
                pcm16k = pcm16k.subarray(0, FILE_MAX_SAMPLES_16K);
                setFileWarning(t('mobileFileTruncated'));
            }
            if (fileAbortRef.current || !sharedKeyRef.current || !rtcRef.current) return;

            // 5. Announce config (identical framing to a live recording).
            //    source:'file' is an optional hint older desktops ignore.
            rtcRef.current.sendMessage({
                type: 'audio-config',
                sampleRate: FILE_TARGET_SAMPLE_RATE,
                format: 'pcm-s16',
                source: 'file',
            });
            configSent = true;
            setHasRecorded(true);

            // 6. Fresh batch buffer (mirrors startMicCapture).
            batchTargetSamplesRef.current = Math.max(128, Math.round(FILE_TARGET_SAMPLE_RATE * SEND_BATCH_MS / 1000));
            pendingBatchRef.current = {
                buf: new Float32Array(batchTargetSamplesRef.current + 128),
                len: 0,
            };

            // 7. Paced pump: one batch worth at a time, awaiting the send and a
            //    drain so we throttle to the link instead of overrunning it.
            const batch = batchTargetSamplesRef.current;
            const total = pcm16k.length;
            for (let off = 0; off < total; off += batch) {
                if (fileAbortRef.current || !sharedKeyRef.current || !rtcRef.current) {
                    console.warn('[RemoteMic] File send aborted mid-pump');
                    // User cancelled while the transport is still alive: finalise
                    // in order (flush + audio-end) so the desktop transcribes what
                    // it received. A disconnect-driven abort instead nulls rtcRef
                    // and owns its own teardown, so we just return there.
                    if (rtcRef.current) {
                        try { await flushPendingBatch(); } catch (_) { /* ignore */ }
                        try { rtcRef.current.sendMessage({ type: 'audio-end' }); } catch (_) { /* ignore */ }
                        setStatus(STATUS.READY);
                    }
                    return;
                }
                await pushPcmIntoBatch(pcm16k.subarray(off, Math.min(off + batch, total)));
                await rtcRef.current.drain();
                setFileProgress(Math.min(1, (off + batch) / total));
            }
            if (fileAbortRef.current || !rtcRef.current) return;

            // 8. Flush trailing partial batch, then close the recording.
            await flushPendingBatch();
            if (rtcRef.current) rtcRef.current.sendMessage({ type: 'audio-end' });
            setFileProgress(1);
            setStatus(STATUS.READY);
        } catch (e) {
            console.error('[RemoteMic] File send error:', e);
            // The tunnel is independent of file problems, so keep the session
            // alive (no rescan needed) and let the user pick another file. If
            // we already announced audio-config, close the recording cleanly
            // so the desktop finalises what it got instead of waiting forever.
            if (configSent && rtcRef.current) {
                try { await flushPendingBatch(); } catch (_) { /* ignore */ }
                try { rtcRef.current.sendMessage({ type: 'audio-end' }); } catch (_) { /* ignore */ }
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
    }, [t, pushPcmIntoBatch, flushPendingBatch]);

    // Cancel an in-flight saved-file send. The pump detects the flag on its
    // next iteration and finalises the recording in order (see sendFile).
    const cancelFileSend = useCallback(() => {
        fileAbortRef.current = true;
    }, []);

    // Stop current recording but keep RTC alive for next recording
    const stopRecording = useCallback(async () => {
        // Flush before audio-end so the trailing <500 ms of audio that
        // hasn't filled a batch yet still reaches the desktop. Both
        // frames enqueue in order on the transport, so audio-end stays
        // the last thing the receiver sees for this recording.
        await flushPendingBatch();
        if (rtcRef.current) {
            rtcRef.current.sendMessage({ type: 'audio-end' });
        }
        cleanupAudio();
        setAudioLevel(0);
        setStatus(STATUS.READY);
    }, [cleanupAudio, flushPendingBatch]);

    // Pause: suspend AudioContext (no data sent, timer paused)
    const pauseRecording = useCallback(() => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
            audioCtxRef.current.suspend().catch(() => {});
        }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (levelMonitorRef.current) { levelMonitorRef.current.stop(); levelMonitorRef.current = null; }
        releaseWakeLock();
        setAudioLevel(0);
        setStatus(STATUS.PAUSED);
        if (rtcRef.current) rtcRef.current.sendMessage({ type: 'paused' });
    }, [releaseWakeLock]);

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
        if (rtcRef.current) rtcRef.current.sendMessage({ type: 'resumed' });
    }, [elapsed, acquireWakeLock]);

    // Full disconnect — close RTC, show goodbye screen
    const stopAndDisconnect = useCallback(async () => {
        await flushPendingBatch();
        if (rtcRef.current) {
            try { rtcRef.current.sendMessage({ type: 'audio-end' }); } catch (_) {}
        }
        cleanupAll();
        setAudioLevel(0);
        setStatus(STATUS.STOPPED);
    }, [cleanupAll, flushPendingBatch]);

    // Auto-start on mount
    useEffect(() => {
        start();
    }, [start]);

    const audioHint = audioLevel < 5 ? t('mobileNoAudio')
        : audioLevel < 20 ? t('mobileSpeakLouder')
        : t('mobileGoodLevel');

    return (
        <div style={{ textAlign: 'center', position: 'relative' }}>

            {/* Hidden picker for the "Send a file" action. Reset value on
                change so re-picking the same file fires onChange again. */}
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (f) sendFile(f);
                }}
            />

            {fingerprint && verifyResolveRef.current && (
                <VerificationModal
                    fingerprint={fingerprint}
                    prompt={t('verifyPrompt')}
                    warning={t('verifyWarning')}
                    confirmLabel={t('verifyConfirm')}
                    denyLabel={t('verifyDeny')}
                    onConfirm={() => verifyResolveRef.current && verifyResolveRef.current(true)}
                    onDeny={() => verifyResolveRef.current && verifyResolveRef.current(false)}
                />
            )}

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

            {status === STATUS.INIT && (
                <p style={{ color: '#9ca3af' }}>{t('mobileInitializing')}</p>
            )}

            {status === STATUS.CONNECTING && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa' }}>{t('mobileConnecting')}</p>
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
                            ? 'radial-gradient(circle, rgba(251,191,36,0.3) 0%, rgba(251,191,36,0.1) 70%)'
                            : `radial-gradient(circle, rgba(239,68,68,${0.3 + audioLevel / 150}) 0%, rgba(239,68,68,0.1) 70%)`,
                        border: `3px solid ${status === STATUS.PAUSED ? '#fbbf24' : '#ef4444'}`,
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
                                background: '#ef4444',
                                transition: 'width 0.1s, height 0.1s',
                            }} />
                        )}
                    </div>

                    <p style={{
                        color: status === STATUS.PAUSED ? '#fbbf24' : '#ef4444',
                        fontWeight: 'bold', fontSize: '1.2rem',
                    }}>
                        {status === STATUS.PAUSED ? t('mobilePaused') : t('mobileRecording')} {formatTime(elapsed)}
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
                            {t('mobileStopBtn')}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', marginTop: hasRecorded ? 0 : '1.5rem' }}>
                        <button onClick={startMicCapture} style={styles.newRecordingButton}>
                            {t('mobileStartNewBtn')}
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
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                        {t('mobileSessionEndedHint')}
                    </p>
                </div>
            )}

            {status === STATUS.ERROR && (
                <div>
                    <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{errorMsg}</p>
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                        {t('mobileRescanHint')}
                    </p>
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
