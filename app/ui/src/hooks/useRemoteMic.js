// The remote microphone ("phone as mic"): the encrypted WebRTC session with the
// phone, its handshake and fingerprint verification, the PCM it streams in, and
// the batch that is handed to the transcription core as if it were an upload.
//
// The second cluster lifted out of App(). It is the most contiguous seam in the
// file: startRemoteMic .. cancelRemoteMic was one unbroken 635-line run, and of
// the 52 names it defines only 22 are read anywhere else. Everything else (the
// RTC handle, the ECDH key, the sample-rate and format negotiation, the
// handshake-in-progress and verify-resolver refs, the elapsed timer, the QR
// script loader) is now private to the feature.
//
// What deliberately stayed in App.jsx: the PCM slab buffer (`pcmChunksRef` and
// its append/concat/clear helpers), because local recording fills the same
// buffer, and the three audio preferences (noise suppression, AGC, gain), which
// are persisted settings the sidebar owns. The hook takes them as inputs.
//
// Built with Claude Code.

import { useState, useRef, useEffect, useCallback } from 'react';
import { RemoteMicRTC } from '../lib/remote-webrtc.js';
import { resamplePcmTo16k, createWavBlob } from '../lib/audio.js';
import { sanitizeDeviceName } from '../lib/format.js';
import {
    generateKeyPair, exportPublicKey, importPublicKey,
    deriveSharedKey, decrypt
} from '../lib/remote-crypto.js';
import {
    getAdaptiveFingerprintLength, computePairFingerprintForRole
} from '../lib/remote-mic-handshake.js';

/**
 * @param {object} deps  everything the remote mic needs from the rest of App().
 * @param {(key:string)=>string} deps.t                    i18n lookup.
 * @param {boolean} deps.isRecording                       local recording is live (blocks a pairing).
 * @param {() => void} deps.clearPcmChunks                 shared PCM slab buffer, also fed by local recording.
 * @param {(chunk:Float32Array) => void} deps.appendPcmChunk
 * @param {() => Float32Array} deps.concatPcmChunks
 * @param {boolean} deps.noiseSuppression                  persisted audio prefs, mirrored to the phone.
 * @param {boolean} deps.autoGainControl
 * @param {number} deps.remoteMicGain
 * @param {(s:string)=>void} deps.setStatus
 * @param {(b:boolean)=>void} deps.setAwaitingFinal
 * @param {{current:object}} deps.modelRef                 the loaded model, or null while it loads.
 * @param {{current:boolean}} deps.isTranscribingRef
 * @param {(job:object)=>void} deps.submitCapture         queues a batch that arrives before the model is ready.
 * @param {() => void} deps.maybeStartLiveTranscriber
 * @param {() => void} deps.stopLiveTranscriberIfRunning
 */
