// A gated FIFO buffer for audio captures made before the model is ready.
//
// The record / phone / upload paths can now produce audio while the model is
// still downloading or compiling (the user opted to start capturing during the
// load). Each finished capture is `submit()`ed here; it is transcribed in
// enqueue order as soon as the model can run one, and left buffered until then.
// `drain()` is also called explicitly when the model finishes loading (or when
// a transcription completes) so a capture that arrived while the model was busy
// gets picked up.
//
// Distinct from lib/writeQueue.js's createSerialQueue, which runs every task
// immediately (just in order): this queue HOLDS tasks until `canRun()` is true,
// which is the whole point (no model yet, or one already running).
//
// Injected collaborators (so the whole thing is pure and unit-testable):
//   - canRun():   truthy when a queued job may start now (model loaded AND not
//                 recording AND no transcription already in flight). Re-checked
//                 before every job so the queue self-pauses if state changes.
//   - runJob(job): starts the transcription for a job; returns a promise that
//                 settles when it finishes. Rejections are swallowed so one bad
//                 job cannot wedge the rest.
//   - onCountChange(n): optional; called with the new pending count whenever it
//                 changes, for a "N clip(s) queued" indicator.
//
// Built with Claude Code.

export function createCaptureQueue({ canRun, runJob, onCountChange = () => {} }) {
  const pending = [];
  // Guards against two overlapping drains (submit() racing an explicit drain(),
  // or a re-entrant drain() from runJob's completion): only one loop consumes
  // the buffer at a time, so jobs never run concurrently on the single model.
  let draining = false;

  function setCount() {
    onCountChange(pending.length);
  }

  async function drain() {
    if (draining) return;
    if (!canRun()) return;
    draining = true;
    try {
      // Re-check canRun() every iteration: a recording could start, or the
      // model could be disposed for a swap, between jobs.
      while (pending.length > 0 && canRun()) {
        const job = pending.shift();
        setCount();
        try {
          await runJob(job);
        } catch (_) {
          // Swallow: a failed transcription must not stop the queue. runJob is
          // expected to surface the error to the user itself.
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    // Buffer a capture and try to drain immediately. Returns the drain promise
    // so a caller may await the buffer emptying if it wants to.
    submit(job) {
      pending.push(job);
      setCount();
      return drain();
    },
    // Kick the queue: run any buffered jobs that can run now. Safe to call at
    // any time (no-op while draining or when canRun() is false).
    drain,
    // Current number of buffered (not-yet-started) captures.
    get size() {
      return pending.length;
    },
  };
}
