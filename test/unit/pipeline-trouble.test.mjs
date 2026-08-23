// Tier-1 unit test for the console patterns that tell the pipeline e2e specs a
// stage broke (test/e2e/pipeline-trouble.mjs).
//
// Why this exists, concretely. Both pipeline specs assert the absence of any
// trouble log, because every off-thread failure falls back in-thread and still
// produces a good transcript: the log is the only evidence. Their patterns were
// copy-pasted and both copies missed the SAME string. workerReady logs
// `[Encode] worker init failed (...)`; the patterns matched only
// `[Encode] pool worker init failed`. So a pool worker that timed out during
// init logged nothing the spec could see, and the run failed with "expected the
// marker" and no clue why (hit for real on 2026-08-23 in a full-suite run).
//
// A regex asserted against strings retyped in the test would have passed just
// as happily. So the cases below are the literal templates from
// app/ui/src/lib/workerInit.js and app/ui/src/App.jsx, and the last test reads
// those two sources and fails if either grows a `[Encode]`/`[Decode]` warning
// the patterns do not cover.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { isPipelineTrouble } from '../../test/e2e/pipeline-trouble.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const APP_JSX = resolve(here, '../../app/ui/src/App.jsx');
const WORKER_INIT = resolve(here, '../../app/ui/src/lib/workerInit.js');

// Exactly what the app prints, template holes filled in.
const ENCODE_FAILURES = [
  '[Encode] worker init failed (init timed out after 120000 ms); falling back',
  '[Encode] worker init failed (init error); falling back',
  '[Encode] pool worker crashed: out of memory',
  '[Encode] pool unavailable, encoding on main thread: Error: nope',
  '[Encode] failed to start encode pool: Error: nope',
  '[Encode] pool disabled by hardware gate (cores)',
  '[Encode] pool setup failed, encoding in-thread: Error: nope',
  '[Encode] pooled run failed, retrying in-thread: Error: nope',
];

const DECODE_FAILURES = [
  '[Decode] worker init failed (init timed out after 120000 ms); falling back',
  '[Decode] pipeline setup failed, using in-thread decode: Error: nope',
  '[Decode] composed run failed, retrying in-thread: Error: nope',
];

// Healthy lines, including the success markers the specs match on. A pattern
// that swallowed these would make the specs fail on a perfectly good run.
const HEALTHY = [
  '[Encode] pool starting: 2 workers x 6 threads',
  '[Encode] pool engaged: 2 workers encoding chunks in parallel',
  '[Decode] pipeline engaged: pooled encode overlapping WASM decode in worker (composed)',
  '[Decode] pipeline engaged: GPU encode overlapping WASM decode in worker',
  '[Transcribe] Completed chunk 1/2',
];

describe('isPipelineTrouble', () => {
  for (const line of ENCODE_FAILURES) {
    test(`catches: ${line.slice(0, 52)}`, () => {
      assert.equal(isPipelineTrouble(line), true);
      assert.equal(isPipelineTrouble(line, { decode: true }), true);
    });
  }

  for (const line of DECODE_FAILURES) {
    test(`catches with decode on: ${line.slice(0, 44)}`, () => {
      assert.equal(isPipelineTrouble(line, { decode: true }), true);
      // The pool-only spec runs without a decode worker, so it deliberately
      // does not watch these.
      assert.equal(isPipelineTrouble(line), false);
    });
  }

  for (const line of HEALTHY) {
    test(`ignores: ${line.slice(0, 56)}`, () => {
      assert.equal(isPipelineTrouble(line, { decode: true }), false);
    });
  }
});

describe('coverage of what the app really logs', () => {
  test('every [Encode]/[Decode] console.warn in the sources is matched', () => {
    // console.warn is the app's failure channel here (console.log is used for
    // the positive markers and progress), so a warn the patterns miss is
    // exactly the blind spot this file exists to close.
    const sources = [readFileSync(APP_JSX, 'utf-8'), readFileSync(WORKER_INIT, 'utf-8')].join('\n');
    const warns = [...sources.matchAll(/console\.warn\(\s*[`'"]\[(Encode|Decode)\]([^`'"]*)/g)];
    assert.ok(warns.length >= 6, `expected to find the warn sites, found ${warns.length}`);

    const uncovered = [];
    for (const [, tag, rest] of warns) {
      // Drop template holes so `(${why})` does not defeat the match.
      const line = `[${tag}]${rest}`.replace(/\$\{[^}]*\}/g, 'X');
      if (!isPipelineTrouble(line, { decode: true })) uncovered.push(line);
    }
    assert.deepEqual(uncovered, [],
      `these failure logs would be invisible to the pipeline specs:\n${uncovered.join('\n')}`);
  });
});
