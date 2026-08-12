// PARAKEET_E2E_DIST_DIR must swap the app build test/e2e/serve.mjs serves.
// A/B harnesses rely on it to serve two builds side by side (ORT-version A/B,
// current-vs-deployed-tip A/B), so a silently ignored override would make an
// A/B compare one build against itself and report a bogus null result.
//
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const SERVE = join(ROOT, 'test/e2e/serve.mjs');

test('serve.mjs serves the dist dir named by PARAKEET_E2E_DIST_DIR', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'serve-dist-override-'));
  const marker = `dist-override-probe-${process.pid}`;
  await writeFile(join(dist, 'index.html'), `<!doctype html><title>${marker}</title>`);
  await writeFile(join(dist, 'probe.js'), `// ${marker}\n`);

  // An uncommon fixed port; the e2e suite's own server uses 4178.
  const port = 4187;
  const proc = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), PARAKEET_E2E_DIST_DIR: dist },
    stdio: 'ignore',
  });
  try {
    let index = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.ok) { index = await res.text(); break; }
      } catch { /* server not up yet */ }
      await sleep(100);
    }
    assert.ok(index !== null, 'server never came up');
    assert.ok(index.includes(marker), 'index.html must come from the overridden dist dir');

    // A non-index asset resolves against the same override, and the SPA
    // fallback for an unknown route serves the overridden index too.
    const asset = await (await fetch(`http://127.0.0.1:${port}/probe.js`)).text();
    assert.ok(asset.includes(marker), 'assets must come from the overridden dist dir');
    const fallback = await (await fetch(`http://127.0.0.1:${port}/no-such-route`)).text();
    assert.ok(fallback.includes(marker), 'SPA fallback must serve the overridden index.html');
  } finally {
    proc.kill('SIGTERM');
    await rm(dist, { recursive: true, force: true });
  }
});
