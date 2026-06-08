/**
 * WebRTC module for ParakeetWeb remote microphone.
 * Adapted from WebSend's webrtc.js (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Handles peer connection lifecycle, signaling, and data channel
 * for streaming encrypted audio chunks. Supports an HTTPS relay
 * fallback (WebSocket or long-poll) for networks that block both
 * direct WebRTC and TURN/TURNS; relay frames carry the same
 * AES-256-GCM ciphertext as the data channel, so the security
 * model is unchanged.
 */

import { CONFIG } from '../config.js';
import { RelayWsTransport, RelayHttpTransport } from './remote-relay-transport.js';

export class RemoteMicRTC {
    /**
     * @param {string} signalingBaseUrl - Base URL for signaling API (e.g. '/api/signal')
     */
    constructor(signalingBaseUrl = '/api/signal') {
        this.signalingBaseUrl = signalingBaseUrl;
        this.pc = null;
        this.dataChannel = null;
        this.iceServers = [];
        this.iceTransportPolicy = 'all';
        this.roomId = null;
        this.roomSecret = null;
        this.isOfferer = false;

        // Callbacks — set by the caller
        this.onConnected = null;
        this.onDisconnected = null;
        this.onMessage = null;       // (data: string|ArrayBuffer) => void
        this.onStateChange = null;
        // Fired when a send is dropped or fails — lets the UI surface the
        // problem instead of treating "connected but silently losing data" as success.
        // (stage: 'message'|'binary', reason: string) => void
        this.onSendError = null;

        // ICE state
        this.pendingIceCandidates = [];
        this.remoteDescriptionSet = false;
        this._icePollTimer = null;
        this._knownRemoteCandidateCount = 0;
        this._connectionTimeout = null;
        this._CONNECTION_TIMEOUT_MS = 15000;
        this._disconnectTimer = null;

        // Wall-clock cap for the offerer's QR-waiting long-poll. Matches the
        // server's room TTL (10 min) so we don't outlive the room itself; a
        // compromised phone (or signaling flakiness it triggers) otherwise
        // could keep this loop alive indefinitely while the ECDH key pair
        // and QR resources stay pinned in startRemoteMic's closure.
        this._WAIT_FOR_ANSWER_TIMEOUT_MS = 10 * 60 * 1000;
        this._waitForAnswerAbort = null;

        // HTTPS relay fallback state. The race: try WebRTC and relay in
        // parallel after SDP exchange; whichever reaches "connected"
        // first wins, the other is torn down. The grace window matches
        // WebSend (10 s lets WebRTC win on healthy networks; afterwards
        // the relay takes over). VITE_RELAY_ENABLE=false disables the
        // race entirely and the class behaves exactly as before.
        this.relayTransport = null;
        this._RELAY_GRACE_MS = 10_000;
        this._relayGraceTimer = null;
        this._relayInFlight = false;
        this._raceResolved = false;
        this._relayEnable = CONFIG.VITE_RELAY_ENABLE !== 'false';
    }

    _getAuthHeaders(extra = {}) {
        const headers = { ...extra };
        if (this.roomSecret) headers['X-Room-Secret'] = this.roomSecret;
        return headers;
    }

    async _fetch(path, opts = {}) {
        const response = await fetch(`${this.signalingBaseUrl}${path}`, opts);
        // Monkey-patch .json() to log the raw body on parse failure
        const originalJson = response.json.bind(response);
        let bodyText = null;
        response.json = async () => {
            if (bodyText === null) bodyText = await response.clone().text();
            try {
                return JSON.parse(bodyText);
            } catch (e) {
                console.error(`[RemoteMicRTC] Failed to parse JSON from ${path} (HTTP ${response.status}). Raw body:`, bodyText);
                throw e;
            }
        };
        return response;
    }

