// Tier-2 integration test for POST /api/benchmark-report against the real
// signaling server: the receiver behind the sidebar Benchmark section's
// "send to the developer" button.
//
// Covers the properties that make the endpoint safe to expose: it stays OFF
// until an operator points BENCHMARK_REPORTS_DIR at a folder, it refuses
// anything that is not a report of the expected format, it names every stored
// file itself (so no request-controlled byte can reach a path), it stores
// re-serialised JSON rather than raw request bytes, it caps both the report
// size and the number of files, and it never writes anything about the sender.
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, stopServer, apiPost } from './helpers.mjs';

const FORMAT = 'parakeetweb-benchmark-report/1';

function sampleReport(extra = {}) {
  return {
    format: FORMAT,
    reportId: 'test-report',
    generatedAt: '2026-08-13T00:00:00.000Z',
    app: { version: '1.2.3' },
    settings: { cpuThreads: 4 },
    clip: { shortSec: 11.09 },
    environment: { hardware: { hardwareConcurrency: 8 } },
    results: [{ id: 'wasm:int8', status: 'ok', rtf: 0.42 }],
    ...extra,
  };
}

describe('benchmark report collection disabled', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await stopServer(srv); });

  test('the endpoint answers 503 when no reports directory is configured', async () => {
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport());
    assert.equal(res.status, 503);
  });
});

describe('benchmark report collection enabled', () => {
  let srv;
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parakeet-bench-'));
    srv = await startServer({ BENCHMARK_REPORTS_DIR: dir });
  });
  after(async () => {
    await stopServer(srv);
    await rm(dir, { recursive: true, force: true });
  });

  test('a well-formed report is stored as its own JSON file', async () => {
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport());
    assert.equal(res.status, 204);

    const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^report-\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}\.json$/);

    const stored = JSON.parse(await readFile(join(dir, files[0]), 'utf-8'));
    assert.equal(stored.format, FORMAT);
    assert.equal(stored.results[0].rtf, 0.42);
    // Nothing about the sender is added next to the payload: the report is
    // anonymous by design and stamping an IP here would undo that.
    assert.equal(stored.ip, undefined);
    assert.equal(stored.origin, undefined);
    assert.equal(stored.userAgent, undefined);
  });

  test('two reports never collide, each lands in its own file', async () => {
    const before = (await readdir(dir)).length;
    await apiPost(srv, '/api/benchmark-report', sampleReport({ reportId: 'a' }));
    await apiPost(srv, '/api/benchmark-report', sampleReport({ reportId: 'b' }));
    const after = (await readdir(dir)).length;
    assert.equal(after, before + 2);
  });

  test('a foreign or missing format is rejected (400)', async () => {
    for (const body of [sampleReport({ format: 'something-else/9' }), { hello: 'world' }, []]) {
      const res = await apiPost(srv, '/api/benchmark-report', body);
      assert.equal(res.status, 400);
    }
  });

  test('a padded report over the route limit is rejected (413)', async () => {
    // Under express.json's 50 KB cap so it reaches the route, over the route's
    // own 32 KB bound.
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport({ app: { padding: 'x'.repeat(40 * 1024) } }));
    assert.equal(res.status, 413);
  });

  test('a path-shaped field cannot influence the stored filename', async () => {
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport({
      reportId: '../../escaped',
      app: { filename: '/etc/passwd' },
    }));
    assert.equal(res.status, 204);
    const files = await readdir(dir);
    assert.ok(files.every(f => /^report-[\w.-]+\.json$/.test(f)), `unexpected filenames: ${files}`);
  });

  test('stored content is re-serialised JSON, not the raw request bytes', async () => {
    // A body with duplicate keys and odd whitespace still lands as canonical
    // JSON of the parsed object.
    const raw = JSON.stringify(sampleReport({ reportId: 'first' }))
      .replace('"reportId":"first"', '"reportId":"first",   "reportId":"second"');
    const res = await fetch(`${srv.baseUrl}/api/benchmark-report`, {
      method: 'POST',
      headers: { Origin: srv.origin, 'Content-Type': 'application/json' },
      body: raw,
    });
    assert.equal(res.status, 204);
    const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
    const stored = await readFile(join(dir, files[files.length - 1]), 'utf-8');
    assert.ok(!stored.includes('   '), 'raw request whitespace must not be stored verbatim');
    assert.equal(JSON.parse(stored).reportId, 'second');
  });
});

