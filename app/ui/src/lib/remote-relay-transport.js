/**
 * HTTPS relay transports for ParakeetWeb remote microphone.
 * Adapted from WebSend (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Two transports, one interface. Both forward AES-256-GCM ciphertext
 * frames between two slot-paired peers via the signaling server, so
 * neither variant ever sees plaintext audio. Used as a last-resort
 * fallback when WebRTC (direct or via TURN/TURNS) cannot be established
 * because the network blocks UDP and the TURNS CONNECT upgrade.
 *
 * Interface mirrors RemoteMicRTC's data-channel surface so the caller
 * can swap transports without changing the protocol layer:
 *   - sendMessage(obj) -> bool (synchronous, returns false on drop)
 *   - sendBinary(buf)  -> Promise<bool>
 *   - close()
 *   - onMessage(data)     where data is ArrayBuffer (binary) or string (control)
 *   - onDisconnected()
 *   - onSendError(stage, reason)
 *   - onConnected()
 */

// Helper: turn an http(s) signaling base path into the matching ws(s)
// origin. Works for absolute base URLs and for the common
// same-origin '/api/signal' case (no scheme).
function _toWsBase(baseUrl) {
    if (/^https?:\/\//i.test(baseUrl)) {
        return baseUrl.replace(/^http/i, 'ws');
    }
    if (typeof window !== 'undefined' && window.location) {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}${baseUrl}`;
    }
    // SSR / non-browser fallback: shouldn't happen in production.
    return baseUrl;
}

export class RelayWsTransport {
    constructor({ baseUrl, roomId, roomSecret }) {
        this.baseUrl = baseUrl;
        this.roomId = roomId;
        this.roomSecret = roomSecret;
        this.ws = null;
        this.connected = false;
        this.closed = false;

        this.onConnected = null;
        this.onDisconnected = null;
        this.onMessage = null;
        this.onSendError = null;
    }

    /**
     * Resolve true on first open, false on close/error before open.
     * Never rejects: the caller can fall back to the LP transport.
     */
    connect() {
        return new Promise((resolve) => {
            const wsBase = _toWsBase(this.baseUrl);
            // The room secret rides in the query string because the
            // browser WebSocket API does not expose a header API. The
            // server constant-time-compares it; an attacker who can read
            // the URL already has the secret.
            const url = `${wsBase}/rooms/${encodeURIComponent(this.roomId)}/relay?secret=${encodeURIComponent(this.roomSecret)}`;

            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                console.warn('[RelayWs] WebSocket constructor threw:', e.message);
                resolve(false);
                return;
            }
            this.ws = ws;
            ws.binaryType = 'arraybuffer';

            let settled = false;
            const settle = (ok) => {
                if (settled) return;
                settled = true;
                resolve(ok);
            };

            ws.onopen = () => {
                this.connected = true;
                console.log('[RelayWs] connected');
                settle(true);
                if (this.onConnected) this.onConnected();
            };

            ws.onmessage = (event) => {
                // Browser delivers binary frames as ArrayBuffer (because
                // binaryType='arraybuffer') and text frames as string -
                // exactly the shape RemoteMicRTC's onMessage already
                // expects from the data channel.
                if (this.onMessage) this.onMessage(event.data);
            };

            ws.onerror = () => {
                // The onerror event in the browser carries no useful
                // detail (security restriction); rely on onclose for
                // diagnosis.
                console.warn('[RelayWs] ws error event');
            };

            ws.onclose = (event) => {
                const wasConnected = this.connected;
                this.connected = false;
                console.log(`[RelayWs] closed: code=${event.code} reason=${event.reason || '(none)'}`);
                if (!wasConnected) {
                    // Closed before open: treat as connect failure so the
                    // caller can fall back to LP without firing a spurious
                    // onDisconnected.
                    settle(false);
                    return;
                }
                if (!this.closed && this.onDisconnected) this.onDisconnected();
            };
        });
    }

    sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[RelayWs] sendMessage dropped — ws not open:', message?.type);
            if (this.onSendError) this.onSendError('message', 'ws not open');
            return false;
        }
        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (e) {
            console.warn('[RelayWs] sendMessage threw:', e.message);
            if (this.onSendError) this.onSendError('message', e.message);
            return false;
        }
    }

    async sendBinary(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[RelayWs] sendBinary dropped — ws not open');
            if (this.onSendError) this.onSendError('binary', 'ws not open');
            return false;
        }
        // Backpressure: WebSocket.bufferedAmount mirrors
        // RTCDataChannel.bufferedAmount. Same 1 MiB threshold and 5 s
        // deadline as RemoteMicRTC.sendBinary so behaviour is
        // indistinguishable from the upstream's perspective.
        const backpressureDeadline = Date.now() + 5000;
        while (this.ws.bufferedAmount > 1024 * 1024) {
            if (Date.now() > backpressureDeadline) {
                console.warn('[RelayWs] sendBinary backpressure timeout — dropping chunk');
                if (this.onSendError) this.onSendError('binary', 'backpressure timeout');
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        try {
            this.ws.send(data);
            return true;
        } catch (e) {
            console.warn('[RelayWs] sendBinary threw:', e.message);
            if (this.onSendError) this.onSendError('binary', e.message);
            return false;
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        if (this.ws) {
            try { this.ws.close(1000, 'client closed'); } catch (_) { /* ignore */ }
        }
        this.ws = null;
    }
}

export class RelayHttpTransport {
    constructor({ baseUrl, roomId, roomSecret }) {
        this.baseUrl = baseUrl;
        this.roomId = roomId;
        this.roomSecret = roomSecret;
        this.slot = null;
        this.token = null;
        this.connected = false;
        this.closed = false;
        this._downAbort = null;
        this._downLoopPromise = null;

        this.onConnected = null;
        this.onDisconnected = null;
        this.onMessage = null;
        this.onSendError = null;
    }

    _authHeaders(extra = {}) {
        return {
            ...extra,
            'X-Room-Secret': this.roomSecret,
            ...(this.token ? { 'X-Slot-Token': this.token } : {}),
        };
    }

    /**
     * Resolve true on slot claim + down-poll loop started, false on
     * any auth/server error so the caller can fall back.
     */
    async connect() {
        try {
            const response = await fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/handshake`, {
                method: 'POST',
                headers: this._authHeaders(),
            });
            if (!response.ok) {
                console.warn(`[RelayHttp] handshake HTTP ${response.status}`);
                return false;
            }
            const body = await response.json();
            if (!body.slot || !body.token) {
                console.warn('[RelayHttp] handshake missing slot/token');
                return false;
            }
            this.slot = body.slot;
            this.token = body.token;
            this.connected = true;
            console.log(`[RelayHttp] connected as slot ${this.slot}`);

            // Fire and forget; the loop terminates itself on close.
            this._downLoopPromise = this._downLoop();

            if (this.onConnected) this.onConnected();
            return true;
        } catch (e) {
            console.warn('[RelayHttp] handshake threw:', e.message);
            return false;
        }
    }

    async _downLoop() {
        // Bounded transient-error backoff: a persistent server error
        // cannot pin this loop in a tight retry.
        let transientRetries = 0;
        const MAX_TRANSIENT_RETRIES = 5;
        while (!this.closed && this.connected) {
            const controller = new AbortController();
            this._downAbort = controller;
            let response;
            try {
                response = await fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/down?wait=true`, {
                    headers: this._authHeaders(),
                    signal: controller.signal,
                });
            } catch (e) {
                if (e.name === 'AbortError') return;
                transientRetries += 1;
                if (transientRetries > MAX_TRANSIENT_RETRIES) {
                    console.warn(`[RelayHttp] down-poll unreachable after ${MAX_TRANSIENT_RETRIES} retries:`, e.message);
                    this._fail('down-poll unreachable');
                    return;
                }
                // Exponential-ish backoff identical to the offerer's
                // waitForAnswer retry shape.
                await new Promise(r => setTimeout(r, 2000));
                continue;
            } finally {
                if (this._downAbort === controller) this._downAbort = null;
            }

            if (response.status === 200) {
                transientRetries = 0;
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('application/octet-stream')) {
                    const buf = await response.arrayBuffer();
                    if (this.onMessage) this.onMessage(buf);
                } else {
                    // Text frame: server tags these as text/plain. The
                    // protocol layer (handshake / mic) does its own
                    // JSON.parse so we hand over the raw string.
                    const text = await response.text();
                    if (this.onMessage) this.onMessage(text);
                }
                continue;
            }
            if (response.status === 204) {
                // Timeout, no frame: re-poll immediately.
                transientRetries = 0;
                continue;
            }
            if (response.status === 410) {
                // Slot closed by server (peer disconnect, idle reap).
                this._fail('slot closed');
                return;
            }
            if (response.status === 401) {
                this._fail('invalid slot token');
                return;
            }
            if (response.status === 429 || response.status === 503) {
                const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
                await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 30000)));
                continue;
            }
            // Any other status: treat as fatal so the user sees an
            // error instead of a silent stall.
            this._fail(`down-poll HTTP ${response.status}`);
            return;
        }
    }

    _fail(reason) {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        console.warn(`[RelayHttp] failed: ${reason}`);
        if (this.onDisconnected) this.onDisconnected();
    }

    sendMessage(message) {
        if (!this.connected || this.closed) {
            console.warn('[RelayHttp] sendMessage dropped — not connected:', message?.type);
            if (this.onSendError) this.onSendError('message', 'not connected');
            return false;
        }
        const body = JSON.stringify(message);
        // Fire and forget. The fetch is async but the upstream caller
        // treats sendMessage as synchronous (boolean return). Errors
        // surface via onSendError on the next event-loop turn.
        fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/up`, {
            method: 'POST',
            headers: this._authHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
            body,
        }).then((response) => {
            if (!response.ok) {
                console.warn(`[RelayHttp] sendMessage HTTP ${response.status}`);
                if (this.onSendError) this.onSendError('message', `HTTP ${response.status}`);
            }
        }).catch((e) => {
            console.warn('[RelayHttp] sendMessage threw:', e.message);
            if (this.onSendError) this.onSendError('message', e.message);
        });
        return true;
    }

    async sendBinary(data) {
        if (!this.connected || this.closed) {
            console.warn('[RelayHttp] sendBinary dropped — not connected');
            if (this.onSendError) this.onSendError('binary', 'not connected');
            return false;
        }
        try {
            const response = await fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/up`, {
                method: 'POST',
                headers: this._authHeaders({ 'Content-Type': 'application/octet-stream' }),
                body: data,
            });
            if (!response.ok) {
                console.warn(`[RelayHttp] sendBinary HTTP ${response.status}`);
                if (this.onSendError) this.onSendError('binary', `HTTP ${response.status}`);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('[RelayHttp] sendBinary threw:', e.message);
            if (this.onSendError) this.onSendError('binary', e.message);
            return false;
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        if (this._downAbort) {
            try { this._downAbort.abort(); } catch (_) { /* ignore */ }
            this._downAbort = null;
        }
        if (this.token) {
            // Best-effort close so the server-side slot frees up
            // immediately. The peer is torn down server-side too.
            fetch(`${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/close`, {
                method: 'POST',
                headers: this._authHeaders(),
                keepalive: true,
            }).catch(() => { /* ignore - we're closing anyway */ });
        }
        this.token = null;
        this.slot = null;
    }
}
