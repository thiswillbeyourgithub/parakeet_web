// test/e2e/serve.mjs must answer like a real static server: with a
// Content-Length, and with a 206 for a Range request.
//
// Why this exists: it did neither. GET piped a read stream with no length, so
// Node fell back to chunked transfer encoding, and the Range header was ignored
// outright. Nothing failed, which is the problem. The app treats a response
// with no length as one whose size it cannot know, and three of its loader
// paths are gated on knowing it: it will not preallocate a buffer for the file,
// will not report byte progress for it, and will not keep a resumable prefix of
// it. So every tier-3 spec was exercising a loader that had quietly taken the
// no-length branch, and the fp32 prefix cache read "kept 0 of 1483313152 bytes"
// against a harness that could not have fed it anything else. A fixture that
// under-serves this way does not fail tests, it hides the code they cover.
//
// Written with the help of Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const SERVE = join(ROOT, 'test/e2e/serve.mjs');

// Port 0: the OS hands out a free one and serve.mjs logs which. A fixed port
// makes this test flake against a server another run has not released yet.
let PORT = 0;
const BODY = Array.from({ length: 4096 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');

let proc;
let dirs = [];
const url = (p) => `http://127.0.0.1:${PORT}${p}`;

before(async () => {
  const dist = await mkdtemp(join(tmpdir(), 'serve-range-dist-'));
  const models = await mkdtemp(join(tmpdir(), 'serve-range-models-'));
  const boost = await mkdtemp(join(tmpdir(), 'serve-range-boost-'));
  dirs = [dist, models, boost];
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>range probe</title>');
  await writeFile(join(dist, 'payload.bin'), BODY);
  await writeFile(join(dist, 'empty.bin'), '');

  proc = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      PARAKEET_E2E_DIST_DIR: dist,
      PARAKEET_E2E_MODEL_DIR: models,
      PARAKEET_E2E_BOOST_DIR: boost,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  let exited = null;
  proc.on('exit', (code, signal) => { exited = signal ? `signal ${signal}` : `code ${code}`; });

  let up = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && exited === null) {
    const m = output.match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) {
      PORT = Number(m[1]);
      try { if ((await fetch(url('/'))).ok) { up = true; break; } } catch { /* not up yet */ }
    }
    await sleep(100);
  }
  assert.ok(up, `server never came up${exited ? ` (exited with ${exited})` : ''}: ${output.trim()}`);
});

after(async () => {
  if (proc) proc.kill('SIGTERM');
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('serve.mjs answers like a real static server', () => {
  test('a plain GET carries a Content-Length, not chunked encoding', async () => {
    const res = await fetch(url('/payload.bin'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(BODY.length));
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.ok(res.headers.get('etag'), 'an etag is what If-Range validates a partial against');
    assert.equal(await res.text(), BODY);
  });

  test('a HEAD still carries the length without reading the file', async () => {
    const res = await fetch(url('/payload.bin'), { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(BODY.length));
  });

  test('an open-ended Range gets a 206 with the tail', async () => {
    const from = 1000;
    const res = await fetch(url('/payload.bin'), { headers: { Range: `bytes=${from}-` } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${from}-${BODY.length - 1}/${BODY.length}`);
    assert.equal(res.headers.get('content-length'), String(BODY.length - from));
    assert.equal(await res.text(), BODY.slice(from));
  });

  test('a closed Range gets exactly that window', async () => {
    const res = await fetch(url('/payload.bin'), { headers: { Range: 'bytes=10-19' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 10-19/${BODY.length}`);
    assert.equal(await res.text(), BODY.slice(10, 20));
  });

  test('If-Range that still matches resumes, and one that does not sends the whole file', async () => {
    const etag = (await fetch(url('/payload.bin'), { method: 'HEAD' })).headers.get('etag');

    const fresh = await fetch(url('/payload.bin'), { headers: { Range: 'bytes=100-', 'If-Range': etag } });
    assert.equal(fresh.status, 206, 'a matching validator must resume');

    // The case that turns a resume into a corrupt file if the server plays
    // along: the client holds a prefix of something that is no longer there.
    const stale = await fetch(url('/payload.bin'), { headers: { Range: 'bytes=100-', 'If-Range': '"stale"' } });
    assert.equal(stale.status, 200, 'a stale validator must answer with the whole entity');
    assert.equal(await stale.text(), BODY);
  });

  test('a Range starting past the end is refused rather than answered with nothing', async () => {
    const res = await fetch(url('/payload.bin'), { headers: { Range: `bytes=${BODY.length + 10}-` } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), `bytes */${BODY.length}`);
  });

  test('an empty file is served as empty rather than as a read error', async () => {
    // A zero-byte file has no valid byte window, which is the shape that throws
    // if the range options are passed through unconditionally.
    const res = await fetch(url('/empty.bin'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '0');
    assert.equal(await res.text(), '');
  });
});
