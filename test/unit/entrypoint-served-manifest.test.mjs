// Tier-1 unit test for `_write_served_manifest` in docker/entrypoint.sh: the
// listing the browser reads to discover which operator-supplied files an
// instance actually serves (boost phrase lists, dictation regex CSVs).
//
// The bug it pins, reported from a real deployment: every visitor's console
// collected a 404 for `<list>.json`. That file is the OPTIONAL prebuilt token
// encoding, written by docker/prebuild-boost.mjs only when the container has a
// model vocab to compile against, and the app asked for it unconditionally
// because the manifest only ever named the `.txt` sources. A 404 that is the
// normal case is worse than useless: it is how a console stops being somewhere
// anyone looks for the real error.
//
// So the manifest has to be able to name several extensions, and be rewritten
// AFTER the prebuild rather than only before it. Two properties below are the
// ones that break silently if this is ever rewritten: manifest.txt matching the
// very `*.txt` glob that builds it (so it must be kept out of its own listing,
// including on the second pass, or the app offers a phantom list named
// "manifest"), and the listing surviving being rebuilt in place.
//
// The function is extracted from the real entrypoint and executed by /bin/sh,
// so this tests the shipped code rather than a transcription of it.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = fileURLToPath(new URL('../../docker/entrypoint.sh', import.meta.url));
const src = readFileSync(ENTRYPOINT, 'utf8');

/**
 * Pull a shell function out of the script by brace matching from its
 * definition line. Fails loudly if it is renamed, which is deliberate: a
 * rename that loses the manifest rules should not quietly stop being tested.
 */
function extractFunction(name) {
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in docker/entrypoint.sh`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const PRELUDE = extractFunction('_write_served_manifest');

/** Make a temp directory holding `files` (name -> contents). */
function seedDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'served-manifest-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/** Run the shipped writer over `dir` for `exts`, then read the manifest back. */
function writeManifest(dir, exts) {
  const script = `${PRELUDE}\n_write_served_manifest "$@"\n`;
  execFileSync('/bin/sh', ['-c', script, 'sh', dir, ...exts], { encoding: 'utf8' });
  const path = join(dir, 'manifest.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

describe('entrypoint _write_served_manifest', () => {
  test('lists one extension, basenames only', () => {
    // The app resolves each entry against /boost-phrases/, so an absolute
    // container path in here would 404 for every visitor.
    const dir = seedDir({ 'a.txt': 'x', 'b.txt': 'y' });
    assert.deepEqual(writeManifest(dir, ['txt']).sort(), ['a.txt', 'b.txt']);
  });

  test('lists several extensions together', () => {
    // The whole point: the prebuilt .json has to be discoverable, otherwise the
    // app cannot tell "no prebuild here" from "prebuild I have not asked for".
    const dir = seedDir({ 'a.txt': 'x', 'a.json': '[]', 'b.txt': 'y' });
    assert.deepEqual(writeManifest(dir, ['txt', 'json']).sort(), ['a.json', 'a.txt', 'b.txt']);
  });

  test('a list with no prebuilt sibling is still listed, alone', () => {
    // The pure-HuggingFace deployment: no local vocab, so no .json exists and
    // none may be announced, or the app is back to fetching a phantom.
    const dir = seedDir({ 'a.txt': 'x' });
    assert.deepEqual(writeManifest(dir, ['txt', 'json']), ['a.txt']);
  });

  test('the manifest never lists itself, even when rebuilt in place', () => {
    // manifest.txt matches the *.txt glob that builds it. The boost directory
    // is listed TWICE (before and after the prebuild), so by the second pass
    // the file exists; naming itself would offer visitors a phrase list called
    // "manifest" whose contents are the list of files.
    const dir = seedDir({ 'a.txt': 'x' });
    assert.deepEqual(writeManifest(dir, ['txt']), ['a.txt']);
    assert.ok(existsSync(join(dir, 'manifest.txt')));
    assert.deepEqual(writeManifest(dir, ['txt', 'json']), ['a.txt']);
  });

  test('rebuilding after a prebuild adds the new artifacts without losing the old entries', () => {
    // The real boot sequence: list the .txt, run the prebuild, list again.
    const dir = seedDir({ 'a.txt': 'x', 'b.txt': 'y' });
    assert.deepEqual(writeManifest(dir, ['txt']).sort(), ['a.txt', 'b.txt']);
    writeFileSync(join(dir, 'a.json'), '[]');
    writeFileSync(join(dir, 'b.json'), '[]');
    assert.deepEqual(writeManifest(dir, ['txt', 'json']).sort(),
      ['a.json', 'a.txt', 'b.json', 'b.txt']);
  });

  test('an extension with no matches contributes nothing rather than a literal glob', () => {
    // An unexpanded `*.json` in the manifest would be requested verbatim.
    const dir = seedDir({ 'a.csv': 'x' });
    assert.deepEqual(writeManifest(dir, ['csv', 'json']), ['a.csv']);
  });

  test('an empty directory yields an empty manifest, not a missing one', () => {
    // The app distinguishes "served no lists" from "manifest unreachable"; the
    // second makes it retry and warn.
    const dir = seedDir({});
    assert.deepEqual(writeManifest(dir, ['txt', 'json']), []);
  });

  test('directories matching the glob are skipped', () => {
    // Only files are served; a directory named like a list would be announced
    // and then fail to fetch.
    const dir = seedDir({ 'a.txt': 'x' });
    execFileSync('/bin/sh', ['-c', 'mkdir "$1/nested.txt"', 'sh', dir]);
    assert.deepEqual(writeManifest(dir, ['txt']), ['a.txt']);
  });

  test('the temp file it builds through is not left behind', () => {
    // It is a dot-file, so it escapes the *.txt glob, but it would still be
    // served to anyone who guessed the name.
    const dir = seedDir({ 'a.txt': 'x' });
    writeManifest(dir, ['txt', 'json']);
    assert.deepEqual(readdirSync(dir).sort(), ['a.txt', 'manifest.txt']);
  });
});