    /**
     * Fetch ICE server configuration from signaling server.
     */
    async init() {
        try {
            const response = await this._fetch('/config');
            const config = await response.json();
            this.iceServers = config.iceServers;
            this.iceTransportPolicy = config.iceTransportPolicy || 'all';
            if (config.turnTimeout) {
                this._CONNECTION_TIMEOUT_MS = config.turnTimeout * 1000;
            }
            console.log(`[RemoteMicRTC] Got ${this.iceServers.length} ICE servers`);
        } catch (e) {
            console.warn('[RemoteMicRTC] Failed to fetch config, using Google STUN fallback:', e.message);
            this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        }
    }

    /**
     * Create the RTCPeerConnection with ICE servers.
     */
    createPeerConnection() {
        this.pc = new RTCPeerConnection({
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy
        });

        // Trickle ICE candidates to signaling server, with a small retry on
        // transient network errors. Losing a single candidate to a flaky link
        // can be the difference between a working and a stalled connection.
        this.pc.onicecandidate = (event) => {
            if (event.candidate && this.roomId) {
                const endpoint = this.isOfferer ? 'offer' : 'answer';
                const payload = JSON.stringify(event.candidate.toJSON());
                const attempt = async (tries) => {
                    try {
                        const resp = await this._fetch(`/rooms/${this.roomId}/ice/${endpoint}`, {
                            method: 'POST',
                            headers: this._getAuthHeaders({ 'Content-Type': 'application/json' }),
                            body: payload,
                        });
                        // Don't retry on 4xx (auth/validation errors are not transient).
                        if (!resp.ok && resp.status >= 500 && tries < 3) {
                            setTimeout(() => attempt(tries + 1), 200 * Math.pow(2, tries));
                        }
                    } catch (e) {
                        if (tries < 3) {
                            setTimeout(() => attempt(tries + 1), 200 * Math.pow(2, tries));
                        } else {
                            console.warn('[RemoteMicRTC] Failed to send ICE candidate after retries:', e.message);
                        }
                    }
                };
                attempt(0);
            }
        };

        // Monitor connection state
        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            console.log(`[RemoteMicRTC] Connection state: ${state}`);
            if (this.onStateChange) this.onStateChange(state);

            if (state === 'connected') {
                if (this._disconnectTimer) {
                    clearTimeout(this._disconnectTimer);
                    this._disconnectTimer = null;
                }
                this._stopPolling();
                // WebRTC won the race: cancel the pending grace timer
                // and tear down any relay that may have been opened in
                // parallel. Relay sockets that lost the race are dead
                // weight on the signaling server; close them so the
                // slot frees up for other rooms.
                this._raceResolved = true;
                if (this._relayGraceTimer) {
                    clearTimeout(this._relayGraceTimer);
                    this._relayGraceTimer = null;
                }
                if (this.relayTransport) {
                    try { this.relayTransport.close(); } catch (_) { /* ignore */ }
                    this.relayTransport = null;
                }
                // Note: onConnected is fired from data channel onopen (for offerer)
                // to ensure the channel is ready before sending. For non-data-channel
                // connections (future), fire here as fallback.
                if (!this.isOfferer && this.onConnected) this.onConnected();
            } else if (state === 'failed') {
                this._stopPolling();
                // If relay has already won or is in flight, suppress
                // the disconnect: the relay's own disconnect callback
                // will fire if it also fails. Without this gate, a
                // WebRTC failure during a successful relay session
                // would incorrectly bubble onDisconnected to the UI.
                if (!this.relayTransport && !this._relayInFlight) {
                    if (this.onDisconnected) this.onDisconnected();
                }
            } else if (state === 'disconnected') {
                this._disconnectTimer = setTimeout(() => {
                    if (this.pc && this.pc.connectionState === 'disconnected') {
                        console.error('[RemoteMicRTC] Connection did not recover after 5s');
                        // Same relay gate as the 'failed' branch above.
                        if (!this.relayTransport && !this._relayInFlight) {
                            if (this.onDisconnected) this.onDisconnected();
                        }
                    }
                }, 5000);
            }
        };

