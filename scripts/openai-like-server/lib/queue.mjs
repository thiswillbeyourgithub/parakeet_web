// Strict FIFO single-slot job queue.
//
// WHY SERIALISE AT ALL: the pipeline holds ONE ParakeetModel, whose joiner
// session is stateful (the TDT decoder feeds its own decoder state back in), and
// one sherpa diarization engine. Two concurrent transcriptions would interleave
// on the same session and corrupt both. So exactly one job runs at a time and
// the rest wait in arrival order; parallelism, if wanted, comes from running
// several containers behind a load balancer (documented in the README) rather
// than from N models fighting over the same CPU.
//
// TIMEOUT SEMANTICS, stated plainly because they are not what they look like:
// the deadline covers queue wait + run, but a job that has already STARTED
// cannot be cancelled -- neither an in-flight ORT `run()` nor sherpa's
// synchronous `process()` is interruptible. So on expiry we stop waiting and
// reject the caller (the route turns that into 504), while the job keeps running
// to completion in the background and only then frees the slot. A waiting job,
// by contrast, is genuinely removed and never runs.
//
// Built with Claude Code.

import { tooManyRequests, timeout as timeoutError } from './errors.mjs';

/**
 * @param {object} opts
 * @param {number} opts.maxQueue how many jobs may WAIT (0 = no waiting allowed)
 * @param {number} opts.timeoutMs deadline per job, wait included
 */
export function createQueue({ maxQueue = 8, timeoutMs = 1800_000 } = {}) {
  /** @type {Array<{run:Function, resolve:Function, reject:Function, timer:any, settled:boolean}>} */
  const waiting = [];
  let active = null;

  function depth() { return waiting.length; }

  function settle(entry, fn, value) {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    fn(value);
  }

  async function pump() {
    if (active || !waiting.length) return;
    const entry = waiting.shift();
    active = entry;
    try {
      const value = await entry.run();
      settle(entry, entry.resolve, value);
    } catch (err) {
      settle(entry, entry.reject, err);
    } finally {
      active = null;
      // Loop rather than recurse so a long queue cannot grow the stack.
      queueMicrotask(pump);
    }
  }

  /**
   * Enqueue `job` (an async function). Rejects immediately with 429 when the
   * queue is full, or with 504 once the deadline passes.
   */
  function run(job) {
    if (active && waiting.length >= maxQueue) {
      // Retry-After is a guess by construction (we cannot know how long the
      // running clip is), so keep it small and honest rather than precise.
      throw tooManyRequests(
        `server busy: one transcription runs at a time and ${waiting.length} request(s) are already waiting `
        + `(--max-queue ${maxQueue})`,
        5,
      );
    }
    return new Promise((resolve, reject) => {
      const entry = { run: job, resolve, reject, settled: false, timer: null, startedAt: null };
      entry.timer = setTimeout(() => {
        const idx = waiting.indexOf(entry);
        const wasWaiting = idx !== -1;
        if (wasWaiting) waiting.splice(idx, 1);
        settle(entry, reject, timeoutError(
          wasWaiting
            ? `gave up after ${Math.round(timeoutMs / 1000)}s waiting in the queue (--request-timeout)`
            : `transcription exceeded ${Math.round(timeoutMs / 1000)}s (--request-timeout); it keeps running `
              + 'server-side and cannot be cancelled, so the next request may still queue behind it',
        ));
      }, timeoutMs);
      // Do not keep the process alive just for a pending deadline.
      entry.timer.unref?.();
      waiting.push(entry);
      pump();
    });
  }

  return {
    run,
    depth,
    /** True while a job holds the slot. */
    get busy() { return active !== null; },
    /** Snapshot for /health. */
    stats() { return { busy: active !== null, waiting: waiting.length, maxQueue }; },
  };
}
