// Tier-1 version coupling of the self-compiled custom ORT runtime.
//
// The custom .mjs/.wasm pair is only loadable by the vendored onnxruntime-web
// JS bundle of the SAME version, and only means anything if it was built from
// the kernel patch in this repo. The previous self-compiled runtime (removed
// in 6c030bf) had a build-time version lock but nothing that compared it with
// the vendored package afterwards, so the next update-vendored.sh would have
// shipped an old binary under a newer bundle. These checks are that missing
// comparison: bump onnxruntime-web, or touch the patch, and this fails until
// `scripts/ort-custom/build.sh --install` is re-run.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ORT_VARIANTS } from '../../app/src/backend.js';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const buildInfo = Object.fromEntries(
  readFileSync(root('app/ui/vendor/ort-custom/BUILD-INFO'), 'utf8')
    .split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
// name -> sha256, from `sha256sum` output lines "<hex>  <name>".
const sums = Object.fromEntries(
  readFileSync(root('app/ui/vendor/ort-custom/SHA256SUMS'), 'utf8')
    .split('\n').filter(Boolean).map((l) => { const [h, n] = l.split(/\s+/); return [n, h]; }),
);

test('built for the vendored onnxruntime-web version', () => {
  const vendored = JSON.parse(readFileSync(root('app/ui/vendor/onnxruntime-web/package.json'), 'utf8')).version;
  assert.equal(buildInfo.ort_version, vendored,
    'the custom runtime was built for another ORT version than the vendored bundle; '
    + 'bump ORT_VERSION/ORT_COMMIT in scripts/ort-custom/build.sh and rebuild with --install');
});

test('built from the kernel patch in this repo', () => {
  assert.equal(buildInfo.patch_sha256, sha256(root('scripts/ort-custom/wasm-qnbitgemm.patch')),
    'scripts/ort-custom/wasm-qnbitgemm.patch changed since the installed runtime was built; rebuild with --install');
});

test('the shipped files are the recorded build', () => {
  for (const [name, hex] of Object.entries(sums)) {
    assert.equal(sha256(root(`app/ui/public/ort/${name}`)), hex, name);
  }
});

test('every custom variant backend.js loads is part of the recorded build', () => {
  const custom = Object.entries(ORT_VARIANTS).filter(([, v]) => v.custom);
  assert.ok(custom.length >= 2, 'expected the relaxed and plain SIMD custom variants');
  for (const [name, v] of custom) {
    assert.ok(v.assets.mjs in sums, `${name}: ${v.assets.mjs} not installed`);
    assert.ok(v.assets.wasm in sums, `${name}: ${v.assets.wasm} not installed`);
  }
});
