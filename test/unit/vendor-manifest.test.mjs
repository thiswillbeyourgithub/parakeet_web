// Tier-1 check that app/ui/vendor/package.json matches what is actually
// vendored, as recorded in each app/ui/vendor/*/SOURCE.md.
//
// Why this exists: the manifest is only there so Dependabot can see the
// vendored packages (CVE alerts + bump PRs). Merging a Dependabot bump PR
// changes the pin but not the vendored files, which would silence the alert
// while the old code still ships. This test fails on that PR until
// scripts/update-vendored.sh (or the manual refresh in SOURCE.md) is run.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const VENDOR_DIR = fileURLToPath(new URL('../../app/ui/vendor/', import.meta.url));

// npm packages recorded in SOURCE.md as "- Package:" / "- Version:" /
// "- Source: https://registry.npmjs.org/..." triplets, e.g.
// { 'preact': '10.29.7', '@ffmpeg/core': '0.12.10' }. Non-npm entries
// (dictation_support is git-only) are skipped.
function vendoredFromSourceMd() {
  const found = {};
  for (const entry of readdirSync(VENDOR_DIR)) {
    const src = join(VENDOR_DIR, entry, 'SOURCE.md');
    if (!existsSync(src)) continue;
    const re = /^- Package: `([^`]+)`\n- Version: `([^`]+)`\n- Source: https:\/\/registry\.npmjs\.org\//gm;
    for (const [, pkg, version] of readFileSync(src, 'utf8').matchAll(re)) {
      found[pkg] = version;
    }
  }
  return found;
}

test('vendor/package.json pins exactly the npm packages vendored, at their vendored versions', () => {
  const manifest = JSON.parse(readFileSync(join(VENDOR_DIR, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, vendoredFromSourceMd());
});
