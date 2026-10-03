// Tier-1 unit test for the diarization client (app/ui/src/lib/diarizer.js),
// WASM path: the main-thread broker in front of diarize.worker.js. A fake
// Worker drives it; the worker itself (real ORT) is covered by
// sortformer-model.test.mjs and the tier-3 diarization specs.
//
// Pins the contracts its predecessor (the sherpa-onnx client) learned the hard
// way: one run at a time (a second run used to orphan the first promise
// forever), a worker that dies after init rejects the run instead of hanging,
// a cancel or failure leaves the client reusable, and new model bytes (another
// precision) reach a fresh worker. The WebGPU main-thread path needs a GPU and
// is not exercised here.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runDiarization, cancelDiarization } from '../../app/ui/src/lib/diarizer.js';

const PCM = new Float32Array(16000);
const modelsFor = (precision) => ({
  precision, config: { hidden_size: 4 }, silenceEmbeds: new Float32Array(4),
  embedBytes: new Uint8Array(8), stepBytes: new Uint8Array(8),
});
// Fresh per test: the client keeps its worker across runs for as long as the
// models object is the same, so a shared one would hand each test the
// previous test's fake worker.
let MODELS;
let OPTS;

let workers = [];
let initBehaviour = 'ready';

function stubEnv() {
  MODELS = modelsFor('int8');
  OPTS = { models: MODELS, backend: 'wasm' };
  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  globalThis.Worker = class FakeWorker {
    constructor() {
      this.posted = [];
      this.terminated = false;
      this.listeners = { message: [], error: [] };
      workers.push(this);
    }
    postMessage(msg, transfer = []) {
      // structuredClone detaches transferred buffers exactly as a real
      // postMessage does, so a client that transfers the caller's own pcm fails
      this.posted.push(transfer.length ? structuredClone(msg, { transfer }) : msg);
      // answer the init handshake on a later turn, like a real worker
      if (msg.type !== 'init') return;
      queueMicrotask(() => {
        if (initBehaviour === 'ready') this.emit('message', { type: 'ready' });
        else if (initBehaviour === 'initError') this.emit('message', { type: 'error', message: 'step graph did not load' });
        else if (initBehaviour === 'crash') this.emit('error', { message: 'worker script blew up' });
      });
    }
    terminate() { this.terminated = true; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }
    emit(type, payload) {
      const ev = type === 'error' ? payload : { data: payload };
      this[`on${type}`]?.(ev);
      for (const fn of [...(this.listeners[type] || [])]) fn(ev);
    }
    lastRun() { return this.posted.filter((m) => m.type === 'diarize').at(-1); }
    finishRun(values = [0.25, 0.75]) {
      const probs = new Float32Array(values);
      this.emit('message', { type: 'result', id: this.lastRun().id, probs: probs.buffer, numFrames: 1, numSpeakers: 2, frameSec: 0.01 });
    }
    failRun(message) { this.emit('message', { type: 'error', id: this.lastRun().id, message }); }
    crash(message = 'wasm aborted') { this.emit('error', { message }); }
  };
  console.warn = () => {};
  return () => {
    cancelDiarization(); // never leak a live fake worker into the next test
    globalThis.Worker = realWorker;
    console.warn = realWarn;
    workers = [];
    initBehaviour = 'ready';
  };
}

