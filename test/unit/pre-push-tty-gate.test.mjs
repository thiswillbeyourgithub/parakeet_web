// Tier-1 unit test for the terminal detection in .githooks/pre-push.
//
// Regression: the hook gated the tier-3 question on `[ -e /dev/tty ]`. But
// /dev/tty is a device node that EXISTS on the filesystem whether or not the
// process has a controlling terminal, so -e (and -r, and -c) is true in both
// cases; only open(2) tells them apart, failing with ENXIO when there is none.
// So every terminal-less push fell into the ask branch, `read -r answer
// < /dev/tty` failed, `answer` stayed empty and the hook aborted:
//
//   /dev/tty: No such device or address
//   [pre-push] Unrecognised answer '' (expected y or n), push aborted.
//
// instead of taking its own documented "No terminal available; skipping tier 3"
// path. That blocked `git push` from anything without a controlling tty: CI,
// cron, an editor's git integration, an agent, `setsid`.
//
// The block is EXTRACTED from the hook rather than copied here, so this test
// cannot drift from the file it is pinning. Everything after the block (npm
// test, the UI build, Playwright) is left out: only the gate is under test.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hookPath = join(repoRoot, '.githooks', 'pre-push');
const hookSrc = readFileSync(hookPath, 'utf8');
// The hook's own comments explain the bug and quote `[ -e /dev/tty ]`, so the
// static check below has to look at code only.
const hookCode = hookSrc
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

// Slice out `run_e2e=n` .. the `fi` that closes the terminal gate, and make it
// print the choice it landed on. `set -e` matches the hook's own shell options,
// which is what makes the failed-open path worth checking (a redirection that
// fails inside `if` must not kill the script).
function extractGate() {
  const lines = hookSrc.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'run_e2e=n');
  assert.notEqual(start, -1, 'pre-push no longer initialises run_e2e=n');
  const skipLine = lines.findIndex((l, i) => i > start && l.includes('No terminal available'));
  assert.notEqual(skipLine, -1, 'pre-push no longer has a no-terminal branch');
  const end = lines.findIndex((l, i) => i > skipLine && l.trim() === 'fi');
  assert.notEqual(end, -1, 'could not find the fi closing the terminal gate');
  return `set -e\n${lines.slice(start, end + 1).join('\n')}\necho "run_e2e=$run_e2e"\n`;
}

const gateScript = join(mkdtempSync(join(tmpdir(), 'prepush-tty-')), 'gate.sh');
writeFileSync(gateScript, extractGate());

function have(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
}

describe('pre-push terminal detection', () => {
  test('gates on an open probe, not on the device node existing', () => {
    assert.ok(
      !/\[\s+-[erc]\s+\/dev\/tty\s+\]/.test(hookCode),
      'pre-push gates tier 3 on a stat test of /dev/tty; -e/-r/-c are all true without a controlling terminal',
    );
    assert.match(hookCode, /\(\s*:\s*<\s*\/dev\/tty\s*\)/, 'expected an open probe of /dev/tty');
  });

  test('with no controlling terminal: skips tier 3 instead of aborting', () => {
    // setsid drops the controlling terminal, which is exactly the state a CI or
    // cron push runs in. stdin is /dev/null, as git's is not a terminal either.
    const r = spawnSync('setsid', ['bash', gateScript], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    assert.equal(r.status, 0, `gate aborted the push: ${r.stderr}`);
    assert.match(r.stderr, /No terminal available; skipping tier 3/);
    assert.doesNotMatch(r.stderr, /Unrecognised answer/);
    assert.doesNotMatch(r.stderr, /No such device or address/);
    assert.equal(r.stdout.trim(), 'run_e2e=n');
  });

  test('with a terminal: still asks, and takes the answer', (t) => {
    if (!have('script')) return t.skip('util-linux script(1) unavailable, cannot allocate a pty');
    for (const [answer, expected] of [['y', 'y'], ['n', 'n']]) {
      const r = spawnSync('script', ['-qec', `bash ${gateScript}`, '/dev/null'], {
        input: `${answer}\n`,
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `gate failed on answer ${answer}: ${r.stdout}${r.stderr}`);
      // script(1) merges the pty's stdout and stderr, so the prompt and the
      // result both land in stdout.
      assert.match(r.stdout, /Run tier 3 \(Playwright WASM E2E/, 'the question was not asked');
      assert.match(r.stdout, new RegExp(`run_e2e=${expected}`));
    }
  });

  test('with a terminal: an unrecognised answer still aborts the push', (t) => {
    if (!have('script')) return t.skip('util-linux script(1) unavailable, cannot allocate a pty');
    const r = spawnSync('script', ['-qec', `bash ${gateScript}`, '/dev/null'], { input: 'maybe\n', encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'a bogus answer should abort');
    assert.match(r.stdout, /Unrecognised answer 'maybe'/);
  });

  test('the hook itself is syntactically valid', () => {
    execFileSync('bash', ['-n', hookPath]);
  });
});
