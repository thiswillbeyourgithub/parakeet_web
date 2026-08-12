// Shared init handshake for the module workers (decode.worker.js,
// encode.worker.js): post the init message and resolve a boolean that ALWAYS
// settles. Three failure signals are folded in, because each one really
// happens and any of them left un-handled hangs every transcription gated on
// worker readiness:
//  - an init-scoped {type:'error'} message (the worker caught its own failure),
//  - the worker 'error' EVENT (the script asset failed to fetch/compile, or an
//    uncaught throw during init; no message is ever posted in that case),
//  - silence (a wedged session build): the watchdog settles false so the
//    caller falls back to the in-thread path instead of waiting forever.
//
// Built with Claude Code.

// 120 s covers a slow cold init (the decode worker stages the joiner +
// tokenizer, an encode worker up to 2.4 GB of fp32 weights) with margin.
export const WORKER_INIT_WATCHDOG_MS = 120000;

/**
 * @param {Worker} worker target worker (already constructed)
 * @param {object} initParams posted verbatim as the init message
 * @param {{timeoutMs?: number, label?: string}} [opts] label prefixes the
 *   console.warn on failure ('Decode' -> '[Decode] ...').
 * @returns {Promise<boolean>} true once the worker posts {type:'ready'};
 *   false on init error message, worker error event, or timeout.
 */
export function workerReady(worker, initParams, { timeoutMs = WORKER_INIT_WATCHDOG_MS, label = 'Worker' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      if (!ok) console.warn(`[${label}] worker init failed (${why}); falling back`);
      resolve(ok);
    };
    const onMsg = (ev) => {
      const msg = ev.data || {};
      // Init-scoped errors carry no id; per-request errors (id != null) are
      // routed by the caller's own message listener and ignored here.
      if (msg.type === 'ready') settle(true);
      else if (msg.type === 'error' && msg.id == null) settle(false, msg.message || 'init error');
    };
    const onErr = (e) => settle(false, e?.message || 'worker script error');
    const timer = setTimeout(() => settle(false, `init timed out after ${timeoutMs} ms`), timeoutMs);
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    worker.postMessage(initParams);
  });
}
