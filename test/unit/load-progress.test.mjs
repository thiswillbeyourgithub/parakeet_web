// planLoadProgress: one hub progress event -> what the load UI should show.
//
// This was an inline closure over four refs and five formatters inside
// loadModel, so the line a visitor stares at during a multi-minute 2.4 GB
// download had no test at all. The individual formatters were covered; their
// assembly was not, and neither were the two rules that are easy to get subtly
// wrong: what counts as a NETWORK byte on a resumed download, and when the app
// is allowed to claim it is downloading.
//
// `t` is stubbed as identity-with-markers so the assertions pin the SHAPE of
// the string (order, separators, which parts appear) without depending on the
// English copy.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planLoadProgress } from '../../app/ui/src/lib/loadProgress.js';

const t = (key) => ({
  retryingDownload: 'Retry {n}/{total}: {file}',
  resuming: 'Resuming',
  etaRemaining: 'left',
}[key] ?? key);

const NOTHING = {
  progressText: null,
  progressPct: null,
  downloading: false,
  fileTransferredBytes: null,
  rateState: null,
};

describe('attempt events', () => {
  test('a retry is announced with its number, total and file', () => {
    const plan = planLoadProgress(
      { attempt: 2, maxAttempts: 3, file: 'encoder.onnx' }, { t, now: 0 });
    assert.equal(plan.progressText, 'Retry 2/3: encoder.onnx');
  });

  test('an attempt event is never proof of a download and never credits bytes', () => {
    const plan = planLoadProgress(
      { attempt: 2, maxAttempts: 3, file: 'encoder.onnx' }, { t, now: 0 });
    assert.equal(plan.downloading, false);
    assert.equal(plan.fileTransferredBytes, null);
    assert.equal(plan.rateState, null);
  });

  test('a single-attempt download says nothing at all: "Retry 1/1" would make '
    + 'an ordinary first try look like a recovery', () => {
    assert.deepEqual(
      planLoadProgress({ attempt: 1, maxAttempts: 1, file: 'a.onnx' }, { t, now: 0 }),
      NOTHING);
  });

  test('only the FIRST attempt rewinds the bar; a later retry leaves it alone, '
    + 'because a resume picks up from the prefix already on disk', () => {
    assert.equal(planLoadProgress({ attempt: 1, maxAttempts: 3, file: 'a' }, { t, now: 0 }).progressPct, 0);
    assert.equal(planLoadProgress({ attempt: 2, maxAttempts: 3, file: 'a' }, { t, now: 0 }).progressPct, null);
  });

  test('attempt 0 is still an attempt event, not a byte event', () => {
    const plan = planLoadProgress({ attempt: 0, maxAttempts: 3, file: 'a' }, { t, now: 0 });
    assert.equal(plan.downloading, false);
  });
});

describe('byte events: what counts as a network byte', () => {
  test('a plain download credits everything loaded', () => {
    const plan = planLoadProgress({ file: 'a', loaded: 1000, total: 4000 }, { t, now: 0 });
    assert.equal(plan.fileTransferredBytes, 1000);
  });

  test('a RESUMED download credits only what the connection was asked for, '
    + 'not the prefix already cached', () => {
    const plan = planLoadProgress(
      { file: 'a', loaded: 1000, total: 4000, resumed: true, resumedFrom: 600 }, { t, now: 0 });
    assert.equal(plan.fileTransferredBytes, 400);
  });

  test('the credit is monotonic per file, so a retry that restarts a stream '
    + 'cannot make the accounted total shrink', () => {
    const plan = planLoadProgress(
      { file: 'a', loaded: 100, total: 4000 }, { t, now: 0, previousTransferred: 900 });
    assert.equal(plan.fileTransferredBytes, 900);
  });

  test('a resumedFrom ahead of loaded never credits negative bytes', () => {
    const plan = planLoadProgress(
      { file: 'a', loaded: 100, total: 4000, resumedFrom: 500 }, { t, now: 0 });
    assert.equal(plan.fileTransferredBytes, 0);
  });

  test('a byte event is the proof that lets the app say "downloading": a load '
    + 'answered entirely from IndexedDB emits none and must not claim one', () => {
    assert.equal(planLoadProgress({ file: 'a', loaded: 1, total: 2 }, { t, now: 0 }).downloading, true);
  });
});

describe('byte events: the line the visitor reads', () => {
  test('names the file, both sizes and the percentage', () => {
    const plan = planLoadProgress(
      { file: 'encoder.onnx', loaded: 512 * 1024 * 1024, total: 1024 * 1024 * 1024 },
      { t, now: 0 });
    assert.match(plan.progressText, /^encoder\.onnx: 512\.0 MB \/ 1\.00 GB \(50%\)$/);
    assert.equal(plan.progressPct, 50);
  });

  test('an unknown total drops the sizes and reports 0% rather than NaN%', () => {
    const plan = planLoadProgress({ file: 'a.onnx', loaded: 1234, total: 0 }, { t, now: 0 });
    assert.equal(plan.progressText, 'a.onnx: (0%)');
    assert.equal(plan.progressPct, 0);
  });

  test('a resumed download is labelled as one, ahead of the filename', () => {
    const plan = planLoadProgress(
      { file: 'a.onnx', loaded: 100, total: 200, resumed: true, resumedFrom: 50 }, { t, now: 0 });
    assert.match(plan.progressText, /^Resuming a\.onnx:/);
  });

  test('the first byte event has no rate yet, so no stats suffix is invented', () => {
    const plan = planLoadProgress({ file: 'a', loaded: 100, total: 1000 }, { t, now: 1000 });
    assert.equal(plan.progressText, 'a: 100 B / 1000 B (10%)');
  });
});

describe('byte events: rate and ETA across a sequence', () => {
  test('once a window exists the line gains a rate and a countdown, and the '
    + 'state carried forward is what produces them', () => {
    // 1 MB/s: 1 MB more each second, out of 10 MB.
    const MB = 1024 * 1024;
    let state = null;
    let plan;
    for (let i = 0; i <= 3; i += 1) {
      plan = planLoadProgress(
        { file: 'enc', loaded: i * MB, total: 10 * MB },
        { t, now: i * 1000, rateState: state });
      state = plan.rateState;
    }
    assert.match(plan.progressText, /\(30%\) \(1\.0 MB\/s, 00:07 left\)/);
  });

  test('a different file re-anchors instead of reading the switch as a burst', () => {
    const MB = 1024 * 1024;
    let state = planLoadProgress(
      { file: 'enc', loaded: 0, total: 10 * MB }, { t, now: 0 }).rateState;
    state = planLoadProgress(
      { file: 'enc', loaded: 5 * MB, total: 10 * MB }, { t, now: 1000, rateState: state }).rateState;
    const plan = planLoadProgress(
      { file: 'dec', loaded: 0, total: 10 * MB }, { t, now: 1100, rateState: state });
    assert.equal(plan.progressText, 'dec: 0 B / 10.0 MB (0%)');
    assert.equal(plan.rateState.file, 'dec');
  });
});
