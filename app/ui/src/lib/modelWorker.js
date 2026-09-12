// Shared message protocol for the module workers that host a ParakeetModel
// (decode.worker.js, encode.worker.js). The two used to be structural twins:
// same `modelPromise`, same init -> {type:'ready'}/{type:'error'} handshake,
// same FIFO `.then()` chain serialising runs on the one ORT session, same
// `String(e?.message ?? e)` error shaping and the same
// {type:'result', id, chunkIndex, ...} envelope. Only the model factory and
// the body of one message differed, so that is all a worker supplies here.
//
// This is the WORKER side of the contract whose MAIN-thread side is
// workerInit.js's `workerReady`: the {type:'ready'} / init-scoped
// {type:'error', message} (no id) shapes below are exactly what that handshake
// listens for, and per-request errors always carry an id so they are routed to
// the pending request rather than mistaken for an init failure.
//
// Built with Claude Code.

/**
 * Shape a thrown value the way both workers always have: the message when
 * there is one, else the value stringified.
 * @param {*} e Caught value.
 * @returns {string}
 */
export function errorMessage(e) {
  return String(e?.message ?? e);
}

/**
 * Install the worker's message handler.
 *
 * @param {object} spec
 * @param {(msg: object) => Promise<*>} spec.initModel Build the model from the
 *   init message. Its rejection is reported as the init-scoped error.
 * @param {string} spec.runType Message type of the serialised run request
 *   ('decode' / 'encode'). Runs are chained FIFO: one ORT session with mutable
 *   state per worker, so two concurrent runs would interleave and corrupt it
 *   (parallelism comes from the pool, not from inside one worker).
 * @param {(msg: object, model: *) => Promise<{payload?: object, transfer?: Array}>}
 *   spec.run Perform one run. `payload` is merged into the result message;
 *   `transfer` is the postMessage transfer list (zero-copy encoder outputs).
 * @param {Object<string, (msg: object) => object|undefined>} [spec.handlers]
 *   Extra, non-serialised, model-independent message types (the decode
 *   worker's 'boost'). A returned object is posted as-is; a throw becomes an
 *   init-scoped error message.
 * @param {{onmessage: *, postMessage: Function}} [spec.scope] Worker global,
 *   injectable so the protocol is unit-testable off a real Worker.
 */
export function createModelWorker({ initModel, runType, run, handlers = {}, scope = self }) {
  let modelPromise = null;
  // FIFO: never run two of them concurrently on the one session.
  let chain = Promise.resolve();

  const runOne = async (msg) => {
    const { id, chunkIndex } = msg;
    try {
      const model = await modelPromise;
      const { payload = {}, transfer } = (await run(msg, model)) || {};
      scope.postMessage({ type: 'result', id, chunkIndex, ...payload }, transfer || []);
    } catch (e) {
      scope.postMessage({ type: 'error', id, chunkIndex, message: errorMessage(e) });
    }
  };

  scope.onmessage = (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'init') {
      // Wrapped so a synchronous throw in initModel becomes the same
      // init-scoped error message an async failure does.
      modelPromise = Promise.resolve().then(() => initModel(msg));
      modelPromise.then(
        () => scope.postMessage({ type: 'ready' }),
        (e) => scope.postMessage({ type: 'error', message: errorMessage(e) }),
      );
      return;
    }
    if (msg.type === runType) {
      chain = chain.then(() => runOne(msg));
      return;
    }
    const handler = handlers[msg.type];
    if (!handler) return;
    try {
      const reply = handler(msg);
      if (reply) scope.postMessage(reply);
    } catch (e) {
      scope.postMessage({ type: 'error', message: errorMessage(e) });
    }
  };
}
