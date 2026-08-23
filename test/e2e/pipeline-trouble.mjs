// Console-log patterns that mean an off-thread pipeline stage broke, shared by
// the specs that assert the encode pool / decode worker really engaged
// (transcription-parallel-encode.spec.js, transcription-composed-pipeline.spec.js).
//
// Why this matters more than it looks. Every failure in these stages falls back
// to the in-thread path, which produces a perfectly good transcript, so output
// quality proves nothing: the only evidence is the log. Those specs therefore
// assert BOTH the positive "engaged" marker and the absence of any trouble log.
//
// The two lists used to be copy-pasted into both specs, and both copies missed
// the same string: workerReady (lib/workerInit.js) logs
// `[Encode] worker init failed (...)`, while the patterns only matched
// `[Encode] pool worker init failed`. A pool worker that timed out or crashed
// during init therefore produced NO matching log and NO engaged marker, so the
// spec failed with "expected the marker" and nothing pointing at the cause.
// Keeping one copy here is what stops the two from drifting again, and the unit
// test pins the patterns against the literal strings the app really logs.
//
// Built with Claude Code.

// `[Encode] worker init failed (...)` comes from workerReady; the rest are
// logged by App.jsx around the pool's lifecycle.
export const ENCODE_TROUBLE_RE =
  /\[Encode\] ((pool )?worker (crashed|init failed)|pooled run failed|pool setup failed|failed to start|pool unavailable|pool disabled)/;

// Same shape for the decode worker: `[Decode] worker init failed (...)` from
// workerReady, plus App.jsx's own run/setup failures.
export const DECODE_TROUBLE_RE =
  /\[Decode\] (worker init failed|composed run failed|pipelined run failed|pipeline setup failed|failed to start decode worker|worker (error|unavailable))/;

/**
 * True when a console line means an off-thread stage failed and the run
 * silently fell back in-thread.
 *
 * @param {string} text console message text
 * @param {{decode?: boolean}} [opts] also match decode-worker failures (the
 *   composed spec drives both stages; the pool-only spec drives just the pool).
 */
export function isPipelineTrouble(text, { decode = false } = {}) {
  return ENCODE_TROUBLE_RE.test(text) || (decode && DECODE_TROUBLE_RE.test(text));
}
