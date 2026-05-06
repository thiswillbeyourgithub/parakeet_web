/**
 * WebRTC module for ParakeetWeb remote microphone.
 * Adapted from WebSend's webrtc.js (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Handles peer connection lifecycle, signaling, and data channel
 * for streaming encrypted audio chunks.
 */

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

        // ICE state
        this.pendingIceCandidates = [];
        this.remoteDescriptionSet = false;
        this._icePollTimer = null;
        this._knownRemoteCandidateCount = 0;
        this._connectionTimeout = null;
        this._CONNECTION_TIMEOUT_MS = 15000;
        this._disconnectTimer = null;
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
                // Note: onConnected is fired from data channel onopen (for offerer)
                // to ensure the channel is ready before sending. For non-data-channel
                // connections (future), fire here as fallback.
                if (!this.isOfferer && this.onConnected) this.onConnected();
            } else if (state === 'failed') {
                this._stopPolling();
                if (this.onDisconnected) this.onDisconnected();
            } else if (state === 'disconnected') {
                this._disconnectTimer = setTimeout(() => {
                    if (this.pc && this.pc.connectionState === 'disconnected') {
                        console.error('[RemoteMicRTC] Connection did not recover after 5s');
                        if (this.onDisconnected) this.onDisconnected();
                    }
                }, 5000);
            }
        };

        // Handle incoming data channel (sender side)
        this.pc.ondatachannel = (event) => {
            this._setupDataChannel(event.channel);
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
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            // Callers usually ignore the bool return; log so a dropped control
            // message (e.g. verify-deny lost because the peer already closed)
            // shows up in the debug console instead of disappearing silently.
            console.warn('[RemoteMicRTC] sendMessage dropped — data channel not open:', message?.type);
            return false;
        }
        this.dataChannel.send(JSON.stringify(message));
        return true;
    }

    /**
     * Send binary data (encrypted audio chunk) with backpressure handling.
     * @param {ArrayBuffer} data
     * @returns {Promise<boolean>}
     */
    async sendBinary(data) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn('[RemoteMicRTC] sendBinary dropped — data channel not open');
            return false;
        }
        // Wait if buffer is backing up (>1MB)
        while (this.dataChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.dataChannel.send(data);
        return true;
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
        while (true) {
            try {
                const response = await this._fetch(`/rooms/${this.roomId}/answer?wait=true`, {
                    headers: this._getAuthHeaders()
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
                    return;
                } else if (response.status === 204) {
                    continue;
                } else if (response.status === 404) {
                    throw new Error('Room expired or not found');
                }
            } catch (e) {
                if (e.message.includes('Room')) throw e;
                console.warn('[RemoteMicRTC] Polling error, retrying:', e.message);
                await new Promise(resolve => setTimeout(resolve, 2000));
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
                if (this.onDisconnected) this.onDisconnected();
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
        this.pendingIceCandidates = [];
        if (this.dataChannel) this.dataChannel.close();
        if (this.pc) this.pc.close();
        this.pc = null;
        this.dataChannel = null;
        console.log('[RemoteMicRTC] Connection closed');
    }
}
