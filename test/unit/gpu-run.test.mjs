// Tier-1 test for the html.gpu-run depth counter (app/ui/src/lib/gpuRun.js):
// overlapping WebGPU holders must not unpause each other's animations early,
// and a double release must not steal another holder's count.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireGpuRun } from '../../app/ui/src/lib/gpuRun.js';

function fakeRoot() {
  const classes = new Set();
  return { classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
}

test('class stays while any holder remains, goes with the last', () => {
  const root = fakeRoot();
  const a = acquireGpuRun(root);
  const b = acquireGpuRun(root);
  assert.ok(root.classes.has('gpu-run'));
  a();
  assert.ok(root.classes.has('gpu-run'), 'released early while b still runs');
  b();
  assert.ok(!root.classes.has('gpu-run'));
});

test('releasing twice is a no-op, not a second decrement', () => {
  const root = fakeRoot();
  const a = acquireGpuRun(root);
  const b = acquireGpuRun(root);
  a();
  a();
  assert.ok(root.classes.has('gpu-run'), 'a double release stole b\'s hold');
  b();
  assert.ok(!root.classes.has('gpu-run'));
});
