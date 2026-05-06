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
import { createLevelMonitor } from './lib/audio.js';

const STATUS = {
    INIT: 'init',
    CONNECTING: 'connecting',
    WAITING_KEY: 'waiting_key',
    RECORDING: 'recording',
    PAUSED: 'paused',    // audio paused, RTC still open
    READY: 'ready',      // connected, not recording — between recordings
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
    const intercept = (level, origFn) => (...args) => {
        origFn.apply(console, args);
        const line = `[${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
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
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [fingerprint, setFingerprint] = useState('');
    const verifyResolveRef = useRef(null); // (boolean) => void
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
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        sourceRef.current = null;
        releaseWakeLock();
    }, [releaseWakeLock]);

    // --- Full cleanup (audio + RTC) ---
    const cleanupAll = useCallback(() => {
        cleanupAudio();
        if (rtcRef.current) { rtcRef.current.close(); rtcRef.current = null; }
        sharedKeyRef.current = null;
    }, [cleanupAudio]);

    useEffect(() => {
        return cleanupAll;
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
            const hash = window.location.hash.substring(1);
            if (!hash || !hash.includes(':')) {
                setStatus(STATUS.ERROR);
                setErrorMsg(t('mobileInvalidLink'));
                return;
            }
            const [roomId, secret] = hash.split(':', 2);
            if (!roomId || !secret) {
                setStatus(STATUS.ERROR);
                setErrorMsg(t('mobileInvalidLinkMissing'));
                return;
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
                            clearTimeout(keyTimeout);
                            // Computer sent its public key — derive shared key
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
                                console.warn('[RemoteMic] User denied fingerprint match — aborting');
                                rtc.sendMessage({ type: 'verify-deny' });
                                setErrorMsg(t('verifyAborted'));
                                setStatus(STATUS.ERROR);
                                rtc.close();
                                return;
                            }
                            sharedKeyRef.current = sharedKey;

                            // Phone is connected — let the user tap Start Recording when ready
                            setStatus(STATUS.READY);
                        } else if (msg.type === 'verify-deny') {
                            // Receiver denied the fingerprint match — abort
                            if (verifyResolveRef.current) verifyResolveRef.current(false);
                            setErrorMsg(t('verifyAborted'));
                            setStatus(STATUS.ERROR);
                            rtc.close();
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
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: { ideal: 16000 },
                    noiseSuppression: true,
                    echoCancellation: false,
                    autoGainControl: true,
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

            // Always tell computer the sample rate (also serves as "new recording started" signal)
            if (rtcRef.current) {
                rtcRef.current.sendMessage({ type: 'audio-config', sampleRate: actualRate });
            }

            const source = audioCtx.createMediaStreamSource(stream);
            sourceRef.current = source;

            levelMonitorRef.current = createLevelMonitor(audioCtx, source, setAudioLevel);

            // PCM capture via AudioWorklet (same worklet as main app)
            await audioCtx.audioWorklet.addModule('/pcm-recorder-worklet.js');
            const worklet = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor');
            workletRef.current = worklet;

            worklet.port.onmessage = async (e) => {
                const pcmChunk = e.data; // Float32Array
                if (!sharedKeyRef.current || !rtcRef.current) return;
                // Defensive: the worklet should only ever post 128-sample
                // Float32Arrays. Anything else is a bug or a hijacked port.
                if (!(pcmChunk instanceof Float32Array)) {
                    console.warn('[RemoteMic] Dropping non-Float32 worklet payload:', typeof pcmChunk);
                    return;
                }

                try {
                    const encrypted = await encrypt(pcmChunk.buffer, sharedKeyRef.current);
                    await rtcRef.current.sendBinary(encrypted);
                } catch (err) {
                    console.warn('[RemoteMic] Encrypt/send error:', err.message);
                    setSendErrorCount((n) => n + 1);
                }
            };

            source.connect(worklet);
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
    }, [acquireWakeLock, t]);

    // Stop current recording but keep RTC alive for next recording
    const stopRecording = useCallback(() => {
        if (rtcRef.current) {
            rtcRef.current.sendMessage({ type: 'audio-end' });
        }
        cleanupAudio();
        setAudioLevel(0);
        setStatus(STATUS.READY);
    }, [cleanupAudio]);

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
        // Re-attach level monitor to the same source created in startMicCapture.
        if (audioCtxRef.current && sourceRef.current) {
            levelMonitorRef.current = createLevelMonitor(audioCtxRef.current, sourceRef.current, setAudioLevel);
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
    const stopAndDisconnect = useCallback(() => {
        if (rtcRef.current) {
            try { rtcRef.current.sendMessage({ type: 'audio-end' }); } catch (_) {}
        }
        cleanupAll();
        setAudioLevel(0);
        setStatus(STATUS.STOPPED);
    }, [cleanupAll]);

    // Auto-start on mount
    useEffect(() => {
        start();
    }, [start]);

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const audioHint = audioLevel < 5 ? t('mobileNoAudio')
        : audioLevel < 20 ? t('mobileSpeakLouder')
        : t('mobileGoodLevel');

    return (
        <div style={{ textAlign: 'center', position: 'relative' }}>

            {fingerprint && verifyResolveRef.current && (
                <VerificationModal
                    fingerprint={fingerprint}
                    prompt={t('verifyPrompt')}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center', marginTop: hasRecorded ? 0 : '1.5rem' }}>
                        <button onClick={startMicCapture} style={styles.newRecordingButton}>
                            {t('mobileStartNewBtn')}
                        </button>
                    </div>
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
