// Tier-1 unit test for createLiveTranscriber's start/stop lifecycle
// (app/ui/src/lib/liveTranscriber.js). The adaptive step/window maths and the
// commit boundary are not the subject here; the two lifecycle bugs are.
//
// (1) stop() polled `while (running)` with no bound, so a wedged transcribe()
//     (a dead worker, a session that never resolves) made stop() itself hang.
//     The UI cannot leave the recording state until it returns, so one stuck
//     inference froze the page with no way out.
// (2) start() guards on `timer`, which stop() has already nulled. Calling
//     start() while a tick from before the stop was still in flight let that
//     old tick's `finally` schedule a SECOND self-rescheduling chain next to
//     the new one, permanently doubling the tick rate.
//
// The loop is driven by a fake clock (the real cadence starts at 3 s, far too
// slow to wait out) and a fake model whose transcribe() the test releases by
// hand. The source rate is 16 kHz so resamplePcmTo16k short-circuits and no
// Web Audio is needed.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTranscriber, STOP_DRAIN_MAX_MS } from '../../app/ui/src/lib/liveTranscriber.js';

// 10 s of silence at 16 kHz: past MIN_AUDIO_BEFORE_FIRST_TICK, so a tick does
// real work rather than returning early.
const CHUNKS = [{ buf: new Float32Array(160000), used: 160000 }];

// A controllable setTimeout/Date.now, so the 3 s cadence and the 10 s drain
// bound cost no wall-clock time. Firing is capped so a loop that never
// terminates (the pre-fix drain) fails an assertion instead of hanging.
function fakeClock() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realNow = Date.now;
  let now = 0;
  let seq = 0;
  const pending = new Map();
  globalThis.setTimeout = (fn, ms = 0) => { pending.set(++seq, { at: now + ms, fn }); return seq; };
  globalThis.clearTimeout = (id) => { pending.delete(id); };
  Date.now = () => now;
  return {
    pendingCount: () => pending.size,
    async advance(ms) {
      const target = now + ms;
      for (let guard = 0; guard < 5000; guard += 1) {
        let nextId = null;
        let next = null;
        for (const [id, t] of pending) {
          if (t.at <= target && (next === null || t.at < next.at)) { nextId = id; next = t; }
        }
        if (next === null) break;
        pending.delete(nextId);
        now = Math.max(now, next.at);
        next.fn();
        // Let the tick's promise chain make progress before the next timer.
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      }
      now = target;
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      Date.now = realNow;
    },
  };
}

function makeLive({ transcribe }) {
  return createLiveTranscriber({
    model: { transcribe },
    getPcmChunks: () => CHUNKS,
    getSampleRate: () => 16000,
    windowMode: 10,
    onUpdate: () => {},
  });
}

let clock = null;
afterEach(() => { clock?.restore(); clock = null; });

describe('createLiveTranscriber lifecycle', () => {
  test('stop() gives up on a wedged transcribe instead of hanging forever', async () => {
    clock = fakeClock();
    // Never resolves: an inference that never comes back is the failure mode.
    const live = makeLive({ transcribe: () => new Promise(() => {}) });
    live.start();
    await clock.advance(3000);           // the first tick fires and wedges

    let settled = false;
    const stopped = live.stop().then((r) => { settled = true; return r; });
    await clock.advance(STOP_DRAIN_MAX_MS + 500);
    assert.equal(settled, true, 'stop() must abandon a wedged tick at the drain bound');
    assert.deepEqual(await stopped, { text: '', words: [] });
  });

  test('stop() returns immediately when nothing is in flight', async () => {
    clock = fakeClock();
    const live = makeLive({ transcribe: async () => ({ words: [] }) });
    live.start();
    let settled = false;
    const stopped = live.stop().then((r) => { settled = true; return r; });
    await clock.advance(0);
    await Promise.resolve();
    assert.equal(settled, true, 'no drain wait when no tick is running');
    await stopped;
  });

  test('a tick in flight across stop()/start() does not leave a second chain', async () => {
    clock = fakeClock();
    let release = null;
    let calls = 0;
    const live = makeLive({
      transcribe: () => {
        calls += 1;
        return new Promise((res) => { release = () => res({ words: [] }); });
      },
    });
    live.start();
    await clock.advance(3000);
    assert.equal(calls, 1, 'the first tick is in flight');

    const stopped = live.stop();   // stopped = true, timer cleared, drain begins
    live.start();                  // timer is null, so this schedules a NEW chain
    release();                     // the OLD tick now reaches its finally
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await clock.advance(200);      // let the drain notice the tick finished
    await stopped;

    assert.equal(
      clock.pendingCount(), 1,
      'exactly one scheduled tick: the old generation must not have queued its own',
    );
    await live.stop();
  });

  test('start() twice does not stack chains', async () => {
    clock = fakeClock();
    const live = makeLive({ transcribe: async () => ({ words: [] }) });
    live.start();
    live.start();
    assert.equal(clock.pendingCount(), 1);
    await live.stop();
    assert.equal(clock.pendingCount(), 0, 'stop() clears the pending tick');
  });

  test('the drain bound is finite and generous enough for a real inference', () => {
    assert.ok(Number.isFinite(STOP_DRAIN_MAX_MS));
    assert.ok(STOP_DRAIN_MAX_MS >= 5000 && STOP_DRAIN_MAX_MS <= 60000);
  });
});