        // Handle incoming data channel (sender side). Reject anything other
        // than the single offerer-created 'remote-mic' channel: a malicious
        // peer can otherwise call createDataChannel on its side to either
        // replace this.dataChannel mid-session (redirecting our future
        // sends to an attacker-chosen channel) or double-feed onMessage
        // through a parallel handler.
        this.pc.ondatachannel = (event) => {
            const ch = event.channel;
            if (this.dataChannel) {
                console.warn('[RemoteMicRTC] Ignoring extra data channel:', ch.label);
                try { ch.close(); } catch (_) { /* ignore */ }
                return;
            }
            if (ch.label !== 'remote-mic') {
                console.warn('[RemoteMicRTC] Ignoring data channel with unexpected label:', ch.label);
                try { ch.close(); } catch (_) { /* ignore */ }
                return;
            }
            this._setupDataChannel(ch);
        };
    }

    _setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.binaryType = 'arraybuffer';

        this.dataChannel.onopen = () => {
            console.log('[RemoteMicRTC] Data channel open');
            // Fire onConnected here — this is the reliable moment when we can
            // actually send messages (onconnectionstatechange may fire slightly
            // before the data channel is ready, causing sendMessage to drop the msg).
            if (this.isOfferer && this.onConnected) this.onConnected();
        };

        this.dataChannel.onclose = () => {
            console.log('[RemoteMicRTC] Data channel closed');
        };

        this.dataChannel.onerror = (event) => {
            const msg = event.error ? event.error.message : 'Unknown error';
            console.error('[RemoteMicRTC] Data channel error:', msg);
        };

        this.dataChannel.onmessage = (event) => {
            if (this.onMessage) this.onMessage(event.data);
        };
    }

    /**
     * Send a JSON control message over the data channel.
     * @param {Object} message
     * @returns {boolean}
     */
    sendMessage(message) {
        // Relay won the race: route through the active transport. The
        // transport's sendMessage signature matches this one (sync bool).
        if (this.relayTransport) return this.relayTransport.sendMessage(message);
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            // Callers usually ignore the bool return; log so a dropped control
            // message (e.g. verify-deny lost because the peer already closed)
            // shows up in the debug console instead of disappearing silently.
            console.warn('[RemoteMicRTC] sendMessage dropped — data channel not open:', message?.type);
            if (this.onSendError) this.onSendError('message', 'data channel not open');
            return false;
        }
        try {
            this.dataChannel.send(JSON.stringify(message));
            return true;
        } catch (e) {
            console.warn('[RemoteMicRTC] sendMessage threw:', e.message);
            if (this.onSendError) this.onSendError('message', e.message);
            return false;
        }
    }

    /**
     * Send binary data (encrypted audio chunk) with backpressure handling.
     * @param {ArrayBuffer} data
     * @returns {Promise<boolean>}
     */
    async sendBinary(data) {
        if (this.relayTransport) return this.relayTransport.sendBinary(data);
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn('[RemoteMicRTC] sendBinary dropped — data channel not open');
            if (this.onSendError) this.onSendError('binary', 'data channel not open');
            return false;
        }
        // Wait if buffer is backing up (>1MB), but bound the wait so a
        // degraded-but-not-failed channel can't pin this loop forever while
        // the audio worklet keeps queuing chunks.
        const backpressureDeadline = Date.now() + 5000;
        while (this.dataChannel.bufferedAmount > 1024 * 1024) {
            if (Date.now() > backpressureDeadline) {
                console.warn('[RemoteMicRTC] sendBinary backpressure timeout — dropping chunk');
                if (this.onSendError) this.onSendError('binary', 'backpressure timeout');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        try {
            this.dataChannel.send(data);
            return true;
        } catch (e) {
            console.warn('[RemoteMicRTC] sendBinary threw:', e.message);
            if (this.onSendError) this.onSendError('binary', e.message);
            return false;
        }
    }

    /**
     * Resolve once the outbound buffer has drained below `thresholdBytes`,
     * so a faster-than-real-time producer (the saved-file pump) can pace
     * itself to the link instead of overrunning sendBinary's 5 s drop path.
     * A live mic never needs this — it is rate-limited by wall-clock audio —
     * but a file is decoded all at once and would otherwise flood the SCTP
     * buffer. Bounded by `deadlineMs` so a wedged or slow link cannot hang
     * the pump forever; returns true if it drained, false on deadline (the
     * caller keeps going, accepting that sendBinary may then drop and
     * surface its own onSendError). Delegates to the active relay transport
     * once one has won the race.
     * @returns {Promise<boolean>}
     */
    async drain(thresholdBytes = 256 * 1024, deadlineMs = 30000) {
        if (this.relayTransport) {
            return typeof this.relayTransport.drain === 'function'
                ? this.relayTransport.drain(thresholdBytes, deadlineMs)
                : true;
        }
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') return true;
        const deadline = Date.now() + deadlineMs;
        while (this.dataChannel.bufferedAmount > thresholdBytes) {
            if (Date.now() > deadline) return false;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return true;
    }

    // ============ HTTPS Relay Race ============
    //
    // Race state machine: WebRTC and the relay run in parallel after
    // the SDP exchange completes. The first to "connected" wins; the
    // loser is torn down. Matches WebSend's 10 s grace window.

    /**
     * Start the relay grace timer. Idempotent; safe to call from both
     * sides (offerer at end of waitForAnswer, answerer at end of
     * joinRoom). The timer fires after _RELAY_GRACE_MS unless WebRTC
     * has already won.
     */
    _startRelayRace() {
        if (!this._relayEnable) return;
        if (this._raceResolved) return;
        if (this._relayGraceTimer) return;
        if (!this.roomId || !this.roomSecret) return;
        this._relayGraceTimer = setTimeout(() => {
            this._relayGraceTimer = null;
            if (this._raceResolved) return;
            // Fire-and-forget; the method handles its own race-check
            // against late WebRTC wins.
            this._tryRelay();
        }, this._RELAY_GRACE_MS);
    }

    async _tryRelay() {
        if (this._raceResolved || this._relayInFlight) return;
        this._relayInFlight = true;
        console.log('[RemoteMicRTC] WebRTC grace expired, trying relay (ws first, then http)');

        const wsTransport = new RelayWsTransport({
            baseUrl: this.signalingBaseUrl,
            roomId: this.roomId,
            roomSecret: this.roomSecret,
        });
        const wsOk = await wsTransport.connect();
        // Re-check resolution: WebRTC may have connected during the
        // WS handshake. If so, abandon the relay attempt.
        if (this._raceResolved) {
            try { wsTransport.close(); } catch (_) { /* ignore */ }
            this._relayInFlight = false;
            return;
        }
        if (wsOk) {
            this._adoptRelay(wsTransport);
            return;
        }

        const httpTransport = new RelayHttpTransport({
            baseUrl: this.signalingBaseUrl,
            roomId: this.roomId,
            roomSecret: this.roomSecret,
        });
        const httpOk = await httpTransport.connect();
        if (this._raceResolved) {
            try { httpTransport.close(); } catch (_) { /* ignore */ }
            this._relayInFlight = false;
            return;
        }
        if (httpOk) {
            this._adoptRelay(httpTransport);
            return;
        }

        // Both transports failed. Let the existing connection-timeout
        // path fire onDisconnected; do not double-fire here.
        this._relayInFlight = false;
        console.warn('[RemoteMicRTC] Both relay transports failed');
    }

    _adoptRelay(transport) {
        this._raceResolved = true;
        this._relayInFlight = false;
        this.relayTransport = transport;
        transport.onMessage = (data) => {
            if (this.onMessage) this.onMessage(data);
        };
        transport.onDisconnected = () => {
            if (this.onDisconnected) this.onDisconnected();
        };
        transport.onSendError = (stage, reason) => {
            if (this.onSendError) this.onSendError(stage, reason);
        };
        // Stop the ICE polling / connection-timeout (they're moot now).
        this._stopPolling();
        // Close the pc: WebRTC lost the race, free its resources. The
        // resulting onconnectionstatechange='closed' is benign (we
        // gate disconnect on !relayTransport).
        if (this.pc) {
            try { this.pc.close(); } catch (_) { /* ignore */ }
        }
        if (this.onStateChange) this.onStateChange('connected');
        if (this.onConnected) this.onConnected();
        console.log('[RemoteMicRTC] Relay adopted; WebRTC pc closed');
    }

    // ============ Signaling ============

    /**
     * Create a room (computer/receiver side).
     * @returns {Promise<{roomId: string, secret: string}>}
     */
    async createRoom() {
        const response = await this._fetch('/rooms', { method: 'POST' });
        const data = await response.json();
        this.roomId = data.roomId;
        this.roomSecret = data.secret;
        console.log(`[RemoteMicRTC] Created room: ${this.roomId}`);
        return { roomId: this.roomId, secret: this.roomSecret };
    }

    /**
     * Adopt an EXISTING room on a fresh instance (computer/receiver side)
     * instead of minting a new one. Used when the phone drops and we want to
     * keep the same QR (room id + secret) on screen and wait for it to come
     * back: the dead RTCPeerConnection cannot be reused, so a new RemoteMicRTC
     * adopts the room id/secret, re-arms it, and stores a fresh offer.
     * @param {string} roomId
     * @param {string} secret
     */
    adoptRoom(roomId, secret) {
        this.roomId = roomId;
        this.roomSecret = secret;
        console.log(`[RemoteMicRTC] Adopted existing room: ${this.roomId}`);
    }

    /**
     * Reset the room's signaling slot (offer/answer/ICE) on the server so a
     * SECOND handshake against the same room id/secret starts clean. Without
     * this the stale answer from the prior session would be returned by the
     * waitForAnswer long-poll and dead ICE candidates would be replayed onto
     * the new peer connection. Must be called BEFORE createOfferAndStore on a
     * re-armed room.
     */
    async rearmRoom() {
        const response = await this._fetch(`/rooms/${this.roomId}/rearm`, {
            method: 'POST',
            headers: this._getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: '{}',
        });
        if (!response.ok) throw new Error(`Failed to re-arm room (HTTP ${response.status})`);
        console.log(`[RemoteMicRTC] Re-armed room ${this.roomId} for reconnection`);
    }

    /**
     * Create offer, gather ICE, store on server (computer/receiver side).
     * @returns {Promise<{roomId: string, secret: string}>}
     */
    async createOfferAndStore() {
        this.isOfferer = true;
        this.createPeerConnection();

        const dc = this.pc.createDataChannel('remote-mic', { ordered: true });
        this._setupDataChannel(dc);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this._waitForICE();

        const fullOffer = {
            type: this.pc.localDescription.type,
            sdp: this.pc.localDescription.sdp
        };

        const response = await this._fetch(`/rooms/${this.roomId}/offer`, {
            method: 'POST',
            headers: this._getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(fullOffer)
        });

        if (!response.ok) throw new Error(`Failed to store offer (HTTP ${response.status})`);
        console.log('[RemoteMicRTC] Offer stored on server');
        return { roomId: this.roomId, secret: this.roomSecret };
    }

    /**
     * Wait for answer from sender (long-polling).
     */
    async waitForAnswer() {
        // Bound transient-error retries so a persistent failure (server down,
        // CORS misconfig, mid-call IP ban) can't pin this in a tight retry
        // loop hammering the signaling server. 200/204/404 are the only
        // statuses that are part of the protocol; anything else terminates.
        // Also bound the total wall-clock waiting window (matches room TTL)
        // so an attacker triggering a 5xx storm or a stalled long-poll can't
        // keep this alive past the room's lifetime, and route every fetch
        // through an AbortController so close() can cancel cleanly.
        let transientRetries = 0;
        const MAX_TRANSIENT_RETRIES = 5;
        const deadline = Date.now() + this._WAIT_FOR_ANSWER_TIMEOUT_MS;
        while (true) {
            if (Date.now() >= deadline) {
                throw new Error('Timed out waiting for phone to connect');
            }
            const controller = new AbortController();
            this._waitForAnswerAbort = controller;
            try {
                const response = await this._fetch(`/rooms/${this.roomId}/answer?wait=true`, {
                    headers: this._getAuthHeaders(),
                    signal: controller.signal,
                });

                if (response.status === 200) {
                    const answer = await response.json();
                    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
                    this.remoteDescriptionSet = true;

                    for (const candidate of this.pendingIceCandidates) {
                        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                    this.pendingIceCandidates = [];

                    await this._fetchRemoteCandidates('answer');
                    this._startPolling('answer');
                    // Phone has answered: both peers now know the room
                    // and can race the relay against the WebRTC ICE
                    // negotiation. The grace timer gives ICE 10 s to
                    // win before claiming a relay slot.
                    this._startRelayRace();
                    return;
                }
                if (response.status === 204) {
                    transientRetries = 0;
                    continue;
                }
                if (response.status === 404) {
                    throw new Error('Room expired or not found');
                }
                // Any other status (401, 403, 429, 5xx, ...) is not part of
                // the protocol. Surface it so the UI can show an error
                // instead of looping forever.
                throw new Error(`Signaling server rejected long-poll (HTTP ${response.status})`);
            } catch (e) {
                if (e.name === 'AbortError') {
                    throw new Error('waitForAnswer aborted');
                }
                if (e.message.includes('Room') || e.message.includes('Signaling server') || e.message.includes('Timed out')) throw e;
                transientRetries += 1;
                if (transientRetries > MAX_TRANSIENT_RETRIES) {
                    throw new Error(`Signaling unreachable after ${MAX_TRANSIENT_RETRIES} retries: ${e.message}`);
                }
                console.warn(`[RemoteMicRTC] Polling error (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}):`, e.message);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } finally {
                if (this._waitForAnswerAbort === controller) {
                    this._waitForAnswerAbort = null;
                }
            }
        }
    }

    /**
     * Join a room and process offer (phone/sender side).
     * @param {string} roomId
     * @param {string} secret
     */
    async joinRoom(roomId, secret) {
        this.roomId = roomId;
        this.roomSecret = secret;
        this.isOfferer = false;

        // Verify room exists
        const checkResponse = await this._fetch(`/rooms/${roomId}`, {
            headers: this._getAuthHeaders()
        });
        if (!checkResponse.ok) {
            if (checkResponse.status === 401) throw new Error('Invalid room secret');
            if (checkResponse.status === 404) throw new Error('Room not found or expired');
            throw new Error(`Room check failed (HTTP ${checkResponse.status})`);
        }

        const roomInfo = await checkResponse.json();
        if (!roomInfo.hasOffer) throw new Error('Room not ready yet');

        // Fetch offer
        const offerResponse = await this._fetch(`/rooms/${roomId}/offer`, {
            headers: this._getAuthHeaders()
        });
        if (!offerResponse.ok) throw new Error(`Failed to get offer (HTTP ${offerResponse.status})`);
        const offer = await offerResponse.json();

        // Set up connection
        this.createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        this.remoteDescriptionSet = true;

        await this._fetchRemoteCandidates('offer');

        // Create and send answer
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this._waitForICE();

        const fullAnswer = {
            type: this.pc.localDescription.type,
            sdp: this.pc.localDescription.sdp
        };

        const answerResponse = await this._fetch(`/rooms/${roomId}/answer`, {
            method: 'POST',
            headers: this._getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(fullAnswer)
        });

        if (!answerResponse.ok) throw new Error(`Failed to store answer (HTTP ${answerResponse.status})`);
        console.log('[RemoteMicRTC] Answer sent, establishing connection...');
        this._startPolling('offer');
        // Mirror waitForAnswer: kick off the 10 s grace race against
        // the relay so the phone falls back to wss/long-poll if ICE
        // cannot get through.
        this._startRelayRace();
    }

    // ============ ICE Handling ============

    async _fetchRemoteCandidates(side) {
        try {
            const response = await this._fetch(`/rooms/${this.roomId}/ice/${side}`, {
                headers: this._getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                const newCandidates = data.candidates.slice(this._knownRemoteCandidateCount);
                this._knownRemoteCandidateCount = data.candidates.length;

                for (const candidate of newCandidates) {
                    if (this.remoteDescriptionSet) {
                        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } else {
                        this.pendingIceCandidates.push(candidate);
                    }
                }
            }
        } catch (e) {
            console.warn('[RemoteMicRTC] Failed to fetch ICE candidates:', e.message);
        }
    }

    _startPolling(side) {
        this._icePollTimer = setInterval(async () => {
            if (!this.pc || this.pc.connectionState === 'connected' ||
                this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
                this._stopPolling();
                return;
            }
            await this._fetchRemoteCandidates(side);
        }, 1000);

        // Connection timeout
        this._connectionTimeout = setTimeout(() => {
            if (!this.pc) return;
            const state = this.pc.connectionState;
            if (state !== 'connected' && state !== 'failed' && state !== 'closed') {
                console.error(`[RemoteMicRTC] Connection timed out after ${this._CONNECTION_TIMEOUT_MS / 1000}s`);
                this._stopPolling();
                // Suppress disconnect when the relay has won or is
                // still mid-handshake. The relay's own onDisconnected
                // hook is the source of truth once it's adopted.
                if (!this.relayTransport && !this._relayInFlight) {
                    if (this.onDisconnected) this.onDisconnected();
                }
            }
        }, this._CONNECTION_TIMEOUT_MS);
    }

    _stopPolling() {
        if (this._icePollTimer) {
            clearInterval(this._icePollTimer);
            this._icePollTimer = null;
        }
        if (this._connectionTimeout) {
            clearTimeout(this._connectionTimeout);
            this._connectionTimeout = null;
        }
    }

    _waitForICE() {
        return new Promise((resolve) => {
            if (this.pc.iceGatheringState === 'complete') { resolve(); return; }
            // Guard against double-resolution: if ICE later restarts the same pc
            // (rare but possible) the handler would otherwise fire again and
            // we'd silently no-op. Self-removing the listener and clearing the
            // timeout makes the lifecycle explicit.
            let settled = false;
            const pc = this.pc;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                pc.removeEventListener('icegatheringstatechange', onChange);
                resolve();
            };
            const onChange = () => {
                if (pc.iceGatheringState === 'complete') finish();
            };
            const timeout = setTimeout(() => {
                console.warn('[RemoteMicRTC] ICE gathering timeout, proceeding');
                finish();
            }, 5000);
            pc.addEventListener('icegatheringstatechange', onChange);
        });
    }

    /**
     * Close the connection and clean up all resources.
     */
    close() {
        this._stopPolling();
        if (this._disconnectTimer) {
            clearTimeout(this._disconnectTimer);
            this._disconnectTimer = null;
        }
        // Abort any in-flight waitForAnswer long-poll so close() actually
        // unblocks the caller's await (otherwise the awaiting Promise can
        // hang for the full room TTL even after the user cancels).
        if (this._waitForAnswerAbort) {
            try { this._waitForAnswerAbort.abort(); } catch (_) { /* ignore */ }
            this._waitForAnswerAbort = null;
        }
        // Cancel the relay race timer and tear down any active relay.
        // Mark the race resolved so a late _tryRelay completion does
        // not adopt a transport into a closed session.
        this._raceResolved = true;
        if (this._relayGraceTimer) {
            clearTimeout(this._relayGraceTimer);
            this._relayGraceTimer = null;
        }
        if (this.relayTransport) {
            try { this.relayTransport.close(); } catch (_) { /* ignore */ }
            this.relayTransport = null;
        }
        this.pendingIceCandidates = [];
        if (this.dataChannel) this.dataChannel.close();
        if (this.pc) this.pc.close();
        this.pc = null;
        this.dataChannel = null;
        console.log('[RemoteMicRTC] Connection closed');
    }
}
