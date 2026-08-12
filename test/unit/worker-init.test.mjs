// Tier-1 unit test for workerReady (app/ui/src/lib/workerInit.js), the shared
// init handshake of decode.worker.js / encode.worker.js in App.jsx.
//
// The bug it pins (found 2026-08-11 on the GPU box): a worker whose SCRIPT
// asset fails to load never posts any message, only the worker 'error' event
// fires. The old inline handshake resolved readiness solely from messages, so
// the ready promise stayed pending forever and every WebGPU transcription
// gated on it hung before chunk 1 instead of falling back in-thread. The
// script-load-failure case below hangs (test times out) against that logic
// and passes with workerReady.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { workerReady, WORKER_INIT_WATCHDOG_MS } from '../../app/ui/src/lib/workerInit.js';

// Minimal Worker double: EventTarget semantics + a posted-messages log.
class FakeWorker {
  constructor() {
    this.listeners = { message: new Set(), error: new Set() };
    this.posted = [];
  }
  addEventListener(type, fn) { this.listeners[type].add(fn); }
  removeEventListener(type, fn) { this.listeners[type].delete(fn); }
  postMessage(msg) { this.posted.push(msg); }
  emitMessage(data) { this.listeners.message.forEach((fn) => fn({ data })); }
  emitError(message) { this.listeners.error.forEach((fn) => fn({ message })); }
  listenerCount() { return this.listeners.message.size + this.listeners.error.size; }
}

describe('workerReady', () => {
  test('posts the init message and resolves true on ready', async () => {
    const w = new FakeWorker();
    const p = workerReady(w, { type: 'init', x: 1 });
    assert.deepEqual(w.posted, [{ type: 'init', x: 1 }]);
    w.emitMessage({ type: 'ready' });
    assert.equal(await p, true);
    assert.equal(w.listenerCount(), 0, 'handshake listeners removed after settling');
  });

  test('script-load failure (error event, no message ever) settles false', async () => {
    const w = new FakeWorker();
    const p = workerReady(w, { type: 'init' });
    w.emitError('failed to fetch worker script');
    assert.equal(await p, false);
  });

  test('init-scoped error message settles false', async () => {
    const w = new FakeWorker();
    const p = workerReady(w, { type: 'init' });
    w.emitMessage({ type: 'error', message: 'no session' });
    assert.equal(await p, false);
  });

  test('per-request error messages (id != null) are not init failures', async () => {
    const w = new FakeWorker();
    const p = workerReady(w, { type: 'init' });
    w.emitMessage({ type: 'error', id: 7, message: 'chunk 7 failed' });
    w.emitMessage({ type: 'ready' });
    assert.equal(await p, true);
  });

  test('a silent (hung) init settles false via the watchdog', async () => {
    const w = new FakeWorker();
    assert.equal(await workerReady(w, { type: 'init' }, { timeoutMs: 20 }), false);
    assert.equal(w.listenerCount(), 0);
  });

  test('first signal wins; later contradicting signals are ignored', async () => {
    const w = new FakeWorker();
    const p = workerReady(w, { type: 'init' });
    w.emitMessage({ type: 'ready' });
    w.emitError('late crash');
    assert.equal(await p, true);
  });

  test('default watchdog is long enough for a cold fp32 init', () => {
    assert.ok(WORKER_INIT_WATCHDOG_MS >= 60000);
  });
});