export function useRemoteMic({
  t,
  isRecording,
  clearPcmChunks,
  appendPcmChunk,
  concatPcmChunks,
  noiseSuppression,
  autoGainControl,
  remoteMicGain,
  setStatus,
  setAwaitingFinal,
  modelRef,
  isTranscribingRef,
  submitCapture,
  maybeStartLiveTranscriber,
  stopLiveTranscriberIfRunning,
}) {
  // Hard cap on remote-mic PCM sample accumulation. A compromised phone that
  // completes the handshake but never sends `audio-end` would otherwise grow
  // pcmChunksRef without bound and OOM the tab. 10 minutes at the highest
  // accepted sample rate (96 kHz) is the safety ceiling; in normal use the
  // phone streams at 48 kHz so the real-time ceiling is ~20 minutes.
  const REMOTE_MIC_MAX_SAMPLES = 10 * 60 * 96000;

  const remoteMicSampleCountRef = useRef(0);
  // F-82: serialises processRemoteMicBatch invocations triggered by
  // back-to-back phone audio-end messages, so concurrent transcribe()
  // calls don't race on the shared ORT session and corrupt the user's
  // transcript history. Holds the in-flight Promise, or null.
  const inFlightBatchRef = useRef(null);
  // F-81 / F-84: tracks whether the phone has sent a valid audio-config
  // for the CURRENT recording session. Reset by processRemoteMicBatch
  // (after audio-end drains chunks) so each new recording starts a fresh
  // sample-rate negotiation. A second audio-config mid-stream is a
  // protocol violation that we close the channel on, rather than letting
  // it silently switch the resampler's source rate.
  const remoteMicAudioConfiguredRef = useRef(false);

  // Clear the shared PCM slabs AND this feature's own counters. clearPcmChunks
  // used to reset the two refs below itself, which meant a helper shared with
  // local recording reached into remote-mic state; every remote path that
  // cleared the buffer went through it, so they all go through this instead.
  const resetRemoteMicBuffer = () => {
    clearPcmChunks();
    remoteMicSampleCountRef.current = 0;
    remoteMicAudioConfiguredRef.current = false;
  };

  // Remote microphone state
  const [isRemoteMic, setIsRemoteMic] = useState(false);
  const [remoteMicModal, setRemoteMicModal] = useState(false);
  const [remoteMicStatus, setRemoteMicStatus] = useState(''); // connecting|waiting|connected|stopped|error
  const [remoteMicQrUrl, setRemoteMicQrUrl] = useState('');
  const [remoteMicLevel, setRemoteMicLevel] = useState(0);
  const [remoteMicElapsed, setRemoteMicElapsed] = useState(0);
  const [remoteMicError, setRemoteMicError] = useState('');
  const [remoteMicDecryptErrors, setRemoteMicDecryptErrors] = useState(0);
  const [remoteMicPaused, setRemoteMicPaused] = useState(false);
  const [remoteMicRecording, setRemoteMicRecording] = useState(false);
  const remoteMicRtcRef = useRef(null);
  const remoteMicKeyRef = useRef(null);
  const remoteMicSampleRateRef = useRef(16000);
  // Wire format of incoming binary chunks for the current recording. Set
  // from the audio-config message: 'pcm-s16' (Int16, ~v5.4.6+ phone) or
  // 'pcm-f32' (legacy Float32). Defaults to 'pcm-f32' so a phone running
  // an older bundle still works after this desktop upgrade.
  const remoteMicFormatRef = useRef('pcm-f32');
  const remoteMicTimerRef = useRef(null);
  const remoteMicQrRef = useRef(null); // DOM ref for QR code container
  // Fingerprint compare modal: shown after both ECDH public keys are exchanged
  // and before any encrypted audio is processed. Mitigates a malicious
  // signaling server that could swap keys to MITM the data channel.
  const [remoteMicFingerprint, setRemoteMicFingerprint] = useState('');
  // Timestamp of the most-recent successful fingerprint confirmation. The
  // sharedKey lives for the lifetime of the WebRTC connection across many
  // Start/Stop cycles; this surfaces that fact to the user so they
  // understand they are NOT re-verifying per recording. F-68: re-verifying
  // requires disconnecting the phone and re-pairing via fresh QR.
  const [remoteMicVerifiedAt, setRemoteMicVerifiedAt] = useState(null);
  const remoteMicVerifyResolveRef = useRef(null); // (boolean) => void
  // F-63: bilateral verify-ok ack. After local user confirms the fingerprint
  // we still wait for the peer's verify-ok before transitioning to the
  // operational ('connected') state. Otherwise an attacker who controls one
  // side (or a flaky network) could leave one peer streaming audio into a
  // half-aborted session: the local side believes verification succeeded
  // even though the remote user actually denied (or never responded).
  // Waiting for the explicit peer ack collapses that ambiguous window.
  const remoteMicPeerAckResolveRef = useRef(null); // (boolean) => void
  // Buffer for a peer verify-ok/deny that arrives BEFORE the local user
  // clicks confirm on the fingerprint modal. Whichever peer confirms first
  // sends verify-ok while the other is still staring at the modal; without
  // this buffer that early message hits the peer-ack handler with no
  // resolver armed yet, gets discarded as "stray", and the locally-late
  // peer then waits 60s for a message that already arrived. Values: true
  // (peer sent verify-ok), false (peer sent verify-deny), null (no early
  // arrival). Cleared on every handshake start/teardown via
  // resolveRemoteMicPeerAck so a fresh re-pair never inherits stale state.
  const remoteMicEarlyPeerVerifyRef = useRef(null);
  // F-137: synchronous handshake-in-progress flag. The duplicate-handshake
  // guard at the top of the 'sender-public-key' branch checks
  // remoteMicKeyRef / remoteMicVerifyResolveRef, but those refs are only
  // populated AFTER several awaits (importPublicKey, deriveSharedKey,
  // getAdaptiveFingerprintLength, computePairFingerprintForRole). A
  // malicious phone that sends two sender-public-key messages back-to-back
  // would see both pass the guard, both compute fingerprints, and the
  // second assignment to verifyResolveRef.current would clobber the first
  // resolver, orphaning the first ECDH closure. Setting this ref to true
  // synchronously before the first await closes that multi-await window.
  const remoteMicHandshakeInProgressRef = useRef(false);
  // Resolve any in-flight fingerprint verify and null the ref. Every teardown
  // path (onDisconnected, cancelRemoteMic, regenerateRemoteMicQr,
  // disconnectRemoteMic) must call this so the awaiting Promise inside
  // startRemoteMic doesn't hang and pin the ECDH private key in a dead
  // closure (a slow memory-pressure DoS if the attacker stacks attempts).
  const resolveRemoteMicVerify = useCallback((confirmed) => {
    if (remoteMicVerifyResolveRef.current) {
      remoteMicVerifyResolveRef.current(confirmed);
      remoteMicVerifyResolveRef.current = null;
    }
  }, []);
  const resolveRemoteMicPeerAck = useCallback((confirmed) => {
    if (remoteMicPeerAckResolveRef.current) {
      remoteMicPeerAckResolveRef.current(confirmed);
      remoteMicPeerAckResolveRef.current = null;
    }
    remoteMicEarlyPeerVerifyRef.current = null;
    // F-137: every teardown path funnels through here (onDisconnected,
    // cancelRemoteMic, regenerateRemoteMicQr, disconnectRemoteMic), so
    // clearing the handshake-in-progress flag here lets a re-pair claim
    // a fresh slot. The success path clears it explicitly after binding.
    remoteMicHandshakeInProgressRef.current = false;
  }, []);

  // Tiny helpers so the elapsed-timer setup/teardown is in one place — used to
  // be inlined ~7 times across the remote-mic flow which made changes risky.
  const stopRemoteMicTimer = useCallback(() => {
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
  }, []);
  const startRemoteMicTimer = useCallback(() => {
    stopRemoteMicTimer();
    const startTime = Date.now();
    remoteMicTimerRef.current = setInterval(() => {
      setRemoteMicElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, [stopRemoteMicTimer]);

  // Load QR code library when remote mic modal opens; returns a promise that resolves when ready.
  // qrLibRef captures the library object at the moment SRI-validated script
  // execution finishes, so subsequent uses no longer probe `window.QRCode`.
  // That global lookup is DOM-clobberable (an injected element with id or
  // name "QRCode" would shadow it); reading once after onload eliminates
  // the surface even before CSP lands.
  const qrLibRef = useRef(null);
  const loadQRCode = useRef(null);
  if (!loadQRCode.current) {
    loadQRCode.current = new Promise((resolve, reject) => {
      if (qrLibRef.current) { resolve(); return; }
      const script = document.createElement('script');
      script.src = '/js/qrcode.min.js';
      // SRI hash of app/ui/public/js/qrcode.min.js. If you replace that
      // file, recompute with: openssl dgst -sha384 -binary <file> | base64
      script.integrity = 'sha384-HGmnkDZJy7mRkoARekrrj0VjEFSh9a0Z8qxGri/kTTAJkgR8hqD1lHsYSh3JdzRi';
      script.crossOrigin = 'anonymous';
      // Wall-clock timeout: a network attacker who holds the script TCP
      // connection open without sending the close-of-body byte (slowloris)
      // would otherwise pin this Promise forever, hanging every consumer
      // of loadQRCode.current and breaking QR display until page reload.
      // 15 s is well past a normal LAN/WAN fetch of a ~10 KB script.
      let settled = false;
      const settle = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
      const timer = setTimeout(() => settle(() => {
        loadQRCode.current = null; // allow next attempt to retry the load
        reject(new Error('QR script load timed out'));
      }), 15000);
      script.onload = () => settle(() => {
        qrLibRef.current = window.QRCode;
        console.log('[RemoteMic] QR code library loaded');
        setTimeout(resolve, 0);
      });
      script.onerror = (e) => settle(() => {
        loadQRCode.current = null;
        reject(new Error('QR script load error'));
      });
      document.head.appendChild(script);
    });
    // Swallow unhandled-rejection noise from the load Promise itself; the
    // consumers attach their own .catch handlers where they care.
    loadQRCode.current.catch(() => {});
  }

  // Render QR code when both the URL is set and the DOM ref is available (status===waiting)
  useEffect(() => {
    if (!remoteMicQrUrl || remoteMicStatus !== 'waiting') return;
    loadQRCode.current.then(() => {
      if (remoteMicQrRef.current && qrLibRef.current) {
        const canvas = document.createElement('canvas');
        qrLibRef.current.toCanvas(canvas, remoteMicQrUrl, {
          width: 220,
          margin: 2,
          errorCorrectionLevel: 'M',
        }).then(() => {
          if (remoteMicQrRef.current) {
            // Clear previous QR (if any) and swap in the new canvas atomically.
            remoteMicQrRef.current.innerHTML = '';
            remoteMicQrRef.current.appendChild(canvas);
          }
        });
      }
    }).catch(err => {
      console.warn('[RemoteMic] QR library unavailable, skipping QR render:', err.message);
    });
  }, [remoteMicQrUrl, remoteMicStatus]);

  // Keep the phone's getUserMedia constraints + gain in sync with the
  // desktop. Fires on first bind (isRemoteMic flips to true) and on any
  // subsequent change. The phone applies the toggles on its next
  // startMicCapture (active tracks aren't retroactively mutated); the
  // gain is applied live on its GainNode so the slider gives immediate
  // feedback mid-recording.
  useEffect(() => {
    if (!isRemoteMic) return;
    const rtc = remoteMicRtcRef.current;
    if (!rtc) return;
    try {
      rtc.sendMessage({
        type: 'audio-settings',
        noiseSuppression,
        autoGainControl,
        gain: remoteMicGain,
      });
    } catch (_) { /* channel may be closing */ }
  }, [isRemoteMic, noiseSuppression, autoGainControl, remoteMicGain]);

  // ============ Remote Microphone (Phone as Mic) ============

  // `existingRoom` ({ roomId, secret }) re-arms a dropped session on the SAME
  // room instead of minting a new one: the phone disconnected and we want to
  // keep the same QR on screen and wait for it to come back. A fresh offer
  // alone is not enough (the server still holds the prior session's answer +
  // ICE), so we adopt the room id/secret on a new RTC and re-arm it first.
  async function startRemoteMic(existingRoom = null) {
    if (!existingRoom && (isRecording || isRemoteMic)) return;

    setRemoteMicModal(true);
    // On a re-arm, keep the existing QR visible ('waiting') instead of
    // flashing 'connecting' and blanking it.
    setRemoteMicStatus(existingRoom ? 'waiting' : 'connecting');
    setRemoteMicError('');
    setRemoteMicDecryptErrors(0);
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    resetRemoteMicBuffer();
    remoteMicSampleRateRef.current = 16000;
    remoteMicFormatRef.current = 'pcm-f32';

    try {
      const rtc = new RemoteMicRTC('/api/signal');
      remoteMicRtcRef.current = rtc;

      await rtc.init();
      let roomId, secret;
      if (existingRoom) {
        rtc.adoptRoom(existingRoom.roomId, existingRoom.secret);
        await rtc.rearmRoom();
        ({ roomId, secret } = existingRoom);
      } else {
        ({ roomId, secret } = await rtc.createRoom());
      }

      // Generate ECDH key pair for E2E encryption
      const keyPair = await generateKeyPair();
      const ourKeyBase64 = await exportPublicKey(keyPair.publicKey);

      rtc.onDisconnected = () => {
        console.log('[RemoteMic] Disconnected');
        // Keep the SAME QR up and re-arm the room so the phone can reconnect
        // (auto-retry, or a fresh camera scan of the same QR) without the user
        // having to mint a new code. stopRemoteMicTimer/resolve the pending
        // handshake waits and tear down the dead session first.
        stopRemoteMicTimer();
        resolveRemoteMicVerify(false);
        resolveRemoteMicPeerAck(false);
        // F-88: onDisconnected used to null the ref without closing the
        // underlying RTCPeerConnection, leaving its ICE poll setInterval
        // alive against the signaling server for any disconnected-not-
        // failed state (mobile network flap, ICE restart). Close
        // explicitly so the poll self-clears via the `closed` branch.
        try { remoteMicRtcRef.current?.close(); } catch (_) { /* already closing */ }
        remoteMicRtcRef.current = null;
        remoteMicKeyRef.current = null;
        resetRemoteMicBuffer();
        setRemoteMicVerifiedAt(null);
        setIsRemoteMic(false);
        setRemoteMicRecording(false);
        setRemoteMicLevel(0);
        setRemoteMicPaused(false);
        // Re-arm the same room and resume waiting with the same QR. If the
        // room has since expired (or any re-arm step fails), startRemoteMic's
        // catch drops to the 'disconnected' state so the user can mint a new
        // QR. The QR URL is left in place so it stays on screen meanwhile.
        setRemoteMicStatus('waiting');
        setRemoteMicModal(true);
        startRemoteMic({ roomId, secret });
      };

      // Handle incoming messages (JSON control + binary audio)
      rtc.onMessage = async (data) => {
        if (typeof data === 'string') {
          // F-122: bound the JSON parser input. Control messages are tiny
          // (handshake, audio-config, verify-ok/deny, paused/resumed). 4 KB
          // is generous and caps a hostile phone's per-message allocation
          // burst irrespective of the SCTP NDATA max-message-size.
          if (data.length > 4096) {
            console.warn('[RemoteMic] Dropping oversized control message:', data.length, 'bytes');
            return;
          }
          try {
            const msg = JSON.parse(data);
            // F-83: gate audio-* and pause/resume control messages on a
            // verified session. Before peer-ack completes (and thus
            // before remoteMicKeyRef is bound), the only legitimate
            // control messages are the handshake set (sender-public-key,
            // verify-ok, verify-deny). audio-config / audio-end /
            // paused / resumed sent during the verify modal must NOT
            // flip recording state, start the live transcriber, or
            // poison sample-rate refs. The binary path already gates on
            // remoteMicKeyRef.current; mirror that here.
            const SESSION_GATED_TYPES = new Set(['audio-config', 'audio-end', 'paused', 'resumed']);
            if (SESSION_GATED_TYPES.has(msg.type) && !remoteMicKeyRef.current) {
              console.warn(`[RemoteMic] Ignoring ${msg.type} before peer-ack (no shared key yet)`);
              return;
            }
            if (msg.type === 'sender-public-key') {
              // Refuse a second handshake once one is already bound or in
              // flight. Otherwise a malicious phone could overwrite
              // remoteMicKeyRef.current mid-stream (silent key swap on the
              // victim) or orphan the previous verify resolver, pinning
              // the original ECDH private key in a dead closure.
              //
              // F-137: include the synchronous in-progress flag. The two
              // other refs are only populated after several awaits below
              // (importPublicKey, deriveSharedKey, stats fetch, fingerprint
              // hash), and a flood of sender-public-key messages would
              // otherwise all pass this guard before any of them reaches
              // the verifyResolveRef assignment.
              if (remoteMicKeyRef.current || remoteMicVerifyResolveRef.current || remoteMicHandshakeInProgressRef.current) {
                console.warn('[RemoteMic] Ignoring duplicate sender-public-key — handshake already bound or in-flight');
                return;
              }
              remoteMicHandshakeInProgressRef.current = true;
              // Derive shared key from phone's public key
              const theirKey = await importPublicKey(msg.key);
              const sharedKey = await deriveSharedKey(keyPair.privateKey, theirKey);
              console.log('[RemoteMic] Shared key derived, asking user to verify fingerprint');

              // Compute a short adaptive fingerprint over both pubkeys.
              // The shared helper enforces the same byte order on both sides
              // (receiver-pub first, sender-pub second) — diverging here would
              // silently break the MITM defence.
              const hexLen = await getAdaptiveFingerprintLength();
              const fp = await computePairFingerprintForRole('receiver', keyPair.publicKey, theirKey, hexLen);
              setRemoteMicFingerprint(fp);

              // Block here until the user clicks Confirm or Deny in the modal.
              const confirmed = await new Promise((resolve) => {
                remoteMicVerifyResolveRef.current = resolve;
              });
              setRemoteMicFingerprint('');
              remoteMicVerifyResolveRef.current = null;

              if (!confirmed) {
                console.warn('[RemoteMic] User denied fingerprint match — aborting');
                rtc.sendMessage({ type: 'verify-deny' });
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              rtc.sendMessage({ type: 'verify-ok' });

              // F-63: wait for the phone's reciprocal verify-ok before
              // binding the shared key and flipping to 'connected'. A 60s
              // cap avoids hanging if the phone crashed or the user
              // walked away mid-handshake; in normal use both peers ack
              // within a second of each other.
              const PEER_ACK_TIMEOUT_MS = 60000;
              let peerAckTimer = null;
              const peerAcked = await new Promise((resolve) => {
                // If the phone confirmed before we did, its verify-ok (or
                // verify-deny) was buffered while our modal was up. Consume
                // it now instead of arming a 60s wait for a message that
                // already arrived.
                if (remoteMicEarlyPeerVerifyRef.current !== null) {
                  const early = remoteMicEarlyPeerVerifyRef.current;
                  remoteMicEarlyPeerVerifyRef.current = null;
                  resolve(early);
                  return;
                }
                remoteMicPeerAckResolveRef.current = resolve;
                peerAckTimer = setTimeout(() => {
                  if (remoteMicPeerAckResolveRef.current) {
                    remoteMicPeerAckResolveRef.current(false);
                    remoteMicPeerAckResolveRef.current = null;
                  }
                }, PEER_ACK_TIMEOUT_MS);
              });
              if (peerAckTimer) clearTimeout(peerAckTimer);
              remoteMicPeerAckResolveRef.current = null;

              if (!peerAcked) {
                console.warn('[RemoteMic] Peer did not ack verify-ok (deny or timeout), aborting');
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }

              remoteMicKeyRef.current = sharedKey;
              // F-137: handshake is now bound, future sender-public-key
              // messages are caught by the remoteMicKeyRef guard.
              remoteMicHandshakeInProgressRef.current = false;
              setRemoteMicVerifiedAt(Date.now());
              setRemoteMicStatus('connected');
              setRemoteMicModal(false); // close setup modal; use main UI from here
              setRemoteMicPaused(false);
              setIsRemoteMic(true);

              startRemoteMicTimer();
            } else if (msg.type === 'verify-ok') {
              // F-63: phone confirmed its end. Three cases:
              //  (a) Our peer-ack wait is already armed -> resolve it.
              //  (b) Session already bound (remoteMicKeyRef set) -> stale
              //      replay, ignore.
              //  (c) Otherwise the phone confirmed before us; buffer the
              //      arrival so the peer-ack wait consumes it as soon as
              //      the local user clicks confirm. Without (c) the
              //      locally-late side would wait the full 60s timeout
              //      and surface a misleading "verifyAborted" error.
              if (remoteMicPeerAckResolveRef.current) {
                remoteMicPeerAckResolveRef.current(true);
              } else if (remoteMicKeyRef.current) {
                console.warn('[RemoteMic] Stray verify-ok ignored (session already bound)');
              } else {
                remoteMicEarlyPeerVerifyRef.current = true;
                console.log('[RemoteMic] Peer verify-ok arrived before local confirm, buffered');
              }
            } else if (msg.type === 'verify-deny') {
              // Phone denied the fingerprint match, abort our side too.
              // Could arrive (a) before local confirm (verifyResolve in
              // flight), or (b) after local confirm while we're awaiting
              // the peer ack (peerAckResolve in flight).
              //
              // F-87: ignore verify-deny once peer-ack has completed
              // (remoteMicKeyRef is set). Otherwise a malicious phone
              // could send verify-deny mid-session to wipe the user's
              // in-flight transcript with a misleading "verifyAborted"
              // error message. After the handshake is bound the
              // legitimate teardown signal is rtc disconnect, not a
              // protocol message.
              if (remoteMicVerifyResolveRef.current) {
                remoteMicVerifyResolveRef.current(false);
              } else if (remoteMicPeerAckResolveRef.current) {
                remoteMicPeerAckResolveRef.current(false);
              } else if (!remoteMicKeyRef.current) {
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
              } else {
                console.warn('[RemoteMic] Ignoring verify-deny after peer-ack (session already bound)');
              }
            } else if (msg.type === 'audio-config') {
              // Validate the phone-supplied sample rate before letting it
              // reach the resampler / live transcriber. NaN, 0, negatives,
              // strings, and absurd values would otherwise wedge UI in a
              // stuck "connected" state via an unhandled rejection from
              // OfflineAudioContext or a divide-by-zero in totalSec math.
              //
              // F-81: refuse a second audio-config inside the same
              // recording. The live transcriber binds to the first rate
              // and won't re-bind; the batch resampler reads the current
              // ref, so a mid-stream rate swap would corrupt the final
              // transcript in a way that looks like model error.
              if (remoteMicAudioConfiguredRef.current) {
                console.error('[RemoteMic] Duplicate audio-config mid-recording, closing');
                setRemoteMicError(t('remoteMicInvalidConfig'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              const sr = msg.sampleRate;
              if (!Number.isInteger(sr) || sr < 8000 || sr > 96000) {
                console.error('[RemoteMic] Invalid audio-config sampleRate:', sr);
                setRemoteMicError(t('remoteMicInvalidConfig'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              // F-138: validate the optional format hint. An unknown
              // format string would silently land us in the f32 branch
              // and decode Int16 bytes as Float32 (or vice versa),
              // producing a buffer of NaN-or-near-zero noise without any
              // user-visible error. Fall back to 'pcm-f32' for legacy
              // phones that don't send the field, refuse anything else.
              let format = 'pcm-f32';
              if (msg.format !== undefined) {
                if (msg.format !== 'pcm-f32' && msg.format !== 'pcm-s16') {
                  console.error('[RemoteMic] Invalid audio-config format:', msg.format);
                  setRemoteMicError(t('remoteMicInvalidConfig'));
                  setRemoteMicStatus('error');
                  rtc.close();
                  return;
                }
                format = msg.format;
              }
              // Optional source hint: 'mic' (live recording, default) or
              // 'file' (a saved file the phone decoded and is pumping faster
              // than real time). Validate it like format; an unknown value is
              // refused rather than silently ignored so protocol drift is
              // visible. The only behavioural effect is skipping the live
              // transcriber for files (see below).
              let source = 'mic';
              if (msg.source !== undefined) {
                if (msg.source !== 'mic' && msg.source !== 'file') {
                  console.error('[RemoteMic] Invalid audio-config source:', msg.source);
                  setRemoteMicError(t('remoteMicInvalidConfig'));
                  setRemoteMicStatus('error');
                  rtc.close();
                  return;
                }
                source = msg.source;
              }
              remoteMicAudioConfiguredRef.current = true;
              remoteMicSampleRateRef.current = sr;
              remoteMicFormatRef.current = format;
              console.log(`[RemoteMic] Phone sample rate: ${sr}Hz, format: ${format}, source: ${source}`);
              setRemoteMicRecording(true);
              startRemoteMicTimer();
              // Phone audio is buffered into the same pcmChunksRef the local
              // path uses, so the live transcriber works without any other
              // wiring. Pass a getSampleRate() that reads the phone's rate.
              // Skip it for a saved file: the phone pumps faster than real
              // time, so the sliding-window live pass is pure wasted compute
              // (and competes with the final batch for the shared ORT
              // session); the audio-end batch is the authoritative transcript.
              if (source !== 'file') {
                maybeStartLiveTranscriber({ sampleRate: remoteMicSampleRateRef.current });
              }
            } else if (msg.type === 'audio-end') {
              console.log('[RemoteMic] Phone stopped recording, processing batch...');
              // Set awaitingFinal before flipping remoteMicRecording so the
              // live transcript banner stays visible without flicker.
              setAwaitingFinal(true);
              setRemoteMicRecording(false);
              await stopLiveTranscriberIfRunning();
              // F-82: serialise batch processing. processRemoteMicBatch
              // calls modelRef.current.transcribe against a SHARED ORT
              // session; concurrent invocations either queue silently
              // (breaking the live-pcm freshness invariant) or race on
              // the encoder's intermediate tensors and emit garbage
              // tokens into the user's transcript. await any prior
              // in-flight batch before starting the next.
              if (inFlightBatchRef.current) {
                try { await inFlightBatchRef.current; } catch (_) { /* prior batch error already surfaced */ }
              }
              const thisBatch = processRemoteMicBatch();
              inFlightBatchRef.current = thisBatch;
              thisBatch.finally(() => {
                if (inFlightBatchRef.current === thisBatch) inFlightBatchRef.current = null;
              });
            } else if (msg.type === 'paused') {
              // F-89: only honour paused/resumed while remoteMicRecording
              // is active. Outside a recording these messages can only
              // desync the UI from reality (showing "paused" while the
              // phone is idle, or "resumed" with nothing to resume).
              if (remoteMicRecording) setRemoteMicPaused(true);
              else console.warn('[RemoteMic] Ignoring paused: not recording');
            } else if (msg.type === 'resumed') {
              if (remoteMicRecording) setRemoteMicPaused(false);
              else console.warn('[RemoteMic] Ignoring resumed: not recording');
            } else {
              // Catches protocol drift between desktop and phone bundles —
              // silently dropping unknown types makes mismatches invisible.
              console.warn('[RemoteMic] Unknown control message type:', msg.type);
            }
          } catch (e) {
            // F-86: a throw inside any control-message handler used to
            // be only console.error'd, leaving the UI in 'waiting' or
            // 'connecting' with the QR still up and no user-visible
            // indication of failure. importPublicKey throws on
            // malformed base64 / wrong byte length, deriveSharedKey
            // throws on incompatible curve points, and the in-flight
            // verify resolver would dangle. Tear the session down so
            // the user can retry instead of staring at a wedged modal.
            console.error('[RemoteMic] Error handling control message:', e);
            resolveRemoteMicVerify(false);
            resolveRemoteMicPeerAck(false);
            setRemoteMicError(`Handshake error (${e?.message || 'unknown'})`);
            setRemoteMicStatus('error');
            try { rtc.close(); } catch (_) { /* already closing */ }
          }
        } else {
          // Binary data: encrypted audio chunk
          if (!remoteMicKeyRef.current) return;
          // F-84: refuse binary chunks until the phone has announced its
          // sample rate via audio-config. Without this gate a hostile
          // phone bundle (e.g. a coerced spousal-monitoring build) could
          // skip the audio-config step entirely and stream chunks against
          // the default 16 kHz rate. pcmChunksRef would accumulate and
          // reach the model on the next
          // audio-end, but remoteMicRecording would stay false the whole
          // time so the desktop's UI would show no recording indicator.
          // Dropping chunks until audio-config arrives keeps the
          // "phone is sending audio" state observable on screen.
          if (!remoteMicAudioConfiguredRef.current) {
            console.warn('[RemoteMic] Dropping binary chunk: no audio-config received yet');
            return;
          }
          // F-85: reject oversized binary messages BEFORE allocating the
          // Float32Array. F-01 caps cumulative samples but a single
          // decrypt of an N-byte ciphertext still allocates Float32Array
          // of length N/4 and synchronously RMS-scans it on the main
          // thread. 256 KiB caps a single chunk well above any honest
          // phone payload (16 kHz mono Float32 at 100 ms = 6400 bytes;
          // 96 kHz at 100 ms = 38400 bytes; even a 500 ms burst at
          // 96 kHz is 192 000 bytes) while bounding the main-thread
          // stall a flooding phone can inflict.
          const REMOTE_MIC_MAX_BINARY_BYTES = 256 * 1024;
          if (data.byteLength > REMOTE_MIC_MAX_BINARY_BYTES) {
            console.warn(`[RemoteMic] Dropping binary chunk: ${data.byteLength} bytes exceeds ${REMOTE_MIC_MAX_BINARY_BYTES}`);
            setRemoteMicDecryptErrors((n) => n + 1);
            return;
          }
          try {
            const decrypted = await decrypt(data, remoteMicKeyRef.current);
            // Dispatch on the per-session format. 'pcm-s16' phones send
            // little-endian Int16 (~v5.4.6+, halves the wire size);
            // 'pcm-f32' phones send native-endian Float32 (legacy). Both
            // sides run on little-endian hardware in practice, so the
            // bare typed-array view is byte-order-correct without a
            // DataView pass. The format ref is set from audio-config and
            // is validated there; an unknown value can't reach this code.
            let float32;
            let sum = 0;
            const fmt = remoteMicFormatRef.current;
            if (fmt === 'pcm-s16') {
              if (decrypted.byteLength % 2 !== 0) {
                console.warn('[RemoteMic] Dropped pcm-s16 chunk: byteLength not a multiple of 2');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
              const int16 = new Int16Array(decrypted);
              float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) {
                const s = int16[i] / 0x8000;
                float32[i] = s;
                sum += s * s;
              }
            } else {
              if (decrypted.byteLength % 4 !== 0) {
                console.warn('[RemoteMic] Dropped pcm-f32 chunk: byteLength not a multiple of 4');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
              float32 = new Float32Array(decrypted);
              // AES-GCM authenticates the bytes but a peer holding the
              // legitimate key can still encrypt arbitrary 4-byte
              // patterns; NaN/Infinity would otherwise propagate into the
              // level meter, the resampler, and the model input,
              // silently corrupting the user's transcript. (No equivalent
              // check needed for pcm-s16: every 16-bit integer maps to a
              // finite float on the / 0x8000 line above.)
              let finite = true;
              for (let i = 0; i < float32.length; i++) {
                const s = float32[i];
                if (!Number.isFinite(s)) { finite = false; break; }
                sum += s * s;
              }
              if (!finite) {
                console.warn('[RemoteMic] Dropped chunk containing non-finite samples');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
            }
            // Drop chunks once the per-session sample cap is reached. The
            // first overflow surfaces an error; later chunks short-circuit
            // silently so a flooding phone can't spam the UI.
            if (remoteMicSampleCountRef.current >= REMOTE_MIC_MAX_SAMPLES) return;
            const newCount = remoteMicSampleCountRef.current + float32.length;
            if (newCount > REMOTE_MIC_MAX_SAMPLES) {
              remoteMicSampleCountRef.current = REMOTE_MIC_MAX_SAMPLES;
              console.error('[RemoteMic] Sample cap reached, dropping further audio chunks');
              setRemoteMicError(t('remoteMicCapExceeded'));
              return;
            }
            appendPcmChunk(float32);
            remoteMicSampleCountRef.current = newCount;
            const rms = Math.sqrt(sum / float32.length);
            setRemoteMicLevel(Math.min(100, rms * 250));
          } catch (e) {
            // Don't swallow this: the user thinks audio is being received,
            // but every chunk is failing — surface a running count so the
            // modal shows the loss instead of just the first error.
            console.warn('[RemoteMic] Decrypt error:', e.message);
            setRemoteMicDecryptErrors((n) => n + 1);
            setRemoteMicError(`Decryption failed (${e.message})`);
          }
        }
      };

      await rtc.createOfferAndStore();

      // Build QR code URL
      const baseUrl = window.location.origin;
      const qrUrl = `${baseUrl}/remote-mic.html#${roomId}:${secret}`;

      setRemoteMicStatus('waiting');
      setRemoteMicQrUrl(qrUrl);

      // Send our public key once the data channel opens, then wait for answer
      const originalOnConnected = rtc.onConnected;
      rtc.onConnected = () => {
        if (originalOnConnected) originalOnConnected();
        rtc.sendMessage({ type: 'public-key', key: ourKeyBase64 });
      };

      // Long-poll for the phone's answer (blocks until phone joins)
      await rtc.waitForAnswer();

    } catch (e) {
      console.error('[RemoteMic] Error:', e);
      // A failed re-arm almost always means the room expired while we waited
      // for the phone to come back: drop to 'disconnected' (offers a
      // "Generate new QR" button) rather than a dead-end 'error'.
      if (existingRoom) {
        setRemoteMicStatus('disconnected');
      } else {
        setRemoteMicStatus('error');
        setRemoteMicError(e.message || 'Connection failed');
      }
    }
  }

  // Process the current batch of remote mic audio and reset for next recording.
  // Keeps the RTC connection alive.
  async function processRemoteMicBatch() {
    // Stop elapsed timer and reset level
    stopRemoteMicTimer();
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    setRemoteMicPaused(false);

    const rawPcm = concatPcmChunks();
    const totalSamples = rawPcm.length;
    resetRemoteMicBuffer();

    if (totalSamples === 0) {
      console.log('[RemoteMic] No audio received in this batch');
      // Nothing to transcribe, so processAudioFile will not run and clear
      // the awaiting flag for us.
      setAwaitingFinal(false);
      return;
    }

    const sourceSampleRate = remoteMicSampleRateRef.current;
    console.log(`[RemoteMic] Captured ${totalSamples} samples at ${sourceSampleRate}Hz (${(totalSamples / sourceSampleRate).toFixed(2)}s)`);

    // Resample to 16kHz if needed
    const targetSampleRate = 16000;
    const pcm16k = await resamplePcmTo16k(rawPcm, sourceSampleRate);
    console.log(`[RemoteMic] Final: ${pcm16k.length} samples at 16kHz (${(pcm16k.length / 16000).toFixed(2)}s)`);

    // Build WAV and feed to the transcription core. It travels with the entry.
    const wavBlob = createWavBlob(pcm16k, targetSampleRate);
    const file = new File([wavBlob], `remote-mic-${Date.now()}.wav`, { type: 'audio/wav' });
    const safeName = sanitizeDeviceName(file.name, 'file');

    // Feed the already-16kHz PCM directly so we don't decode+resample the WAV a
    // second time (see stopRecording). Through the shared queue so a phone
    // batch captured while the model is still loading is transcribed once it is
    // ready (Q2) rather than dropped. As in stopRecording, don't reset the
    // status while another transcription is running (this batch just queues).
    if (modelRef.current && !isTranscribingRef.current) setStatus('modelReady');
    console.log('[RemoteMic] Queuing for transcription...');
    submitCapture({ pcm: pcm16k, opts: { safeName, audioDuration: pcm16k.length / targetSampleRate, audioBlob: wavBlob } });
  }

  async function stopRemoteMic() {
    // Stop current recording but keep phone session alive
    setAwaitingFinal(true);
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop-recording' }); } catch (_) {}
    }
    setRemoteMicRecording(false);
    setRemoteMicPaused(false);
  }

  async function disconnectRemoteMic() {
    // Full teardown, close RTC, phone goes to STOPPED
    setAwaitingFinal(true);
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop' }); } catch (_) {}
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    remoteMicKeyRef.current = null;
    stopRemoteMicTimer();
    setRemoteMicVerifiedAt(null);
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
  }

  function pauseRemoteMic() {
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.sendMessage({ type: 'pause' });
    }
    setRemoteMicPaused(true);
  }

  function resumeRemoteMic() {
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.sendMessage({ type: 'resume' });
    }
    setRemoteMicPaused(false);
  }

  function regenerateRemoteMicQr() {
    // Tear down leftover state and start fresh, produces a new roomId/secret/QR.
    stopRemoteMicTimer();
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.close(); } catch (_) {}
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    resetRemoteMicBuffer();
    setRemoteMicQrUrl('');
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
    setRemoteMicRecording(false);
    setIsRemoteMic(false);
    startRemoteMic();
  }

  function cancelRemoteMic() {
    stopRemoteMicTimer();
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    setRemoteMicVerifiedAt(null);
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicQrUrl('');
    resetRemoteMicBuffer();
  }

  return {
    // Session state the UI renders.
    isRemoteMic,
    remoteMicModal,
    remoteMicStatus,
    remoteMicLevel,
    remoteMicElapsed,
    remoteMicError,
    remoteMicDecryptErrors,
    remoteMicPaused,
    remoteMicRecording,
    remoteMicQrRef,
    // Fingerprint verification (the human MITM check).
    remoteMicFingerprint,
    remoteMicVerifiedAt,
    remoteMicVerifyResolveRef,
    // Controls.
    startRemoteMic,
    stopRemoteMic,
    pauseRemoteMic,
    resumeRemoteMic,
    disconnectRemoteMic,
    cancelRemoteMic,
    regenerateRemoteMicQr,
  };
}
