// Tier-1 unit test for createModelWorker (app/ui/src/lib/modelWorker.js), the
// message protocol shared by decode.worker.js and encode.worker.js.
//
// The two workers used to be structural twins (same modelPromise, same init
// handshake, same FIFO chain, same error shaping, same result envelope), so
// each fix had to be made twice or it drifted. They now supply only a model
// factory and one run body; everything asserted here is the part they share.
//
// The shapes below are load-bearing on the MAIN thread too: workerInit.js's
// `workerReady` resolves on {type:'ready'} and fails on an init-scoped
// {type:'error'} with NO id, while per-request errors must carry an id so they
// are routed to the pending request instead of read as an init failure.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createModelWorker, errorMessage } from '../../app/ui/src/lib/modelWorker.js';

// Minimal stand-in for DedicatedWorkerGlobalScope: records what was posted and
// lets a test deliver a message the way the browser would.
function makeScope() {
  const posted = [];
  const scope = {
    onmessage: null,
    postMessage: (msg, transfer) => posted.push({ msg, transfer }),
  };
  return {
    scope,
    posted,
    send: (data) => scope.onmessage({ data }),
    // Let the protocol's internal promise chain drain.
    settle: () => new Promise((r) => setImmediate(r)),
  };
}

describe('createModelWorker init handshake', () => {
  test('posts ready once the model resolves', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({ scope, initModel: async () => ({ model: true }), runType: 'run', run: async () => ({}) });
    send({ type: 'init', foo: 1 });
    await settle();
    assert.deepEqual(posted.map((p) => p.msg), [{ type: 'ready' }]);
  });

  test('an async init failure is an init-scoped error with NO id', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: async () => { throw new Error('session build failed'); },
      runType: 'run', run: async () => ({}),
    });
    send({ type: 'init' });
    await settle();
    assert.deepEqual(posted[0].msg, { type: 'error', message: 'session build failed' });
    assert.equal('id' in posted[0].msg, false, 'workerReady would mistake an id-bearing error for a run error');
  });

  test('a SYNCHRONOUS throw in initModel is reported the same way', async () => {
    // The old inline handshake called initModel bare, so a synchronous throw
    // escaped the message handler and only surfaced as a worker error event.
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: () => { throw new Error('bad init params'); },
      runType: 'run', run: async () => ({}),
    });
    send({ type: 'init' });
    await settle();
    assert.deepEqual(posted[0].msg, { type: 'error', message: 'bad init params' });
  });

  test('init passes the whole message through to the factory', async () => {
    const { scope, send, settle } = makeScope();
    let seen = null;
    createModelWorker({ scope, initModel: async (msg) => { seen = msg; return {}; }, runType: 'run', run: async () => ({}) });
    send({ type: 'init', wasmPaths: '/ort/', ortVariant: 'jspi', numThreads: 4 });
    await settle();
    assert.equal(seen.ortVariant, 'jspi');
    assert.equal(seen.numThreads, 4);
  });
});

