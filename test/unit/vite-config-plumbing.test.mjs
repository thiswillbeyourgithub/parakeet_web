// Tier-1 plumbing gate for the browser app's runtime config: every VITE_* key
// app/ui/src/config.js reads must be (1) copied into /config.js by
// docker/entrypoint.sh, (2) passed into the container by docker/docker-compose.yml
// (a value in .env alone never reaches it) and (3) documented in
// docker/env.example. And the reverse: a VITE_DIARIZATION_* key read in
// lib/diarizationModels.js must exist in config.js, which is how
// VITE_DIARIZATION_REPO once shipped as a dead override (read, never defined).
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const configJs = read('app/ui/src/config.js');
const KEYS = [...new Set([...configJs.matchAll(/^\s*(VITE_[A-Z0-9_]+):/gm)].map((m) => m[1]))];
// Derived by the entrypoint from BENCHMARK_REPORTS_DIR, never set by an operator.
const DERIVED = new Set(['VITE_BENCHMARK_UPLOAD']);

test('config.js exposes keys (the parser found them)', () => {
  assert.ok(KEYS.length > 5, `only found ${KEYS.join(', ')}`);
});

test('every config.js key is exported by the entrypoint', () => {
  const ent = read('docker/entrypoint.sh');
  const missing = KEYS.filter((k) => !ent.includes(`"${k}"`));
  assert.deepEqual(missing, []);
});

test('every operator-set config.js key reaches the container and is documented', () => {
  const compose = read('docker/docker-compose.yml');
  const example = read('docker/env.example');
  const keys = KEYS.filter((k) => !DERIVED.has(k));
  assert.deepEqual(keys.filter((k) => !new RegExp(`-\\s*${k}=`).test(compose)), [], 'not in compose environment:');
  assert.deepEqual(keys.filter((k) => !example.includes(k)), [], 'not in env.example');
});

test('every CONFIG key a module reads is defined in config.js', () => {
  for (const file of ['app/ui/src/lib/diarizationModels.js']) {
    const used = [...read(file).matchAll(/CONFIG\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1]);
    assert.ok(used.length, `${file} reads no CONFIG keys: the pattern is stale`);
    assert.deepEqual(used.filter((k) => !KEYS.includes(k)), [], `${file} reads undefined keys`);
  }
});
