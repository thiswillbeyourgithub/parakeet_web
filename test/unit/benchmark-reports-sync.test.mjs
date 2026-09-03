// Tier-1 test for benchmark_reports/sync.sh, the operator's two-way sync of
// collected benchmark reports with the VPS. It runs the real script with a
// local folder standing in for the VPS (SYNC_LOCAL_REMOTE) so the property
// that matters, "a sync can never lose or overwrite a report", is exercised
// end to end: the result must be the union of both sides, a name present on
// both sides keeps ITS OWN bytes on each side, nothing but top-level
// report-*.json moves, and a dry run changes nothing.
//
// Self-skips when rsync or bash is missing. Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'benchmark_reports', 'sync.sh');
const haveTools = ['rsync', 'bash'].every((t) => spawnSync('which', [t]).status === 0);

const A = 'report-2026-01-01T00-00-00-000Z-aaaaaaaa.json';
const B = 'report-2026-01-02T00-00-00-000Z-bbbbbbbb.json';
const C = 'report-2026-01-03T00-00-00-000Z-cccccccc.json';
const D = 'report-2026-01-04T00-00-00-000Z-dddddddd.json';

async function seed() {
  const root = await mkdtemp(join(tmpdir(), 'bench-sync-'));
  const local = join(root, 'local');
  const remote = join(root, 'remote');
  await mkdir(join(local, 'subdir'), { recursive: true });
  await mkdir(remote, { recursive: true });
  await copyFile(SCRIPT, join(local, 'sync.sh'));
  await chmod(join(local, 'sync.sh'), 0o755);
  await writeFile(join(local, A), '{"side":"A"}');
  await writeFile(join(local, B), '{"side":"B-local"}');
  await writeFile(join(local, 'notes.txt'), 'local notes');
  await writeFile(join(local, 'subdir', D), '{"side":"D-nested"}');
  await writeFile(join(remote, B), '{"side":"B-remote"}');
  await writeFile(join(remote, C), '{"side":"C"}');
  await writeFile(join(remote, 'remote-notes.txt'), 'remote notes');
  return { root, local, remote };
}

function run(local, remote, args = []) {
  return spawnSync('bash', [join(local, 'sync.sh'), ...args], {
    env: { ...process.env, SYNC_LOCAL_REMOTE: remote },
    encoding: 'utf-8',
  });
}

const sorted = async (dir) => (await readdir(dir)).sort();

describe('benchmark_reports/sync.sh', { skip: !haveTools && 'rsync or bash not installed' }, () => {
  let dirs;
  before(async () => { dirs = await seed(); });
  after(async () => { await rm(dirs.root, { recursive: true, force: true }); });

  test('a dry run reports and changes nothing on either side', async () => {
    const r = run(dirs.local, dirs.remote, ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Dry run: nothing was changed/);
    assert.deepEqual(await sorted(dirs.local), ['notes.txt', A, B, 'subdir', 'sync.sh'].sort());
    assert.deepEqual(await sorted(dirs.remote), [B, C, 'remote-notes.txt'].sort());
  });

  test('a sync is the union of both sides and never overwrites a report', async () => {
    const r = run(dirs.local, dirs.remote);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Pulled 1, pushed 1\./);
    // Union of reports, top level only, nothing else crosses.
    assert.deepEqual(await sorted(dirs.local), ['notes.txt', A, B, C, 'subdir', 'sync.sh'].sort());
    assert.deepEqual(await sorted(dirs.remote), [A, B, C, 'remote-notes.txt'].sort());
    // The name present on both sides kept its own bytes on each side.
    assert.equal(await readFile(join(dirs.local, B), 'utf-8'), '{"side":"B-local"}');
    assert.equal(await readFile(join(dirs.remote, B), 'utf-8'), '{"side":"B-remote"}');
    assert.equal(await readFile(join(dirs.remote, A), 'utf-8'), '{"side":"A"}');
    assert.equal(await readFile(join(dirs.local, C), 'utf-8'), '{"side":"C"}');
    assert.deepEqual(await sorted(join(dirs.local, 'subdir')), [D]);
  });

  test('a second sync is a no-op', async () => {
    const r = run(dirs.local, dirs.remote);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Pulled 0, pushed 0\./);
  });

  test('an unknown argument is refused before anything runs', async () => {
    const r = run(dirs.local, dirs.remote, ['--delete']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  });
});
