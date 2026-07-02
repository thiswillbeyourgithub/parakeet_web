// Unit coverage for the gated capture queue (app/ui/src/lib/captureQueue.js)
// that holds audio captures made before the model is ready and transcribes them
// in enqueue order once it can run one. Regression guard for the "record while
// the model is still downloading" flow: audio finished early must NOT be dropped
// (the old code did) nor run concurrently on the single model session.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureQueue } from '../../app/ui/src/lib/captureQueue.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('createCaptureQueue', () => {
  test('holds jobs while canRun() is false, then drains in FIFO order once it flips true', async () => {
    let ready = false;
    const ran = [];
    const q = createCaptureQueue({
      canRun: () => ready,
      runJob: async (job) => { ran.push(job.id); },
    });

    q.submit({ id: 'a' });
    q.submit({ id: 'b' });
    q.submit({ id: 'c' });
    await tick();
    // Nothing ran: the model was not ready.
    assert.deepEqual(ran, []);
    assert.equal(q.size, 3);

    ready = true;
    await q.drain();
    // All three ran, strictly in the order they were submitted.
    assert.deepEqual(ran, ['a', 'b', 'c']);
    assert.equal(q.size, 0);
  });

  test('submit() drains immediately when canRun() is already true', async () => {
    const ran = [];
    const q = createCaptureQueue({
      canRun: () => true,
      runJob: async (job) => { ran.push(job.id); },
    });
    await q.submit({ id: 'x' });
    assert.deepEqual(ran, ['x']);
  });

  test('never runs two jobs concurrently on the single model', async () => {
    let active = 0;
    let maxActive = 0;
    const q = createCaptureQueue({
      canRun: () => true,
      runJob: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick(5);
        active -= 1;
      },
    });
    // Fire several submits back to back; the queue must serialise them. The
    // first submit kicks the working drain, which processes the whole buffer,
    // so awaiting its promise waits for all three.
    const working = q.submit({ id: 1 });
    q.submit({ id: 2 });
    q.submit({ id: 3 });
    await working;
    assert.equal(maxActive, 1, 'jobs overlapped');
  });

  test('re-checks canRun() between jobs and pauses mid-drain when it flips false', async () => {
    let ready = true;
    const ran = [];
    const q = createCaptureQueue({
      canRun: () => ready,
      // The first job turns the gate off (as if a recording started), so the
      // remaining buffered jobs must NOT run until the gate reopens.
      runJob: async (job) => {
        ran.push(job.id);
        if (job.id === 'first') ready = false;
      },
    });
    const working = q.submit({ id: 'first' });
    q.submit({ id: 'second' });
    q.submit({ id: 'third' });
    await working;
    assert.deepEqual(ran, ['first'], 'kept draining after the gate closed');
    assert.equal(q.size, 2);

    // Reopen the gate and kick it: the rest drain in order.
    ready = true;
    await q.drain();
    assert.deepEqual(ran, ['first', 'second', 'third']);
    assert.equal(q.size, 0);
  });

  test('a rejecting job does not wedge the queue', async () => {
    const ran = [];
    const q = createCaptureQueue({
      canRun: () => true,
      runJob: async (job) => {
        ran.push(job.id);
        if (job.id === 'boom') throw new Error('transcription failed');
      },
    });
    const working = q.submit({ id: 'ok1' });
    q.submit({ id: 'boom' });
    q.submit({ id: 'ok2' });
    await working;
    assert.deepEqual(ran, ['ok1', 'boom', 'ok2']);
    assert.equal(q.size, 0);
  });

  test('overlapping drain() calls do not double-run jobs', async () => {
    const ran = [];
    const q = createCaptureQueue({
      canRun: () => true,
      runJob: async (job) => { await tick(5); ran.push(job.id); },
    });
    // The first submit kicks the working drain (it processes the whole buffer);
    // the second submit and the extra drain() calls all land while it is
    // draining and must bail, so no job runs twice.
    const working = q.submit({ id: 'a' });
    q.submit({ id: 'b' });
    await Promise.all([working, q.drain(), q.drain()]);
    await tick(20);
    assert.deepEqual([...ran].sort(), ['a', 'b']);
    assert.equal(ran.length, 2, 'a job ran more than once');
  });

  test('onCountChange reports the pending count as it grows and drains', async () => {
    let ready = false;
    const counts = [];
    const q = createCaptureQueue({
      canRun: () => ready,
      runJob: async () => {},
      onCountChange: (n) => counts.push(n),
    });
    q.submit({ id: 1 });
    q.submit({ id: 2 });
    assert.deepEqual(counts, [1, 2], 'growth not reported');
    ready = true;
    await q.drain();
    // Ends drained; the last reported count is 0.
    assert.equal(counts.at(-1), 0);
    assert.equal(q.size, 0);
  });
});