describe('benchmark report shape validation', () => {
  let srv;
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parakeet-bench-shape-'));
    srv = await startServer({ BENCHMARK_REPORTS_DIR: dir });
  });
  after(async () => {
    await stopServer(srv);
    await rm(dir, { recursive: true, force: true });
  });

  async function expectRejected(body, label) {
    const res = await apiPost(srv, '/api/benchmark-report', body);
    assert.equal(res.status, 400, `${label} should be refused`);
    const json = await res.json();
    assert.match(json.message, /^Malformed report/, label);
  }

  test('a report with every optional field null is accepted', async () => {
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport({ reportId: null, generatedAt: null }));
    assert.equal(res.status, 204);
  });

  test('unknown top-level fields are refused', async () => {
    await expectRejected(sampleReport({ filename: '/etc/passwd' }), 'extra field');
    await expectRejected(sampleReport({ padding: 'x' }), 'padding field');
  });

  test('wrong section types are refused', async () => {
    await expectRejected(sampleReport({ results: { id: 'wasm:int8' } }), 'results as object');
    await expectRejected(sampleReport({ results: ['wasm:int8'] }), 'results of strings');
    await expectRejected(sampleReport({ app: 'v1' }), 'app as string');
    await expectRejected(sampleReport({ environment: [] }), 'environment as array');
    await expectRejected(sampleReport({ reportId: 42 }), 'numeric reportId');
  });

  test('prototype-polluting keys are refused at any depth', async () => {
    // Sent as raw text: a JS literal would not even create an own __proto__.
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const raw = JSON.stringify(sampleReport()).replace('"hardwareConcurrency"', JSON.stringify(key));
      const res = await fetch(`${srv.baseUrl}/api/benchmark-report`, {
        method: 'POST',
        headers: { Origin: srv.origin, 'Content-Type': 'application/json' },
        body: raw,
      });
      assert.equal(res.status, 400, `${key} key should be refused`);
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      assert.ok(!(await readFile(join(dir, f), 'utf-8')).includes('__proto__'), 'nothing polluting was stored');
    }
  });

  test('a nesting bomb is refused with 400, not a 500', async () => {
    const deep = JSON.parse('['.repeat(4000) + ']'.repeat(4000));
    await expectRejected(sampleReport({ environment: { deep } }), 'nesting bomb');
  });

  test('control characters and oversized strings are refused', async () => {
    await expectRejected(sampleReport({ app: { version: 'x\u001b[31mred' } }), 'ANSI escape');
    await expectRejected(sampleReport({ app: { 'bad\u0000key': 1 } }), 'NUL in a key');
    await expectRejected(sampleReport({ app: { version: 'y'.repeat(5000) } }), 'oversized string');
    // Newlines and tabs are ordinary text (an error message may wrap).
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport({ app: { note: 'line one\nline\ttwo' } }));
    assert.equal(res.status, 204);
  });
});

describe('benchmark report instance-wide quota', () => {
  let srv;
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parakeet-bench-quota-'));
    // The per-IP limiter stays off (helpers set TEST_DISABLE_RATE_LIMIT), so
    // only the process-wide bucket can refuse here.
    srv = await startServer({ BENCHMARK_REPORTS_DIR: dir, BENCHMARK_REPORTS_MAX_PER_MINUTE: '2' });
  });
  after(async () => {
    await stopServer(srv);
    await rm(dir, { recursive: true, force: true });
  });

  test('reports past the per-minute cap get 429 with Retry-After and are not stored', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await apiPost(srv, '/api/benchmark-report', sampleReport());
      assert.equal(res.status, 204, `report ${i + 1} within the cap`);
    }
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 2);
  });
});

describe('benchmark report store full', () => {
  let srv;
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'parakeet-bench-full-'));
    await writeFile(join(dir, 'report-existing.json'), '{}');
    srv = await startServer({ BENCHMARK_REPORTS_DIR: dir, BENCHMARK_REPORTS_MAX_FILES: '1' });
  });
  after(async () => {
    await stopServer(srv);
    await rm(dir, { recursive: true, force: true });
  });

  test('the file cap refuses further reports (507) instead of filling the disk', async () => {
    const res = await apiPost(srv, '/api/benchmark-report', sampleReport());
    assert.equal(res.status, 507);
    assert.deepEqual(await readdir(dir), ['report-existing.json']);
  });
});
