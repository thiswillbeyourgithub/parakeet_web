// Unit coverage for the serial write queue (app/ui/src/lib/writeQueue.js) that
// serialises transcript-DB writes. Regression guard for the diarization
// persistence race: a burst of saves issued back to back (diarize then rename)
// used to race as independent IndexedDB transactions, so an earlier put could
// land AFTER a later one and leave stale data on disk. The queue must run tasks
// strictly in enqueue order regardless of how long each one takes.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from '../../app/ui/src/lib/writeQueue.js';

const settle = (id, delay, log) => () =>
  new Promise((resolve) => setTimeout(() => { log.push(id); resolve(id); }, delay));

describe('createSerialQueue', () => {
  test('runs tasks in enqueue order even when later tasks are faster', async () => {
    const queue = createSerialQueue();
    const log = [];
    // 'a' is the slowest; without serialisation it would finish LAST, so a plain
    // fire-and-forget would log ['c','b','a']. Serialised it must be ['a','b','c'].
    const a = queue(settle('a', 30, log));
    const b = queue(settle('b', 10, log));
    const c = queue(settle('c', 1, log));
    const results = await Promise.all([a, b, c]);
    assert.deepEqual(log, ['a', 'b', 'c']);
    assert.deepEqual(results, ['a', 'b', 'c']);
  });

  test('a rejecting task does not break ordering for later tasks', async () => {
    const queue = createSerialQueue();
    const log = [];
    const failing = queue(() => { log.push(1); return Promise.reject(new Error('boom')); });
    await assert.rejects(failing, /boom/);
    await queue(() => { log.push(2); return Promise.resolve(); });
    assert.deepEqual(log, [1, 2]);
  });

  test('each call resolves with its own task result', async () => {
    const queue = createSerialQueue();
    const first = await queue(() => Promise.resolve('first'));
    const second = await queue(() => Promise.resolve('second'));
    assert.equal(first, 'first');
    assert.equal(second, 'second');
  });

  test('a task only starts after the previous one has settled', async () => {
    const queue = createSerialQueue();
    const events = [];
    const slow = queue(() => new Promise((resolve) => {
      events.push('a:start');
      setTimeout(() => { events.push('a:end'); resolve(); }, 20);
    }));
    const fast = queue(() => { events.push('b:start'); return Promise.resolve(); });
    await Promise.all([slow, fast]);
    // 'b' must not start until 'a' has fully ended.
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start']);
  });
});
