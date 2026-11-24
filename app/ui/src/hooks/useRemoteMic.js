// The remote microphone ("phone as mic"): the encrypted WebRTC session with the
// phone, its handshake and key confirmation, the PCM it streams in, and
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
    deriveSessionKeys, generateQrSecret, DIRECTION_PHONE_TO_DESKTOP, DIRECTION_DESKTOP_TO_PHONE
} from '../lib/remote-crypto.js';
import {
    waitForDecision, KEY_CONFIRM,
    REMOTE_MIC_PROTOCOL, peerProtocolMatches, mustBeEncrypted
} from '../lib/remote-mic-handshake.js';
import { unpackFrame, createFrameVerifier, FRAME_AUDIO, FRAME_CONTROL } from '../lib/remote-mic-frames.js';
import { createFrameChannel } from '../lib/remote-mic-channel.js';
import { createSendRatchet, createRecvRatchet } from '../lib/remote-mic-rekey.js';
import { probeOpusSupport, advertisedCodecs, createOpusDecoder } from '../lib/remote-mic-opus.js';
import { createSerialQueue } from '../lib/writeQueue.js';
import { REMOTE_MIC_MAX_SAMPLES } from '../lib/remote-mic-limits.js';

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
  // Integrity check of the phone's framed stream (lib/remote-mic-frames.js):
  // contiguous seq + the END frame's totals. Replaced on every bound key.
  const remoteMicFramesRef = useRef(createFrameVerifier());
  // Binary frames are decrypted asynchronously; running them (and the
  // verifier bookkeeping triggered by audio-config / audio-end) through one
  // FIFO keeps them in arrival order, so audio-end judges the recording only
  // after every frame sent before it has been counted.
  const remoteMicFrameQueueRef = useRef(createSerialQueue());
  // Opus (lib/remote-mic-opus.js): which rates this browser's AudioDecoder
  // handles, probed once, and the current recording's decoder as
  // { decoder, failure } (failure: first decode error, fails the recording).
  const opusSupportRef = useRef(null);
  if (!opusSupportRef.current) opusSupportRef.current = probeOpusSupport();
  const remoteMicOpusRef = useRef(null);

  // Clear the shared PCM slabs AND this feature's own counters. clearPcmChunks
  // used to reset the two refs below itself, which meant a helper shared with
  // local recording reached into remote-mic state; every remote path that
  // cleared the buffer went through it, so they all go through this instead.
  const resetRemoteMicBuffer = () => {
    remoteMicOpusRef.current?.decoder.close();
    remoteMicOpusRef.current = null;
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
  // phone-to-desktop receive ratchet (lib/remote-mic-rekey.js): decrypts the phone's frames across rekeys; set once verified.
  const remoteMicKeyRef = useRef(null);
  // desktop-to-phone encrypted channel for our control messages
  // (lib/remote-mic-channel.js); set together with remoteMicKeyRef.
  const remoteMicChannelRef = useRef(null);
  const remoteMicSampleRateRef = useRef(16000);
  // Wire format of incoming binary chunks for the current recording. Set
  // from the audio-config message: 'pcm-s16' (Int16, ~v5.4.6+ phone) or
  // 'pcm-f32' (legacy Float32). Defaults to 'pcm-f32' so a phone running
  // an older bundle still works after this desktop upgrade.
  const remoteMicFormatRef = useRef('pcm-f32');
  const remoteMicTimerRef = useRef(null);
  const remoteMicQrRef = useRef(null); // DOM ref for QR code container
  // Timestamp of the moment the session keys were confirmed (the peer's
  // key-confirm decrypted). The keys live for the lifetime of the WebRTC
  // connection across many Start/Stop cycles; the main UI shows this time.
  const [remoteMicVerifiedAt, setRemoteMicVerifiedAt] = useState(null);
  // Handshake waiting for the phone's key-confirm: { key, frames, channel,
  // resolve } or null. The keys stay out of remoteMicKeyRef until the
  // confirm decrypts, so nothing else treats the session as bound early.
  const remoteMicPendingRef = useRef(null);
  // F-137: synchronous handshake-in-progress flag. remoteMicPendingRef is
  // only set after several awaits (importPublicKey, key derivation), so a
  // flood of sender-public-key messages would otherwise all pass the
  // duplicate guard before any of them reached the assignment.
  const remoteMicHandshakeInProgressRef = useRef(false);
  // Fail any pending key-confirm wait and clear the in-progress flag. Every
  // teardown path (onDisconnected, cancelRemoteMic, regenerateRemoteMicQr,
  // disconnectRemoteMic) must call this so the awaiting Promise inside
  // startRemoteMic does not hang and pin the ECDH private key in a dead
  // closure.
  const resolveRemoteMicConfirm = useCallback((ok) => {
    const pending = remoteMicPendingRef.current;
    remoteMicPendingRef.current = null;
    pending?.resolve(ok);
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
  // `codecs` advertises Opus decoding (lib/remote-mic-opus.js); the probe
  // takes a few ms and is awaited so the first audio-settings already has it.
  useEffect(() => {
    if (!isRemoteMic) return;
    let cancelled = false;
    opusSupportRef.current.ready.then((support) => {
      if (cancelled) return;
      sendRemoteMicControl({
        type: 'audio-settings',
        noiseSuppression,
        autoGainControl,
        gain: remoteMicGain,
        codecs: advertisedCodecs(support),
      });
    });
    return () => { cancelled = true; };
  }, [isRemoteMic, noiseSuppression, autoGainControl, remoteMicGain]);

  // ============ Remote Microphone (Phone as Mic) ============

  // `existingRoom` ({ roomId, secret, hostSecret, qrSecret }) re-arms a dropped session on the SAME
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
      // `secret` is the phone's credential (goes in the QR); `hostSecret`
      // authenticates this desktop and is never displayed.
      // `qrSecret` (K) only ever travels in the QR fragment, never to the
      // server; a re-arm keeps it so the QR on screen stays valid.
      let roomId, secret, hostSecret, qrSecret;
      if (existingRoom) {
        rtc.adoptRoom(existingRoom.roomId, existingRoom.hostSecret);
        await rtc.rearmRoom();
        ({ roomId, secret, hostSecret, qrSecret } = existingRoom);
      } else {
        ({ roomId, secret, hostSecret } = await rtc.createRoom());
        qrSecret = generateQrSecret();
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
        resolveRemoteMicConfirm(false);
        // F-88: onDisconnected used to null the ref without closing the
        // underlying RTCPeerConnection, leaving its ICE poll setInterval
        // alive against the signaling server for any disconnected-not-
        // failed state (mobile network flap, ICE restart). Close
        // explicitly so the poll self-clears via the `closed` branch.
        try { remoteMicRtcRef.current?.close(); } catch (_) { /* already closing */ }
        remoteMicRtcRef.current = null;
        remoteMicKeyRef.current = null;
        remoteMicChannelRef.current = null;
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
        startRemoteMic({ roomId, secret, hostSecret, qrSecret });
      };

      // Append one buffer of decoded phone audio (any format) to the shared
      // PCM slabs, updating the level meter. AES-GCM authenticates the bytes
      // but a peer holding the key can still send NaN/Infinity Float32 (or a
      // decoder could emit them); they would corrupt the level meter, the
      // resampler and the model input, so such a buffer is dropped.
      const ingestPcm = (float32) => {
        if (float32.length === 0) return;
        let sum = 0;
        for (let i = 0; i < float32.length; i++) {
          const s = float32[i];
          if (!Number.isFinite(s)) {
            console.warn('[RemoteMic] Dropped chunk containing non-finite samples');
            setRemoteMicDecryptErrors((n) => n + 1);
            return;
          }
          sum += s * s;
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
        setRemoteMicLevel(Math.min(100, Math.sqrt(sum / float32.length) * 250));
      };

      // The phone refused or sent a bad audio configuration: close the session.
      const refuseAudioConfig = (why, value) => {
        console.error(`[RemoteMic] ${why}:`, value);
        setRemoteMicError(t('remoteMicInvalidConfig'));
        setRemoteMicStatus('error');
        rtc.close();
      };

      // Apply one decrypted phone control message (audio-config, audio-end,
      // paused, resumed). Runs ON the frame queue, so it sees frames in arrival
      // order: frames before an audio-config count against the previous
      // recording, and audio-end judges the recording after every earlier
      // frame. Returns the integrity verdict for audio-end (the batch is then
      // processed off the queue, see finishPhoneRecording), null otherwise.
      const applyPhoneControl = (frame) => {
        const msg = frame.control;
        const verifier = remoteMicFramesRef.current;
        if (msg.type === 'audio-config') {
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
            refuseAudioConfig('Duplicate audio-config mid-recording', msg.sampleRate);
            return null;
          }
          const sr = msg.sampleRate;
          if (!Number.isInteger(sr) || sr < 8000 || sr > 96000) {
            refuseAudioConfig('Invalid audio-config sampleRate', sr);
            return null;
          }
          // F-138: an unknown format would decode Int16 bytes as Float32
          // (or vice versa) into noise without any visible error. 'opus' is
          // only valid at a rate we advertised a decoder for.
          const opusOk = msg.format === 'opus' && opusSupportRef.current.decode[sr] === true;
          if (msg.format !== 'pcm-f32' && msg.format !== 'pcm-s16' && !opusOk) {
            refuseAudioConfig('Invalid audio-config format', msg.format);
            return null;
          }
          // Optional source hint: 'mic' (live recording, default) or
          // 'file' (a saved file the phone decoded and is pumping faster
          // than real time). Refused rather than ignored when unknown so
          // protocol drift is visible. The only behavioural effect is
          // skipping the live transcriber for files (see below).
          const source = msg.source === undefined ? 'mic' : msg.source;
          if (source !== 'mic' && source !== 'file') {
            refuseAudioConfig('Invalid audio-config source', msg.source);
            return null;
          }
          // Begin before accepting, so a gap right before this audio-config
          // (a lost frame) fails the new recording instead of vanishing.
          verifier.beginRecording();
          verifier.accept(frame);
          remoteMicAudioConfiguredRef.current = true;
          remoteMicSampleRateRef.current = sr;
          remoteMicFormatRef.current = msg.format;
          remoteMicOpusRef.current?.decoder.close();
          remoteMicOpusRef.current = null;
          if (opusOk) {
            const opus = { failure: null };
            opus.decoder = createOpusDecoder(sr, ingestPcm, (err) => {
              console.warn('[RemoteMic] Opus decode error:', err.message);
              opus.failure ??= `opus decode failed (${err.message})`;
              setRemoteMicDecryptErrors((n) => n + 1);
            });
            remoteMicOpusRef.current = opus;
          }
          console.log(`[RemoteMic] Phone sample rate: ${sr}Hz, format: ${msg.format}, source: ${source}`);
          setRemoteMicRecording(true);
          startRemoteMicTimer();
          // Phone audio is buffered into the same pcmChunksRef the local
          // path uses, so the live transcriber works without any other
          // wiring. Skip it for a saved file: the phone pumps faster than
          // real time, so the sliding-window live pass is pure wasted
          // compute (and competes with the final batch for the shared ORT
          // session); the audio-end batch is the authoritative transcript.
          if (source !== 'file') {
            maybeStartLiveTranscriber({ sampleRate: remoteMicSampleRateRef.current });
          }
          return null;
        }
        verifier.accept(frame);
        if (msg.type === 'audio-end') {
          // Opus decodes asynchronously: wait for the last PCM before judging.
          const opus = remoteMicOpusRef.current;
          if (!opus) return verifier.finish({ requireEnd: true });
          return opus.decoder.flush().catch((e) => { opus.failure ??= `opus flush failed (${e.message})`; }).then(() => {
            const verdict = verifier.finish({ requireEnd: true });
            return opus.failure && verdict.ok ? { ok: false, reason: opus.failure } : verdict;
          });
        }
        if (msg.type === 'paused' || msg.type === 'resumed') {
          // F-89: only honour paused/resumed during a recording (between
          // audio-config and the batch reset). Outside one they can only
          // desync the UI from reality. Read from the ref: the
          // remoteMicRecording state captured by this closure is stale.
          if (remoteMicAudioConfiguredRef.current) setRemoteMicPaused(msg.type === 'paused');
          else console.warn(`[RemoteMic] Ignoring ${msg.type}: not recording`);
          return null;
        }
        // Catches protocol drift between desktop and phone bundles.
        console.warn('[RemoteMic] Unknown control message type:', msg.type);
        return null;
      };

      // The phone ended a recording (audio-end): transcribe it, unless the
      // integrity verdict says frames went missing.
      const finishPhoneRecording = async (verdict) => {
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
        const thisBatch = processRemoteMicBatch(verdict);
        inFlightBatchRef.current = thisBatch;
        thisBatch.finally(() => {
          if (inFlightBatchRef.current === thisBatch) inFlightBatchRef.current = null;
        });
      };

      // Handle incoming messages (JSON control + binary audio)
      rtc.onMessage = async (data) => {
        if (typeof data === 'string') {
          // F-122: bound the JSON parser input. Control messages are tiny
          // (handshake, audio-config, verify-deny, paused/resumed). 4 KB
          // is generous and caps a hostile phone's per-message allocation
          // burst irrespective of the SCTP NDATA max-message-size.
          if (data.length > 4096) {
            console.warn('[RemoteMic] Dropping oversized control message:', data.length, 'bytes');
            return;
          }
          try {
            const msg = JSON.parse(data);
            // Session control messages only travel encrypted (FRAME_CONTROL
            // on the binary path). A plaintext copy comes from the relay or
            // from a phone page running another protocol: never act on it.
            if (mustBeEncrypted(msg)) {
              console.warn(`[RemoteMic] Ignoring plaintext ${msg.type}`);
              return;
            }
            if (msg.type === 'peer-joined') {
              // Relay server: both slots are now held. Our public-key sent
              // when OUR socket opened was dropped if the phone's opened
              // later, so send it again unless a handshake already started
              // (the phone also ignores a duplicate).
              if (!remoteMicKeyRef.current && !remoteMicPendingRef.current && !remoteMicHandshakeInProgressRef.current) {
                rtc.sendMessage({ type: 'public-key', key: ourKeyBase64, v: REMOTE_MIC_PROTOCOL });
              }
              return;
            }
            if (msg.type === 'sender-public-key') {
              // Refuse a second handshake once one is already bound or in
              // flight. Otherwise a malicious phone could overwrite
              // remoteMicKeyRef.current mid-stream (silent key swap on the
              // victim) or orphan the pending confirm wait.
              if (remoteMicKeyRef.current || remoteMicPendingRef.current || remoteMicHandshakeInProgressRef.current) {
                console.warn('[RemoteMic] Ignoring duplicate sender-public-key: handshake already bound or in flight');
                return;
              }
              if (!peerProtocolMatches(msg)) {
                // A phone page from another release (a tab left open across
                // a deploy): it would not understand our encrypted controls.
                console.warn(`[RemoteMic] Phone speaks protocol ${msg.v}, we speak ${REMOTE_MIC_PROTOCOL}`);
                rtc.sendMessage({ type: 'verify-deny' });
                setRemoteMicError(t('remoteMicVersionMismatch'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              remoteMicHandshakeInProgressRef.current = true;
              // Both directional keys, bound to both public keys and to the
              // QR secret K the relay never sees (lib/remote-crypto.js).
              const theirKey = await importPublicKey(msg.key);
              const sessionKeys = await deriveSessionKeys(keyPair.privateKey, theirKey, { receiverPub: keyPair.publicKey, senderPub: theirKey, qrSecret });
              const channel = createFrameChannel(createSendRatchet(sessionKeys.master, DIRECTION_DESKTOP_TO_PHONE), rtc,
                (err) => console.warn('[RemoteMic] Encrypt/send error:', err.message));
              const frames = createFrameVerifier();
              // Key confirmation replaces the v3 fingerprint check: the
              // phone's first encrypted frame must be a key-confirm that
              // decrypts under our phone-to-desktop key, which only happens
              // when it saw the same two public keys and the same K. A relay
              // that swapped keys cannot produce it (binary path below).
              const confirmed = await waitForDecision((resolve) => {
                remoteMicPendingRef.current = { key: createRecvRatchet(sessionKeys.master, DIRECTION_PHONE_TO_DESKTOP), frames, channel, resolve };
                channel.sendControl(KEY_CONFIRM);
              });
              remoteMicPendingRef.current = null;
              if (!confirmed) {
                console.warn('[RemoteMic] Key confirmation failed (wrong QR, tampering or timeout), aborting');
                remoteMicHandshakeInProgressRef.current = false;
                rtc.sendMessage({ type: 'verify-deny' });
                setRemoteMicError(t('remoteMicKeyConfirmFailed'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              // The binary path bound the keys when the confirm arrived.
              // F-137: future sender-public-key messages are caught by the
              // remoteMicKeyRef guard.
              remoteMicHandshakeInProgressRef.current = false;
              setRemoteMicVerifiedAt(Date.now());
              setRemoteMicStatus('connected');
              setRemoteMicModal(false); // close setup modal; use main UI from here
              setRemoteMicPaused(false);
              setIsRemoteMic(true);

              startRemoteMicTimer();
            } else if (msg.type === 'verify-deny') {
              // The phone refused the pairing (protocol mismatch or failed
              // key confirmation). F-87: ignored once the session is bound,
              // so a hostile peer cannot wipe an in-flight recording with it;
              // after binding the teardown signal is the rtc disconnect.
              if (remoteMicPendingRef.current) {
                remoteMicPendingRef.current.resolve(false);
              } else if (!remoteMicKeyRef.current) {
                setRemoteMicError(t('remoteMicKeyConfirmFailed'));
                setRemoteMicStatus('error');
                rtc.close();
              } else {
                console.warn('[RemoteMic] Ignoring verify-deny after the session is bound');
              }
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
            // malformed base64 / wrong byte length, deriveSessionKeys
            // throws on incompatible curve points, and the in-flight
            // confirm wait would dangle. Tear the session down so
            // the user can retry instead of staring at a wedged modal.
            console.error('[RemoteMic] Error handling control message:', e);
            resolveRemoteMicConfirm(false);
            setRemoteMicError(`Handshake error (${e?.message || 'unknown'})`);
            setRemoteMicStatus('error');
            try { rtc.close(); } catch (_) { /* already closing */ }
          }
        } else {
          // Binary data: an encrypted frame (audio, END or a control
          // message). Runs on the frame queue so frames are handled strictly
          // in arrival order.
          const verdict = await remoteMicFrameQueueRef.current(async () => {
            if (!remoteMicKeyRef.current) {
              // Handshake pending: the only acceptable frame is the phone's
              // key-confirm at seq 0. Anything else, or a frame that does
              // not decrypt, fails the pairing.
              const pending = remoteMicPendingRef.current;
              if (!pending) return;
              try {
                const frame = unpackFrame(await pending.key.decrypt(data));
                const ok = frame.kind === FRAME_CONTROL && frame.seq === 0 && frame.control.type === KEY_CONFIRM.type;
                if (ok) {
                  // Bind HERE, synchronously, so the next queued frame
                  // already finds the session keys.
                  pending.frames.accept(frame);
                  remoteMicFramesRef.current = pending.frames;
                  remoteMicKeyRef.current = pending.key;
                  remoteMicChannelRef.current = pending.channel;
                }
                pending.resolve(ok);
              } catch (e) {
                console.warn('[RemoteMic] Key-confirm frame did not decrypt:', e.message);
                pending.resolve(false);
              }
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
              // Unwrap the integrity frame and count it BEFORE any local drop
              // decision: the verifier judges what the transport delivered.
              const frame = unpackFrame(await remoteMicKeyRef.current.decrypt(data));
              if (frame.kind === FRAME_CONTROL) return applyPhoneControl(frame);
              // Integrity units: samples for PCM, payload bytes for Opus
              // (whose decoded length differs from the sent one).
              const fmt = remoteMicFormatRef.current;
              const units = fmt === 'opus' ? frame.payload.byteLength
                : Math.floor(frame.payload.byteLength / (fmt === 'pcm-s16' ? 2 : 4));
              remoteMicFramesRef.current.accept(frame, units);
              if (frame.kind !== FRAME_AUDIO) return;
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
              const decrypted = frame.payload;
              // Dispatch on the per-session format (validated in audio-config).
              // 'opus' goes through the decoder, whose output reaches
              // ingestPcm asynchronously but in order. 'pcm-s16' is
              // little-endian Int16, 'pcm-f32' native-endian Float32; both
              // sides run on little-endian hardware in practice, so the bare
              // typed-array view is byte-order-correct.
              if (fmt === 'opus') {
                const opus = remoteMicOpusRef.current;
                try {
                  opus.decoder.decode(decrypted);
                } catch (e) {
                  // A malformed group loses audio: fail the recording too.
                  opus.failure ??= `bad opus frame (${e.message})`;
                  throw e;
                }
                return;
              }
              const bytesPerSample = fmt === 'pcm-s16' ? 2 : 4;
              if (decrypted.byteLength % bytesPerSample !== 0) {
                console.warn(`[RemoteMic] Dropped ${fmt} chunk: byteLength not a multiple of ${bytesPerSample}`);
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
              if (fmt === 'pcm-s16') {
                const int16 = new Int16Array(decrypted);
                const float32 = new Float32Array(int16.length);
                for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
                ingestPcm(float32);
              } else {
                ingestPcm(new Float32Array(decrypted));
              }
            } catch (e) {
              // Don't swallow this: the user thinks audio is being received,
              // but every chunk is failing — surface a running count so the
              // modal shows the loss instead of just the first error.
              console.warn('[RemoteMic] Decrypt error:', e.message);
              setRemoteMicDecryptErrors((n) => n + 1);
              setRemoteMicError(`Decryption failed (${e.message})`);
            }
          });
          // Off the queue: processing the batch awaits work queued behind us.
          if (verdict) await finishPhoneRecording(verdict);
        }
      };

      await rtc.createOfferAndStore();

      // Build QR code URL
      const baseUrl = window.location.origin;
      const qrUrl = `${baseUrl}/remote-mic.html#${roomId}:${secret}:${qrSecret}`;

      setRemoteMicStatus('waiting');
      setRemoteMicQrUrl(qrUrl);

      // Send our public key once the data channel opens, then wait for answer
      const originalOnConnected = rtc.onConnected;
      rtc.onConnected = () => {
        if (originalOnConnected) originalOnConnected();
        rtc.sendMessage({ type: 'public-key', key: ourKeyBase64, v: REMOTE_MIC_PROTOCOL });
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

  // Integrity verdict for the current recording, judged on the frame queue so
  // every frame received before this call has been counted. requireEnd is
  // false when the desktop itself stopped the recording (no END will come).
  function judgeRemoteMicRecording(requireEnd) {
    return remoteMicFrameQueueRef.current(() => remoteMicFramesRef.current.finish({ requireEnd }));
  }

  // Process the current batch of remote mic audio and reset for next recording.
  // Keeps the RTC connection alive. `verdict` comes from
  // judgeRemoteMicRecording: a recording with a missing, reordered or
  // miscounted frame is discarded instead of transcribed as if it were whole.
  async function processRemoteMicBatch(verdict) {
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

    if (!verdict.ok) {
      console.error(`[RemoteMic] Discarding incomplete recording: ${verdict.reason}`);
      setRemoteMicError(t('remoteMicIncomplete'));
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
    await processRemoteMicBatch(await judgeRemoteMicRecording(false));
    sendRemoteMicControl({ type: 'stop-recording' });
    setRemoteMicRecording(false);
    setRemoteMicPaused(false);
  }

  async function disconnectRemoteMic() {
    // Full teardown, close RTC, phone goes to STOPPED
    setAwaitingFinal(true);
    await processRemoteMicBatch(await judgeRemoteMicRecording(false));
    const rtc = remoteMicRtcRef.current;
    if (rtc) {
      // Close only once the encrypted stop has been handed to the transport.
      await sendRemoteMicControl({ type: 'stop' });
      rtc.close();
      if (remoteMicRtcRef.current === rtc) remoteMicRtcRef.current = null;
    }
    resolveRemoteMicConfirm(false);
    remoteMicKeyRef.current = null;
    remoteMicChannelRef.current = null;
    stopRemoteMicTimer();
    setRemoteMicVerifiedAt(null);
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
  }

  // Desktop-to-phone commands travel encrypted on the verified channel; with no
  // verified session there is nobody to obey them, so they are dropped.
  function sendRemoteMicControl(msg) {
    const channel = remoteMicChannelRef.current;
    if (!channel) return Promise.resolve();
    return channel.sendControl(msg);
  }

  function pauseRemoteMic() {
    sendRemoteMicControl({ type: 'pause' });
    setRemoteMicPaused(true);
  }

  function resumeRemoteMic() {
    sendRemoteMicControl({ type: 'resume' });
    setRemoteMicPaused(false);
  }

  function regenerateRemoteMicQr() {
    // Tear down leftover state and start fresh, produces a new roomId/secret/QR.
    stopRemoteMicTimer();
    resolveRemoteMicConfirm(false);
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.close(); } catch (_) {}
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    remoteMicChannelRef.current = null;
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
    resolveRemoteMicConfirm(false);
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    remoteMicChannelRef.current = null;
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
    // When the session keys were confirmed.
    remoteMicVerifiedAt,
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
