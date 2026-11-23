// Tier-1 unit test for `_fetch` in docker/entrypoint.sh.
//
// The bug it pins, found on a real deployment: the image ships BusyBox wget,
// which does not know `--max-redirect` and exits with a usage error. `_fetch`
// tried wget first, so every container start failed to download the dictation
// CSV and served an EMPTY manifest, silently disabling dictation formatting.
// curl (also in the image) supports the no-redirect guard, so it must win.
//
// The function is extracted from the real entrypoint and run by /bin/sh with a
// PATH holding fake `wget`/`curl` binaries.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../docker/entrypoint.sh', import.meta.url)), 'utf8');

function extractFunction(name) {
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in docker/entrypoint.sh`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// BusyBox wget: rejects --max-redirect like the real one does.
const BUSYBOX_WGET = `#!/bin/sh
for a in "$@"; do case "$a" in --max-redirect*) echo "wget: unrecognized option: \${a#--}" >&2; exit 1;; esac; done
exit 0
`;
// curl: writes the body to the -o target.
const FAKE_CURL = `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { shift; echo body > "$1"; }; shift; done
`;

function runFetch(bins) {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-'));
  for (const [name, body] of Object.entries(bins)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  const out = join(dir, 'out.csv');
  const r = spawnSync('/bin/sh', ['-c', `${extractFunction('_fetch')}\n_fetch "$1" "$2"`, 'sh', out, 'https://example.org/x.csv'],
    { env: { PATH: `${dir}:/bin:/usr/bin` }, encoding: 'utf8' });
  return { status: r.status, downloaded: existsSync(out) };
}

test('BusyBox wget + curl: the fetch succeeds through curl', () => {
  const r = runFetch({ wget: BUSYBOX_WGET, curl: FAKE_CURL });
  assert.equal(r.status, 0);
  assert.equal(r.downloaded, true);
});
