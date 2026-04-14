/**
 * Phone page for ParakeetWeb remote microphone feature.
 * Built with the help of Claude Code.
 *
 * Opens from QR code URL, captures microphone audio, encrypts it with
 * ECDH + AES-GCM, and streams PCM chunks over a WebRTC data channel
 * to the computer running ParakeetWeb.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteMicRTC } from './lib/remote-webrtc.js';
import {
    generateKeyPair, exportPublicKey, importPublicKey,
    deriveSharedKey, encrypt
} from './lib/remote-crypto.js';

const STATUS = {
    INIT: 'init',
    CONNECTING: 'connecting',
    WAITING_KEY: 'waiting_key',
    RECORDING: 'recording',
    STOPPED: 'stopped',
    ERROR: 'error',
};

function RemoteMicSender() {
    const [status, setStatus] = useState(STATUS.INIT);
    const [errorMsg, setErrorMsg] = useState('');
    const [audioLevel, setAudioLevel] = useState(0);
    const [elapsed, setElapsed] = useState(0);

    const rtcRef = useRef(null);
    const sharedKeyRef = useRef(null);
    const streamRef = useRef(null);
    const audioCtxRef = useRef(null);
    const workletRef = useRef(null);
    const timerRef = useRef(null);
    const levelAnimRef = useRef(null);
    const analyserRef = useRef(null);

    const cleanup = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (levelAnimRef.current) cancelAnimationFrame(levelAnimRef.current);
        if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null; }
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (rtcRef.current) { rtcRef.current.close(); rtcRef.current = null; }
    }, []);

    useEffect(() => {
        return cleanup;
    }, [cleanup]);

    const start = useCallback(async () => {
        try {
            // Parse room info from URL hash: #roomId:secret
            const hash = window.location.hash.substring(1);
            if (!hash || !hash.includes(':')) {
                setStatus(STATUS.ERROR);
                setErrorMsg('Invalid link. Please scan the QR code again.');
                return;
            }
            const [roomId, secret] = hash.split(':', 2);
            if (!roomId || !secret) {
                setStatus(STATUS.ERROR);
                setErrorMsg('Invalid link. Missing room ID or secret.');
                return;
            }

            setStatus(STATUS.CONNECTING);

            // Connect to signaling server
            const rtc = new RemoteMicRTC('/api/signal');
            rtcRef.current = rtc;

            await rtc.init();

            rtc.onDisconnected = () => {
                setStatus(STATUS.STOPPED);
                cleanup();
            };

            // Handle incoming messages (JSON control messages)
            rtc.onMessage = async (data) => {
                if (typeof data === 'string') {
                    try {
                        const msg = JSON.parse(data);
                        if (msg.type === 'public-key') {
                            // Computer sent its public key — derive shared key
                            setStatus(STATUS.WAITING_KEY);
                            const keyPair = await generateKeyPair();
                            const theirKey = await importPublicKey(msg.key);
                            sharedKeyRef.current = await deriveSharedKey(keyPair.privateKey, theirKey);

                            // Send our public key back
                            const ourKeyBase64 = await exportPublicKey(keyPair.publicKey);
                            rtc.sendMessage({ type: 'sender-public-key', key: ourKeyBase64 });

                            // Start mic capture
                            await startMicCapture();
                        } else if (msg.type === 'stop') {
                            // Computer requested stop
                            stopRecording();
                        }
                    } catch (e) {
                        console.error('[RemoteMic] Error handling message:', e);
                    }
                }
            };

            // Join the room (creates WebRTC connection)
            await rtc.joinRoom(roomId, secret);

        } catch (e) {
            console.error('[RemoteMic] Connection error:', e);
            setStatus(STATUS.ERROR);
            setErrorMsg(e.message || 'Connection failed');
        }
    }, [cleanup]);

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

            // Tell computer what sample rate we're actually using
            if (actualRate !== 16000) {
                rtcRef.current.sendMessage({ type: 'audio-config', sampleRate: actualRate });
            }

            const source = audioCtx.createMediaStreamSource(stream);

            // Audio level monitoring
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            analyserRef.current = analyser;

            const levelData = new Float32Array(analyser.fftSize);
            const updateLevel = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getFloatTimeDomainData(levelData);
                let sum = 0;
                for (let i = 0; i < levelData.length; i++) sum += levelData[i] * levelData[i];
                const rms = Math.sqrt(sum / levelData.length);
                setAudioLevel(Math.min(100, rms * 250));
                levelAnimRef.current = requestAnimationFrame(updateLevel);
            };
            levelAnimRef.current = requestAnimationFrame(updateLevel);

            // PCM capture via AudioWorklet (same worklet as main app)
            await audioCtx.audioWorklet.addModule('/pcm-recorder-worklet.js');
            const worklet = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor');
            workletRef.current = worklet;

            worklet.port.onmessage = async (e) => {
                const pcmChunk = e.data; // Float32Array
                if (!sharedKeyRef.current || !rtcRef.current) return;

                try {
                    const encrypted = await encrypt(pcmChunk.buffer, sharedKeyRef.current);
                    await rtcRef.current.sendBinary(encrypted);
                } catch (err) {
                    console.warn('[RemoteMic] Encrypt/send error:', err.message);
                }
            };

            source.connect(worklet);
            // AudioWorklet needs a destination to process (even if silent)
            worklet.connect(audioCtx.destination);

            setStatus(STATUS.RECORDING);

            // Start elapsed timer
            const startTime = Date.now();
            timerRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - startTime) / 1000));
            }, 1000);

        } catch (e) {
            console.error('[RemoteMic] Mic capture error:', e);
            setStatus(STATUS.ERROR);
            if (e.name === 'NotAllowedError') {
                setErrorMsg('Microphone access denied. Please grant permission and try again.');
            } else {
                setErrorMsg('Failed to capture microphone: ' + e.message);
            }
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (rtcRef.current) {
            rtcRef.current.sendMessage({ type: 'audio-end' });
        }
        setStatus(STATUS.STOPPED);
        cleanup();
    }, [cleanup]);

    // Auto-start on mount
    useEffect(() => {
        start();
    }, [start]);

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    return (
        <div style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: '1rem', fontSize: '1.3rem' }}>
                ParakeetWeb Remote Mic
            </h2>

            {status === STATUS.INIT && (
                <p style={{ color: '#9ca3af' }}>Initializing...</p>
            )}

            {status === STATUS.CONNECTING && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa' }}>Connecting to computer...</p>
                </div>
            )}

            {status === STATUS.WAITING_KEY && (
                <div>
                    <div style={styles.spinner} />
                    <p style={{ marginTop: '1rem', color: '#60a5fa' }}>Establishing encryption...</p>
                </div>
            )}

            {status === STATUS.RECORDING && (
                <div>
                    <div style={{
                        width: '120px', height: '120px', borderRadius: '50%',
                        background: `radial-gradient(circle, rgba(239,68,68,${0.3 + audioLevel / 150}) 0%, rgba(239,68,68,0.1) 70%)`,
                        border: '3px solid #ef4444',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '1rem auto',
                        transition: 'background 0.1s',
                    }}>
                        <div style={{
                            width: `${30 + audioLevel * 0.5}px`,
                            height: `${30 + audioLevel * 0.5}px`,
                            borderRadius: '50%',
                            background: '#ef4444',
                            transition: 'width 0.1s, height 0.1s',
                        }} />
                    </div>

                    <p style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.2rem' }}>
                        Recording {formatTime(elapsed)}
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

                    <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                        {audioLevel < 5 ? 'No audio detected' :
                         audioLevel < 20 ? 'Speak louder' : 'Audio level good'}
                    </p>

                    <button onClick={stopRecording} style={styles.stopButton}>
                        Stop Recording
                    </button>
                </div>
            )}

            {status === STATUS.STOPPED && (
                <div>
                    <p style={{ color: '#10b981', fontSize: '1.1rem', marginBottom: '1rem' }}>
                        Recording sent to computer.
                    </p>
                    <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                        You can close this page.
                    </p>
                </div>
            )}

            {status === STATUS.ERROR && (
                <div>
                    <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{errorMsg}</p>
                    <button onClick={() => { cleanup(); setStatus(STATUS.INIT); start(); }} style={styles.retryButton}>
                        Retry
                    </button>
                </div>
            )}
        </div>
    );
}

const styles = {
    spinner: {
        width: '40px', height: '40px', margin: '1rem auto',
        border: '4px solid #2a2a4a', borderTopColor: '#60a5fa',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
    },
    stopButton: {
        background: '#ef4444', color: 'white', border: 'none',
        borderRadius: '12px', padding: '1rem 2.5rem', fontSize: '1.1rem',
        fontWeight: 'bold', cursor: 'pointer', width: '80%',
    },
    retryButton: {
        background: '#3b82f6', color: 'white', border: 'none',
        borderRadius: '8px', padding: '0.75rem 2rem', fontSize: '1rem',
        cursor: 'pointer',
    },
};

// Inject keyframe animation for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleSheet);

const root = createRoot(document.getElementById('root'));
root.render(<RemoteMicSender />);