describe('createModelWorker run requests', () => {
  test('wraps the run payload in the result envelope and forwards the transfer list', async () => {
    const { scope, posted, send, settle } = makeScope();
    const buf = new ArrayBuffer(8);
    createModelWorker({
      scope,
      initModel: async () => ({ tag: 'model' }),
      runType: 'encode',
      run: async (msg, model) => ({ payload: { transposed: buf, D: 4, tag: model.tag }, transfer: [buf] }),
    });
    send({ type: 'init' });
    await settle();
    send({ type: 'encode', id: 7, chunkIndex: 2 });
    await settle();
    const result = posted.find((p) => p.msg.type === 'result');
    assert.deepEqual(result.msg, { type: 'result', id: 7, chunkIndex: 2, transposed: buf, D: 4, tag: 'model' });
    assert.deepEqual(result.transfer, [buf]);
  });

  test('a run rejection is a per-request error carrying id and chunkIndex', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: async () => ({}), runType: 'decode',
      run: async () => { throw new Error('decode blew up'); },
    });
    send({ type: 'init' });
    await settle();
    send({ type: 'decode', id: 3, chunkIndex: 1 });
    await settle();
    assert.deepEqual(posted.at(-1).msg, { type: 'error', id: 3, chunkIndex: 1, message: 'decode blew up' });
  });

  test('one failing run does not break the chain for the next one', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: async () => ({}), runType: 'decode',
      run: async (msg) => {
        if (msg.id === 1) throw new Error('nope');
        return { payload: { ok: true } };
      },
    });
    send({ type: 'init' });
    await settle();
    send({ type: 'decode', id: 1, chunkIndex: 0 });
    send({ type: 'decode', id: 2, chunkIndex: 1 });
    await settle();
    assert.equal(posted.at(-1).msg.ok, true);
    assert.equal(posted.at(-1).msg.id, 2);
  });

  test('runs are serialised FIFO, never concurrent on the one session', async () => {
    // Both workers hold ONE ORT session with mutable state; two runs in flight
    // would interleave and corrupt it. Parallelism comes from the pool.
    const { scope, posted, send, settle } = makeScope();
    let active = 0;
    let maxActive = 0;
    const gates = [];
    createModelWorker({
      scope, initModel: async () => ({}), runType: 'decode',
      run: async (msg) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((res) => gates.push(res));
        active -= 1;
        return { payload: { id: msg.id } };
      },
    });
    send({ type: 'init' });
    await settle();
    send({ type: 'decode', id: 1, chunkIndex: 0 });
    send({ type: 'decode', id: 2, chunkIndex: 1 });
    send({ type: 'decode', id: 3, chunkIndex: 2 });
    await settle();
    assert.equal(gates.length, 1, 'only the head of the chain has started');
    while (gates.length) { gates.shift()(); await settle(); }
    assert.equal(maxActive, 1);
    const order = posted.filter((p) => p.msg.type === 'result').map((p) => p.msg.chunkIndex);
    assert.deepEqual(order, [0, 1, 2], 'results come back in dispatch order');
  });

  test('a run arriving before init awaits the model rather than racing it', async () => {
    const { scope, posted, send, settle } = makeScope();
    let release;
    createModelWorker({
      scope,
      initModel: () => new Promise((res) => { release = () => res({ tag: 'late' }); }),
      runType: 'decode',
      run: async (msg, model) => ({ payload: { tag: model.tag } }),
    });
    send({ type: 'init' });
    send({ type: 'decode', id: 1, chunkIndex: 0 });
    await settle();
    assert.equal(posted.length, 0);
    release();
    await settle();
    assert.equal(posted.find((p) => p.msg.type === 'result').msg.tag, 'late');
  });
});

describe('createModelWorker extra handlers', () => {
  test('a handler reply is posted as-is, outside the run chain', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: async () => ({}), runType: 'decode', run: async () => ({}),
      handlers: { boost: () => ({ type: 'boostReady' }) },
    });
    // No init: the decode worker's 'boost' is model-independent on purpose,
    // because App.jsx re-syncs the trie before a run without reloading.
    send({ type: 'boost', encoded: null });
    await settle();
    assert.deepEqual(posted.map((p) => p.msg), [{ type: 'boostReady' }]);
  });

  test('a throwing handler posts an init-scoped error', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({
      scope, initModel: async () => ({}), runType: 'decode', run: async () => ({}),
      handlers: { boost: () => { throw new Error('bad trie'); } },
    });
    send({ type: 'boost' });
    await settle();
    assert.deepEqual(posted[0].msg, { type: 'error', message: 'bad trie' });
  });

  test('unknown message types are ignored', async () => {
    const { scope, posted, send, settle } = makeScope();
    createModelWorker({ scope, initModel: async () => ({}), runType: 'decode', run: async () => ({}) });
    send({ type: 'nonsense' });
    send({});
    await settle();
    assert.deepEqual(posted, []);
  });
});

describe('errorMessage', () => {
  test('prefers .message and falls back to stringifying', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(errorMessage('plain string'), 'plain string');
    assert.equal(errorMessage({ message: 'obj' }), 'obj');
    assert.equal(errorMessage(null), 'null');
    assert.equal(errorMessage(undefined), 'undefined');
    assert.equal(errorMessage(42), '42');
  });
});
