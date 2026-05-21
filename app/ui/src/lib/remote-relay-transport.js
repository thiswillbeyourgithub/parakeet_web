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

        // In-order send queue with retry. Each audio frame and each
        // control message becomes one POST to /relay/up. Without this
        // queue a transient 429 / 5xx / network error dropped the
        // chunk silently; with the queue the worker re-POSTs the same
        // bytes up to _SEND_MAX_ATTEMPTS times before giving up, and
        // every send is serialised so the receiver sees the same
        // order the caller submitted.
        //
        // Binary frames are bounded by _SEND_QUEUE_MAX_BINARY_FRAMES
        // (~1.6 s of audio at 125 fps). New binary frames are dropped
        // when the cap is reached so a stuck upload cannot pile up
        // unbounded memory. Control messages are NEVER dropped here:
        // there are very few per session (handshake, audio-config,
        // verify-*, paused/resumed, audio-end) and losing audio-end
        // is exactly the failure this whole queue is meant to fix.
        this._sendQueue = [];
        this._sendQueueBinaryCount = 0;
        this._sendWorkerRunning = false;
        this._SEND_QUEUE_MAX_BINARY_FRAMES = 200;
        this._SEND_MAX_ATTEMPTS = 5;
        this._SEND_RETRY_BACKOFF_MAX_MS = 5000;

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
        this._enqueueSend({
            stage: 'message',
            contentType: 'text/plain; charset=utf-8',
            body: JSON.stringify(message),
        });
        return true;
    }

    async sendBinary(data) {
        if (!this.connected || this.closed) {
            console.warn('[RelayHttp] sendBinary dropped — not connected');
            if (this.onSendError) this.onSendError('binary', 'not connected');
            return false;
        }
        const accepted = this._enqueueSend({
            stage: 'binary',
            contentType: 'application/octet-stream',
            body: data,
        });
        return accepted;
    }

    _enqueueSend(item) {
        // Binary cap only: control messages are too few and too
        // important (audio-end, verify-*) to drop here.
        if (item.stage === 'binary' && this._sendQueueBinaryCount >= this._SEND_QUEUE_MAX_BINARY_FRAMES) {
            console.warn('[RelayHttp] sendBinary dropped — send queue full');
            if (this.onSendError) this.onSendError('binary', 'send queue full');
            return false;
        }
        this._sendQueue.push(item);
        if (item.stage === 'binary') this._sendQueueBinaryCount++;
        if (!this._sendWorkerRunning) this._runSendWorker();
        return true;
    }

    async _runSendWorker() {
        this._sendWorkerRunning = true;
        try {
            while (this._sendQueue.length > 0 && !this.closed) {
                const item = this._sendQueue.shift();
                if (item.stage === 'binary') this._sendQueueBinaryCount--;
                await this._postWithRetry(item);
            }
        } finally {
            this._sendWorkerRunning = false;
        }
    }

    async _postWithRetry(item) {
        const url = `${this.baseUrl}/rooms/${encodeURIComponent(this.roomId)}/relay/up`;
        let attempt = 0;
        while (attempt < this._SEND_MAX_ATTEMPTS && !this.closed) {
            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: this._authHeaders({ 'Content-Type': item.contentType }),
                    body: item.body,
                });
            } catch (e) {
                attempt += 1;
                if (attempt >= this._SEND_MAX_ATTEMPTS) {
                    console.warn(`[RelayHttp] ${item.stage} send failed after ${this._SEND_MAX_ATTEMPTS} attempts:`, e.message);
                    if (this.onSendError) this.onSendError(item.stage, e.message);
                    return;
                }
                await this._sleep(this._backoffMs(attempt));
                continue;
            }
            if (response.ok) return;

            // 429 / 503: honour Retry-After (capped). The server resets the
            // window every 60 s; backing off shorter and burning a retry
            // is cheaper than sleeping a full minute and losing audio.
            if (response.status === 429 || response.status === 503) {
                attempt += 1;
                if (attempt >= this._SEND_MAX_ATTEMPTS) {
                    console.warn(`[RelayHttp] ${item.stage} send dropped after ${this._SEND_MAX_ATTEMPTS} attempts (HTTP ${response.status})`);
                    if (this.onSendError) this.onSendError(item.stage, `HTTP ${response.status}`);
                    return;
                }
                const retryAfterHeader = parseInt(response.headers.get('retry-after') || '0', 10);
                const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                    ? retryAfterHeader * 1000
                    : this._backoffMs(attempt);
                await this._sleep(Math.min(retryAfterMs, this._SEND_RETRY_BACKOFF_MAX_MS));
                continue;
            }

            // 5xx: transient server error; retry with backoff.
            if (response.status >= 500) {
                attempt += 1;
                if (attempt >= this._SEND_MAX_ATTEMPTS) {
                    console.warn(`[RelayHttp] ${item.stage} send dropped after ${this._SEND_MAX_ATTEMPTS} attempts (HTTP ${response.status})`);
                    if (this.onSendError) this.onSendError(item.stage, `HTTP ${response.status}`);
                    return;
                }
                await this._sleep(this._backoffMs(attempt));
                continue;
            }

            // 4xx other than 429: fatal (401 = bad token, 410 = slot
            // closed, 413 = oversize). Retrying won't help; surface
            // the error and let the slot-close path take over.
            console.warn(`[RelayHttp] ${item.stage} send fatal HTTP ${response.status}`);
            if (this.onSendError) this.onSendError(item.stage, `HTTP ${response.status}`);
            if (response.status === 401 || response.status === 410) {
                this._fail(`send HTTP ${response.status}`);
            }
            return;
        }
    }

    _backoffMs(attempt) {
        // attempt is 1-indexed at this point (incremented before the
        // sleep). 200 ms, 400, 800, 1600, capped at _SEND_RETRY_BACKOFF_MAX_MS.
        return Math.min(200 * Math.pow(2, attempt - 1), this._SEND_RETRY_BACKOFF_MAX_MS);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.connected = false;
        // Drop any frames still queued: they will never be flushed
        // because the worker checks this.closed on every iteration.
        // Reset the binary counter so a re-used instance (not the
        // current pattern, but cheap insurance) doesn't carry stale
        // accounting.
        this._sendQueue.length = 0;
        this._sendQueueBinaryCount = 0;
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