let restore = null;
afterEach(() => { restore?.(); restore = null; });

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe('runDiarization (WASM worker)', () => {
  test('sends the model at init and the pcm per run, returns Float32 probs', async () => {
    restore = stubEnv();
    const run = runDiarization(PCM, OPTS);
    await flush();
    const [init] = workers[0].posted;
    assert.equal(init.type, 'init');
    assert.equal(init.stepBytes, MODELS.stepBytes);
    assert.equal(workers[0].lastRun().pcm.byteLength, PCM.byteLength);
    assert.equal(PCM.length, 16000, 'the caller\'s pcm must not be transferred away');
    workers[0].finishRun([0.1, 0.9]);
    const out = await run;
    assert.ok(out.probs instanceof Float32Array);
    assert.deepEqual([...out.probs].map((x) => +x.toFixed(2)), [0.1, 0.9]);
    assert.equal(out.numSpeakers, 2);
  });

  test('forwards per-chunk progress for the run in flight only', async () => {
    restore = stubEnv();
    const seen = [];
    const run = runDiarization(PCM, { ...OPTS, onProgress: (p) => seen.push(p) });
    await flush();
    const { id } = workers[0].lastRun();
    workers[0].emit('message', { type: 'progress', id, done: 1, total: 3 });
    workers[0].emit('message', { type: 'progress', id: id + 99, done: 2, total: 3 });
    workers[0].finishRun();
    await run;
    assert.deepEqual(seen, [{ done: 1, total: 3 }]);
  });

  test('a second concurrent run is refused rather than orphaning the first', async () => {
    restore = stubEnv();
    const first = runDiarization(PCM, OPTS);
    // same tick, worker not ready yet: the guard must be synchronous
    await assert.rejects(runDiarization(PCM, OPTS), /already running/);
    await flush();
    workers[0].finishRun();
    await first;
    assert.equal(workers.length, 1);
  });

  test('a settled run reuses the worker; new model bytes get a fresh one', async () => {
    restore = stubEnv();
    let run = runDiarization(PCM, OPTS);
    await flush();
    workers[0].finishRun();
    await run;
    run = runDiarization(PCM, OPTS);
    await flush();
    workers[0].finishRun();
    await run;
    assert.equal(workers.length, 1, 'same models, same worker');
    const fp32 = modelsFor('fp32');
    run = runDiarization(PCM, { models: fp32, backend: 'wasm' });
    await flush();
    assert.ok(workers[0].terminated, 'the old worker is released');
    assert.equal(workers[1].posted[0].stepBytes, fp32.stepBytes);
    workers[1].finishRun();
    await run;
  });

  test('a rejected run releases the client', async () => {
    restore = stubEnv();
    const run = runDiarization(PCM, OPTS);
    await flush();
    workers[0].failRun('bad input');
    await assert.rejects(run, /bad input/);
    const next = runDiarization(PCM, OPTS);
    await flush();
    workers[0].finishRun();
    await next;
  });

  test('cancel rejects with `cancelled`, terminates, and the next run rebuilds', async () => {
    restore = stubEnv();
    const run = runDiarization(PCM, OPTS);
    await flush();
    cancelDiarization();
    await assert.rejects(run, (e) => e.cancelled === true);
    assert.ok(workers[0].terminated);
    const next = runDiarization(PCM, OPTS);
    await flush();
    assert.equal(workers.length, 2);
    assert.equal(workers[1].posted[0].type, 'init', 'the rebuilt worker gets the model again');
    workers[1].finishRun();
    await next;
  });

  test('a cancel during worker init still stops that run', async () => {
    restore = stubEnv();
    const run = runDiarization(PCM, OPTS);
    cancelDiarization(); // before the init handshake has answered
    await assert.rejects(run, (e) => e.cancelled === true);
    assert.equal(workers[0].lastRun(), undefined, 'no pcm was sent after the cancel');
  });

  test('a worker that dies AFTER init rejects the run instead of hanging', async () => {
    restore = stubEnv();
    const run = runDiarization(PCM, OPTS);
    await flush();
    workers[0].crash('wasm out of memory');
    await assert.rejects(run, /wasm out of memory/);
    const next = runDiarization(PCM, OPTS);
    await flush();
    assert.equal(workers.length, 2, 'the crashed worker is not reused');
    workers[1].finishRun();
    await next;
  });

  for (const [behaviour, why] of [['initError', 'an init error message'], ['crash', 'a worker dying during init']]) {
    test(`${why} surfaces instead of hanging`, async () => {
      restore = stubEnv();
      initBehaviour = behaviour;
      await assert.rejects(runDiarization(PCM, OPTS), /init failed/);
      initBehaviour = 'ready';
      const next = runDiarization(PCM, OPTS);
      await flush();
      workers.at(-1).finishRun();
      await next;
    });
  }

  test('rejects an empty or non-Float32 pcm before spawning anything', async () => {
    restore = stubEnv();
    await assert.rejects(runDiarization(new Float32Array(0), OPTS), /non-empty Float32Array/);
    await assert.rejects(runDiarization([0.1], OPTS), /non-empty Float32Array/);
    assert.equal(workers.length, 0);
  });
});
