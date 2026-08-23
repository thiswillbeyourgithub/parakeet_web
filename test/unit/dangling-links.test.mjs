// Tier-1 unit test for the tier-3 model dir's dangling-symlink check
// (test/e2e/dangling-links.mjs), which serve.mjs runs before it listens.
//
// Why this exists: `fallback_models/` is served flat, but a maintainer's copy of
// the ASR weights lives in a nested folder that is its own git repo, bridged by
// symlinks at the root. Renaming that folder (which happened when the model repo
// was renamed) dangles every one of them, and the harness reports it as "weights
// missing", which is the wrong problem. This pins the detector down so the
// next rename cannot go quiet again.
//
// Real symlinks in a real temp dir rather than a stubbed fs: the whole point is
// the lstat-vs-stat distinction, and a stub would just re-encode my assumption
// about it.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findDanglingLinks,
  danglingLinksMessage,
  danglingLinksWarning,
  partitionDangling,
} from '../../test/e2e/dangling-links.mjs';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dangling-links-'));

  // The shape the real model dir has: a nested "repo" holding the files, and
  // flat links at the root pointing into it.
  mkdirSync(join(root, 'Repo'), { recursive: true });
  mkdirSync(join(root, 'Repo', 'sharded'), { recursive: true });
  writeFileSync(join(root, 'Repo', 'vocab.txt'), 'x');
  writeFileSync(join(root, 'Repo', 'sharded', 'shard.000'), 'x');

  symlinkSync('Repo/vocab.txt', join(root, 'vocab.txt'));            // resolves
  symlinkSync('Repo/sharded', join(root, 'sharded'));                // dir link, resolves
  symlinkSync('Repo/gone.onnx', join(root, 'gone.onnx'));            // dangles
  symlinkSync('OldRepo/moved.onnx', join(root, 'moved.onnx'));       // dangles (renamed dir)

  // A dangling link nested one level down is still a broken checkout.
  mkdirSync(join(root, 'other'), { recursive: true });
  symlinkSync('../Repo/missing.bin', join(root, 'other', 'nested.bin'));

  // .git can hold thousands of entries and is never served; the walk skips it.
  mkdirSync(join(root, '.git'), { recursive: true });
  symlinkSync('nowhere', join(root, '.git', 'ignored.link'));
});

after(() => { rmSync(root, { recursive: true, force: true }); });

describe('findDanglingLinks', () => {
  test('reports exactly the links whose target is gone', () => {
    const found = findDanglingLinks(root).map((d) => d.path);
    assert.deepEqual(found, ['gone.onnx', 'moved.onnx', join('other', 'nested.bin')]);
  });

  test('a resolving link, including one to a directory, is not reported', () => {
    const found = findDanglingLinks(root).map((d) => d.path);
    assert.ok(!found.includes('vocab.txt'));
    assert.ok(!found.includes('sharded'));
  });

  test('skips .git so a large repo does not slow the check down', () => {
    const found = findDanglingLinks(root).map((d) => d.path);
    assert.ok(!found.some((p) => p.includes('.git')), `walked into .git: ${found}`);
  });

  test('reports the target, which is what names the cause', () => {
    const moved = findDanglingLinks(root).find((d) => d.path === 'moved.onnx');
    assert.equal(moved.target, 'OldRepo/moved.onnx');
  });

  test('a missing dir yields no findings rather than throwing', () => {
    // CI runs the harness before the weights are fetched.
    assert.deepEqual(findDanglingLinks(join(root, 'does-not-exist')), []);
    assert.deepEqual(findDanglingLinks(''), []);
  });
});

describe('partitionDangling', () => {
  test('root links and sharded/ links are the ones that break serving', () => {
    // serve.mjs looks in exactly MODEL_DIR and MODEL_DIR/sharded.
    const { served, other } = partitionDangling([
      { path: 'vocab.txt', target: 'x' },
      { path: join('sharded', 'encoder-model.onnx'), target: 'x' },
      { path: join('candidates', 'encoder-model.onnx'), target: 'x' },
      { path: join('Repo', 'sharded', 'deep.bin'), target: 'x' },
    ]);
    assert.deepEqual(served.map((d) => d.path), ['vocab.txt', join('sharded', 'encoder-model.onnx')]);
    assert.deepEqual(other.map((d) => d.path), [join('candidates', 'encoder-model.onnx'), join('Repo', 'sharded', 'deep.bin')]);
  });
});

describe('danglingLinksMessage', () => {
  test('is empty when nothing dangles, so callers can guard on it', () => {
    assert.equal(danglingLinksMessage([], root), '');
  });

  test('names the broken served links with their targets', () => {
    const msg = danglingLinksMessage(findDanglingLinks(root), root);
    assert.match(msg, /gone\.onnx -> Repo\/gone\.onnx/);
    assert.match(msg, /moved\.onnx -> OldRepo\/moved\.onnx/);
    assert.match(msg, /renamed, moved, or deleted/);
    // Relative targets are what survives a deploy rsync, so the fix-it hint
    // has to say so.
    assert.match(msg, /RELATIVE/);
  });

  test('stays empty when only unserved links dangle, so scratch dirs cannot fail a run', () => {
    const deepOnly = [{ path: join('candidates', 'stale.onnx'), target: '../gone.onnx' }];
    assert.equal(danglingLinksMessage(deepOnly, root), '');
    assert.match(danglingLinksWarning(deepOnly, root), /candidates\/stale\.onnx -> \.\.\/gone\.onnx/);
    assert.match(danglingLinksWarning(deepOnly, root), /Not fatal/);
  });

  test('the deep link in the fixture warns rather than fails', () => {
    const found = findDanglingLinks(root);
    assert.ok(!danglingLinksMessage(found, root).includes('nested.bin'));
    assert.match(danglingLinksWarning(found, root), /nested\.bin/);
  });

  test('no warning when nothing deep dangles', () => {
    assert.equal(danglingLinksWarning([{ path: 'vocab.txt', target: 'x' }], root), '');
  });
});
