// A tiny serial task queue: each enqueued task starts only after the previous
// one has settled, so a burst of async writes can never overlap or land out of
// order. Used to serialise writes to the transcripts IndexedDB store, where two
// fire-and-forget saves issued back to back (e.g. diarize then rename) would
// otherwise race as independent transactions and let an earlier put resolve
// AFTER a later one, leaving stale data on disk.
//
// The returned `enqueue(task)`:
//   - runs `task` after every previously-enqueued task has settled (ordering is
//     preserved regardless of how long each task takes),
//   - keeps the chain alive even if a task rejects (a failed write must not
//     wedge every later write),
//   - returns a promise that reflects THIS task's own outcome, so the caller can
//     await/observe its success or failure.
//
// Built with Claude Code.

export function createSerialQueue() {
  // Resolved tail of the chain. The next task hangs off it via `.then(task, task)`
  // so it fires once the previous task settles, whether it fulfilled or threw.
  let tail = Promise.resolve();
  return function enqueue(task) {
    const result = tail.then(task, task);
    // Advance the chain on a swallowed copy so one task's rejection does not
    // break ordering for the tasks queued after it.
    tail = result.then(() => {}, () => {});
    return result;
  };
}
