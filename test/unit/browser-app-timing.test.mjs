// parseTimingLine (scripts/lib/browser-app.mjs): the shared reader the browser
// harnesses (webgpu-check.mjs, transcribe-browser.mjs) use for App.jsx's own
// end-of-run timing lines. The fixtures below are built exactly the way
// App.jsx formats them, so a change on either side shows up here.
// Written with Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimingLine } from '../../scripts/lib/browser-app.mjs';

test('reads the total time, with and without the beam estimate suffix', () => {
  assert.deepEqual(
    parseTimingLine('[Transcribe] Total time for entire audio: 8.5s (proc_t/dur_t 0.047)'),
    { totalTime: '8.5s (proc_t/dur_t 0.047)' });
  assert.deepEqual(
    parseTimingLine('[Transcribe] Total time for entire audio: 1m 26s (proc_t/dur_t 0.478)'
      + ' (~1m 2s estimated with beamWidth=1, current beamWidth=5)'),
    { totalTime: '1m 26s (proc_t/dur_t 0.478)' });
});

test('reads the encode/decode stage split', () => {
  assert.deepEqual(
    parseTimingLine('[Transcribe] Stage split: encode 4.6s, decode 3.9s | pipeline overlap ceiling ~3.9s (min of the two)'),
    { stageSplit: 'encode 4.6s, decode 3.9s | pipeline overlap ceiling ~3.9s (min of the two)' });
});

test('ignores every other console line', () => {
  assert.equal(parseTimingLine('[Decode] pipeline engaged'), null);
  assert.equal(parseTimingLine('[Transcribe] chunk 2/4'), null);
});
