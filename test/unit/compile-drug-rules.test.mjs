// Tier-1 test for scripts/compile-drug-rules.mjs --check, the gate deploy.sh
// runs so the app's compiled drug rules cannot drift from the model repo.
//
// Only the failure direction is testable here (the model repo is not checked
// out in CI), and that is the one that matters: a gate that fails for the
// WRONG reason trains you to ignore it. The first version read the committed
// 1.9 MB file through execFileSync's default 1 MB buffer and so answered "not
// committed" to everything, including a genuine out-of-sync source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/compile-drug-rules.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('--check names a source that no longer matches the committed compiled rules', () => {
  const src = join(mkdtempSync(join(tmpdir(), 'drug-rules-')), 'drug_fix_rules.jsonl');
  writeFileSync(src, '{"pattern":"a","replacement":"b","variant":"a"}\n');
  const r = run('--check', '--source', src);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /OUT OF SYNC/);
  assert.doesNotMatch(r.stderr, /not committed/);
});

test('--check fails on a missing source instead of passing', () => {
  const r = run('--check', '--source', join(tmpdir(), 'no-such-drug-rules.jsonl'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /source not found/);
});
