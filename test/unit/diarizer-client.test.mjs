// Tier-1 unit test for createDiarizerClient (app/ui/src/lib/diarizer.js), the
// main-thread broker in front of the sherpa-onnx diarization worker.
//
// The bug it pins: the client documents "a single in-flight run" and keeps ONE
// `pending` slot, but run() overwrote it unconditionally. A second concurrent
// run() on the same client therefore orphaned the first caller's promise
// forever: nothing ever settled it, and the UI's only escape was the manual
// cancel button. The piecewise pool is safe (its clientLoop awaits each run
// before dispatching the next), but the default client behind runDiarization()
// is shared by every caller of it.
//
// The worker itself is a classic Web Worker and is not exercised here; a fake
// Worker plus a fake fetch for the engine bytes is enough to drive the client.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDiarizerClient } from '../../app/ui/src/lib/diarizer.js';

const PCM = new Float32Array(16000);
const MODELS = { segmentationBytes: new Uint8Array(8), embeddingBytes: new Uint8Array(8) };

// Every spawned fake worker, so a test can inspect what the client sent and
// answer on its behalf.
let workers = [];

// The client verifies the ~11 MB engine bytes through fetchVerifiedAsset. In
// Node there is no production pin (the hard-fail flag is a Vite-replaced
// constant, false outside a prod build), so an unpinned manifest is the dev
// path: it warns and hands back the bytes.
function stubEnv() {
  const realFetch = globalThis.fetch;
  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('asset-integrity.json')) return { ok: false, status: 404 };
    return { ok: true, blob: async () => new Blob([new Uint8Array(4)]) };
  };
  globalThis.Worker = class FakeWorker {
    constructor() {
      this.posted = [];
      this.terminated = false;
      workers.push(this);
      // Answer the init handshake on a later turn, like a real worker.
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
    }
    postMessage(msg) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
    /** Answer the run the client is currently waiting on (the latest one). */
    finishRun(segments = []) {
      const run = this.posted.filter((m) => m.type === 'run').at(-1);
      this.onmessage?.({ data: { type: 'result', id: run.id, segments } });
    }
    /** Fail the run the client is currently waiting on. */
    failRun(message) {
      const run = this.posted.filter((m) => m.type === 'run').at(-1);
      this.onmessage?.({ data: { type: 'error', id: run.id, message } });
    }
  };
  console.warn = () => {};
  return () => {
    globalThis.fetch = realFetch;
    globalThis.Worker = realWorker;
    console.warn = realWarn;
    workers = [];
  };
}

let restore = null;
afterEach(() => { restore?.(); restore = null; });

// Let the client's engine-bytes fetch, worker spawn and init handshake land.
// The worker is only spawned after an await, so nothing can be answered on the
// same tick the run was requested.
async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe('createDiarizerClient single-run contract', () => {
  test('a second concurrent run is refused rather than orphaning the first', async () => {
    restore = stubEnv();
    const client = createDiarizerClient();
    const first = client.run(PCM, MODELS);
    await assert.rejects(client.run(PCM, MODELS), /diarizer client busy/);
    await flush();
    // The refusal must not have disturbed the run already in flight.
    workers[0].finishRun([{ start: 0, end: 1, speaker: 0 }]);
    assert.deepEqual(await first, [{ start: 0, end: 1, speaker: 0 }]);
    assert.equal(workers.length, 1, 'the refused run must not have spawned a second worker');
  });

  test('the guard is synchronous, so a re-entry during the init await is caught too', async () => {
    // run() awaits ensureWorker() before it ever touches `pending`, so a check
    // placed after that await would let both callers through.
    restore = stubEnv();
    const client = createDiarizerClient();
    const first = client.run(PCM, MODELS);
    const second = client.run(PCM, MODELS); // same tick, worker not yet ready
    await assert.rejects(second, /diarizer client busy/);
    await flush();
    workers[0].finishRun();
    await first;
    client.dispose();
  });

  test('the client is reusable once a run settles', async () => {
    restore = stubEnv();
    const client = createDiarizerClient();
    const first = client.run(PCM, MODELS);
    await flush();
    workers[0].finishRun([{ start: 0, end: 2, speaker: 0 }]);
    await first;
    const second = client.run(PCM, MODELS);
    await flush();
    workers[0].finishRun([{ start: 2, end: 4, speaker: 1 }]);
    assert.deepEqual(await second, [{ start: 2, end: 4, speaker: 1 }]);
    assert.equal(workers.length, 1, 'a settled run reuses the live worker');
    client.dispose();
  });

  test('a cancelled run releases the client instead of wedging it', async () => {
    restore = stubEnv();
    const client = createDiarizerClient();
    const first = client.run(PCM, MODELS);
    await flush();
    client.cancel();
    await assert.rejects(first, /diarization cancelled/);
    // A cancel terminates the worker; the next run must rebuild and succeed.
    const second = client.run(PCM, MODELS);
    await flush();
    workers.at(-1).finishRun([{ start: 0, end: 1, speaker: 0 }]);
    assert.deepEqual(await second, [{ start: 0, end: 1, speaker: 0 }]);
    client.dispose();
  });

  test('a rejected run releases the client too', async () => {
    restore = stubEnv();
    const client = createDiarizerClient();
    const first = client.run(PCM, MODELS);
    await flush();
    workers[0].failRun('engine blew up');
    await assert.rejects(first, /engine blew up/);
    const second = client.run(PCM, MODELS);
    await flush();
    workers.at(-1).finishRun();
    await second;
    client.dispose();
  });

  test('the argument guards still fire before the busy check', async () => {
    restore = stubEnv();
    const client = createDiarizerClient();
    await assert.rejects(client.run(new Float32Array(0), MODELS), /non-empty Float32Array/);
    await assert.rejects(client.run(PCM, {}), /segmentationBytes and embeddingBytes/);
    // A rejected argument check must not have marked the client busy.
    const ok = client.run(PCM, MODELS);
    await flush();
    workers.at(-1).finishRun();
    await ok;
    client.dispose();
  });
});
