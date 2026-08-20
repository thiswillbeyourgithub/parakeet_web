// Tier-1 unit test for the WASM thread-count policy:
// - defaultWasmThreads (app/src/backend.js): ORT-style min(4, ceil(hc / 2)).
//   hardwareConcurrency counts hyperthreads and ORT-WASM's spin-waiting pool
//   makes oversubscription slower than fewer threads (measured on a 6C/12T
//   box: 12 threads encode slower than 1), so the old `hc - 2` default was
//   harmful on typical laptops.
// - restoreCpuThreads (app/ui/src/lib/cpuThreads.js): restoring the persisted
//   slider value, including the ONE-TIME migration of the legacy `hc - 2`
//   default (usePersistedSetting writes defaults back on first boot, so
//   existing installs carry it as if it were a user choice).
// Pure logic: no model, no DOM. Built with Claude Code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { defaultWasmThreads } from '../../app/src/backend.js';
import { restoreCpuThreads, encodePoolPlan } from '../../app/ui/src/lib/cpuThreads.js';

describe('defaultWasmThreads: ORT-style physical-core estimate capped at 4', () => {
  test('halves the logical count (rounding up) below the cap', () => {
    assert.equal(defaultWasmThreads(2), 1);
    assert.equal(defaultWasmThreads(4), 2);
    assert.equal(defaultWasmThreads(5), 3);
    assert.equal(defaultWasmThreads(6), 3);
    assert.equal(defaultWasmThreads(8), 4);
  });

  test('caps at 4 threads no matter how many cores report', () => {
    assert.equal(defaultWasmThreads(12), 4);
    assert.equal(defaultWasmThreads(16), 4);
    assert.equal(defaultWasmThreads(64), 4);
  });

  test('never returns less than 1', () => {
    assert.equal(defaultWasmThreads(1), 1);
  });

  test('missing/invalid hardwareConcurrency falls back to 8 logical -> 4 threads', () => {
    assert.equal(defaultWasmThreads(undefined), 4);
    assert.equal(defaultWasmThreads(0), 4);
    assert.equal(defaultWasmThreads(NaN), 4);
    assert.equal(defaultWasmThreads(-3), 4);
  });
});

describe('restoreCpuThreads: persisted-slider restore + legacy-default migration', () => {
  test('fresh install (nothing stored) gets the new default', () => {
    assert.deepEqual(
      restoreCpuThreads({ stored: null, migrated: false, maxCores: 8 }),
      { threads: 4, migrationApplied: false },
    );
  });

  test('the stored legacy default (hc - 2) is migrated to the new default exactly once', () => {
    // 4C/8T laptop: legacy default was 6 threads on 4 physical cores.
    assert.deepEqual(
      restoreCpuThreads({ stored: 6, migrated: false, maxCores: 8 }),
      { threads: 4, migrationApplied: true },
    );
    // 6C/12T box: legacy default was 10.
    assert.deepEqual(
      restoreCpuThreads({ stored: 10, migrated: false, maxCores: 12 }),
      { threads: 4, migrationApplied: true },
    );
  });

  test('after the migration flag is set, that same value is an honoured user choice', () => {
    assert.deepEqual(
      restoreCpuThreads({ stored: 6, migrated: true, maxCores: 8 }),
      { threads: 6, migrationApplied: false },
    );
  });

  test('any other stored value is a user choice and passes through', () => {
    assert.deepEqual(
      restoreCpuThreads({ stored: 2, migrated: false, maxCores: 8 }),
      { threads: 2, migrationApplied: false },
    );
    assert.deepEqual(
      restoreCpuThreads({ stored: 8, migrated: false, maxCores: 8 }),
      { threads: 8, migrationApplied: false },
    );
  });

  test('small machines where legacy <= new default need no migration', () => {
    // hc=4: legacy = 2 = new default; stays put, no flag churn.
    assert.deepEqual(
      restoreCpuThreads({ stored: 2, migrated: false, maxCores: 4 }),
      { threads: 2, migrationApplied: false },
    );
  });

  test('stored values are clamped to [1, maxCores] and garbage falls back to the default', () => {
    assert.equal(restoreCpuThreads({ stored: 32, migrated: true, maxCores: 8 }).threads, 8);
    assert.equal(restoreCpuThreads({ stored: 0, migrated: true, maxCores: 8 }).threads, 4);
    assert.equal(restoreCpuThreads({ stored: 'lots', migrated: true, maxCores: 8 }).threads, 4);
    assert.equal(restoreCpuThreads({ stored: 3.6, migrated: true, maxCores: 8 }).threads, 4);
  });
});

describe('encodePoolPlan: chunk-parallel encode pool gate + thread split', () => {
  test('typical laptops get 2 workers, each with half the user thread budget', () => {
    assert.deepEqual(encodePoolPlan({ cpuThreads: 4, maxCores: 8, deviceMemory: 8 }),
      { workers: 2, threadsPerWorker: 2, reason: null });
    assert.deepEqual(encodePoolPlan({ cpuThreads: 6, maxCores: 12, deviceMemory: 8 }),
      { workers: 2, threadsPerWorker: 3, reason: null });
    // Odd budgets round down so the pool never exceeds the user's budget.
    assert.deepEqual(encodePoolPlan({ cpuThreads: 5, maxCores: 8, deviceMemory: 8 }),
      { workers: 2, threadsPerWorker: 2, reason: null });
    // 8-core floor machine with a small thread budget: 2 single-thread workers.
    assert.deepEqual(encodePoolPlan({ cpuThreads: 2, maxCores: 8, deviceMemory: 8 }),
      { workers: 2, threadsPerWorker: 1, reason: null });
  });

  test('undefined deviceMemory (Firefox/Node never expose it) passes the memory gate', () => {
    assert.equal(encodePoolPlan({ cpuThreads: 4, maxCores: 8, deviceMemory: undefined }).workers, 2);
  });

  test('gates: small core counts, low memory, unsplittable thread budget', () => {
    assert.deepEqual(encodePoolPlan({ cpuThreads: 2, maxCores: 2, deviceMemory: 8 }),
      { workers: 0, threadsPerWorker: 0, reason: 'cores' });
    // 4-7 logical cores are refused since the 2026-08 quiet-vs-loaded A/B:
    // the pool's measured envelope is ~+4% quiet / ~-15% contended, so mid-size
    // machines (where "quiet" is rarest) no longer gamble on it.
    assert.deepEqual(encodePoolPlan({ cpuThreads: 2, maxCores: 4, deviceMemory: 8 }),
      { workers: 0, threadsPerWorker: 0, reason: 'cores' });
    assert.deepEqual(encodePoolPlan({ cpuThreads: 4, maxCores: 7, deviceMemory: 8 }),
      { workers: 0, threadsPerWorker: 0, reason: 'cores' });
    assert.deepEqual(encodePoolPlan({ cpuThreads: 4, maxCores: 8, deviceMemory: 4 }),
      { workers: 0, threadsPerWorker: 0, reason: 'memory' });
    assert.deepEqual(encodePoolPlan({ cpuThreads: 1, maxCores: 8, deviceMemory: 8 }),
      { workers: 0, threadsPerWorker: 0, reason: 'threads' });
  });

  test('garbage cpuThreads falls back to the default thread budget', () => {
    // hc=8 -> defaultWasmThreads 4 -> 2 workers x 2 threads.
    assert.deepEqual(encodePoolPlan({ cpuThreads: NaN, maxCores: 8, deviceMemory: 8 }),
      { workers: 2, threadsPerWorker: 2, reason: null });
  });
});
