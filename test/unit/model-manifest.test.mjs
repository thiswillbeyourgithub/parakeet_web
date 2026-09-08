// Tier-1 unit test for scripts/model-manifest.mjs, the writer of the file list a
// local model mirror uses to describe itself (read back by hub.js
// listLocalRepoFiles, covered in test/unit/list-local-repo-files.test.mjs).
//
// Run against a real temp tree rather than a mocked fs, because the things that
// actually go wrong here are filesystem-shaped: symlinked precision folders (how
// a maintainer's mirror is put together), a dangling link, a .git checkout with
// thousands of entries, and a read-only destination (the container mounts models
// :ro, so the manifest is written somewhere else and served from there).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles, writeManifest, writeMirrorManifests, discoverRepoRoots, MANIFEST_FILE } from '../../scripts/model-manifest.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'model-manifest-'));
const put = (dir, rel, body = 'x') => {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
};
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

describe('listFiles', () => {
  test('lists every file as a sorted repo-relative path', async () => {
    const dir = tmp();
    put(dir, 'vocab.txt');
    put(dir, 'int8/encoder-model.int8.onnx');
    put(dir, 'int8/decoder_joint-model.int8.onnx');
    assert.deepEqual(await listFiles(dir), [
      'int8/decoder_joint-model.int8.onnx',
      'int8/encoder-model.int8.onnx',
      'vocab.txt',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('descends into a nested sub-repo, which is the whole point', async () => {
    // The optimized repo carries a complete second model under
    // istupakov_smoothquant/ and keeps the lite int8 encoder there. No candidate
    // path in modelLayout.js names it, so probing can never report it and a
    // mirror of that repo cannot serve the quant. The manifest can.
    const dir = tmp();
    put(dir, 'vocab.txt');
    put(dir, 'istupakov_smoothquant/int8-lite/encoder-model.int8.lite.onnx');
    assert.ok((await listFiles(dir)).includes('istupakov_smoothquant/int8-lite/encoder-model.int8.lite.onnx'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('follows symlinked files and directories', async () => {
    // A maintainer's mirror is symlinks into the model repo's working folder, so
    // a walk that only counted real dirents would describe an empty mirror.
    const dir = tmp();
    const real = tmp();
    put(real, 'encoder-model.int8.onnx');
    put(dir, 'vocab.txt');
    symlinkSync(join(real), join(dir, 'int8'));
    symlinkSync(join(real, 'encoder-model.int8.onnx'), join(dir, 'nemo128.onnx'));
    assert.deepEqual(await listFiles(dir), [
      'int8/encoder-model.int8.onnx', 'nemo128.onnx', 'vocab.txt',
    ]);
    rmSync(dir, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  });

  test('a dangling symlink is absent rather than fatal', async () => {
    // The manifest describes what can be SERVED, and a broken link cannot be.
    // Listing it would turn a warning into a 404 mid-download.
    const dir = tmp();
    put(dir, 'vocab.txt');
    symlinkSync(join(dir, 'gone'), join(dir, 'int8'));
    assert.deepEqual(await listFiles(dir), ['vocab.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('skips .git and other bulk directories that are never model files', async () => {
    // A mirror is very often a git checkout of the model repo, and .git alone is
    // thousands of entries.
    const dir = tmp();
    put(dir, 'vocab.txt');
    put(dir, '.git/objects/ab/cdef');
    put(dir, '.cache/huggingface/blob');
    put(dir, 'node_modules/pkg/index.js');
    assert.deepEqual(await listFiles(dir), ['vocab.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('never lists a path the reader would refuse', async () => {
    // hub.js drops entries that are not plain path segments, so writing one is
    // pure noise. Same rule, applied at the source.
    const dir = tmp();
    put(dir, 'vocab.txt');
    put(dir, 'weird name.onnx');
    assert.deepEqual(await listFiles(dir), ['vocab.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing directory yields nothing rather than throwing', async () => {
    assert.deepEqual(await listFiles(join(tmpdir(), 'model-manifest-does-not-exist')), []);
  });
});

describe('writeManifest', () => {
  test('writes the list and leaves itself out of it', async () => {
    // Otherwise every regeneration would grow the previous run's manifest into
    // the next one's listing.
    const dir = tmp();
    put(dir, 'vocab.txt');
    assert.equal(await writeManifest(dir), 1);
    assert.deepEqual(read(join(dir, MANIFEST_FILE)), ['vocab.txt']);
    assert.equal(await writeManifest(dir), 1);
    assert.deepEqual(read(join(dir, MANIFEST_FILE)), ['vocab.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes to a separate destination, for a read-only mount', async () => {
    // The container mounts models :ro and serves the manifest from a writable
    // folder, so the directory described and the directory written to differ.
    const dir = tmp();
    const out = tmp();
    put(dir, 'int8/encoder-model.int8.onnx');
    assert.equal(await writeManifest(dir, out), 1);
    assert.deepEqual(read(join(out, MANIFEST_FILE)), ['int8/encoder-model.int8.onnx']);
    assert.equal(existsSync(join(dir, MANIFEST_FILE)), false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  test('an empty directory writes nothing', async () => {
    const dir = tmp();
    assert.equal(await writeManifest(dir), null);
    assert.equal(existsSync(join(dir, MANIFEST_FILE)), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an unwritable destination warns and returns null instead of throwing', async () => {
    // A mirror with no manifest costs only the probing it did before, so this
    // must never be able to fail a boot or a model fetch.
    const dir = tmp();
    const out = tmp();
    put(dir, 'vocab.txt');
    chmodSync(out, 0o500);
    assert.equal(await writeManifest(dir, out), null);
    chmodSync(out, 0o700);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

describe('writeMirrorManifests', () => {
  const REPO_A = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
  const REPO_B = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

  test('writes one manifest per repo on a shared mount', async () => {
    const dir = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    put(dir, `${REPO_A}/int8/encoder-model.int8.onnx`);
    put(dir, `${REPO_B}/vocab.txt`);
    const written = await writeMirrorManifests(dir, [REPO_A, REPO_B]);
    assert.deepEqual(written.map((w) => w.repo), [REPO_A, REPO_B]);
    assert.deepEqual(read(join(dir, REPO_A, MANIFEST_FILE)),
      ['int8/encoder-model.int8.onnx', 'vocab.txt']);
    // Paths are relative to each REPO root, not the mirror: that is the shape
    // hub.js resolves, since it asks the repo's own base for its listing.
    assert.deepEqual(read(join(dir, REPO_B, MANIFEST_FILE)), ['vocab.txt']);
    assert.equal(existsSync(join(dir, MANIFEST_FILE)), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('describes the flat single-repo layout at the mirror root', async () => {
    const dir = tmp();
    put(dir, 'vocab.txt');
    put(dir, 'int8/encoder-model.int8.onnx');
    const written = await writeMirrorManifests(dir, [REPO_A]);
    assert.equal(written.length, 1);
    assert.deepEqual(read(join(dir, MANIFEST_FILE)),
      ['int8/encoder-model.int8.onnx', 'vocab.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a shared mount never also declares a repo at its root', async () => {
    // hub.js resolves a repo to its own folder and reads only from there, so a
    // root manifest on a nested mount could only describe the wrong thing: the
    // union of every repo, attributed to whichever one asked.
    const dir = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    put(dir, 'vocab.txt');
    const written = await writeMirrorManifests(dir, [REPO_A, REPO_B]);
    assert.deepEqual(written.map((w) => w.repo), [REPO_A]);
    assert.equal(existsSync(join(dir, MANIFEST_FILE)), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a directory without vocab.txt is not a repo root and is skipped', async () => {
    // vocab.txt is the marker every supported layout keeps at the root, and the
    // same one docker/entrypoint.sh uses to decide what a mount serves.
    const dir = tmp();
    put(dir, `${REPO_A}/int8/encoder-model.int8.onnx`);
    assert.deepEqual(await writeMirrorManifests(dir, [REPO_A]), []);
    rmSync(dir, { recursive: true, force: true });
  });

  test('mirrors the repo shape into a separate writable tree', async () => {
    const dir = tmp();
    const out = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    await writeMirrorManifests(dir, [REPO_A], out);
    assert.deepEqual(read(join(out, REPO_A, MANIFEST_FILE)), ['vocab.txt']);
    assert.equal(existsSync(join(dir, REPO_A, MANIFEST_FILE)), false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

// The container and the CI fetch both know their repo list. A maintainer's
// mirror does not announce one, so the CLI finds the roots itself; without that
// the local `npm run e2e:manifest` would have to restate a list that already
// exists in three other places and would rot in this one.
describe('discoverRepoRoots', () => {
  const REPO_A = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
  const REPO_B = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

  test('finds every <owner>/<name> repo root', async () => {
    const dir = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    put(dir, `${REPO_B}/vocab.txt`);
    assert.deepEqual(await discoverRepoRoots(dir), [REPO_B, REPO_A].sort());
    rmSync(dir, { recursive: true, force: true });
  });

  test('reports the flat layout as the mirror itself', async () => {
    const dir = tmp();
    put(dir, 'vocab.txt');
    assert.deepEqual(await discoverRepoRoots(dir), ['']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('stops at a repo root instead of descending into it', async () => {
    // The optimized repo carries a whole second model with its own vocab.txt.
    // That is a directory inside a repo, not another repo on the mount, and
    // describing it separately would invent a repo id nothing asks for.
    const dir = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    put(dir, `${REPO_A}/istupakov_smoothquant/vocab.txt`);
    assert.deepEqual(await discoverRepoRoots(dir), [REPO_A]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('follows symlinked repo folders', async () => {
    // Which is exactly what fallback_models is.
    const dir = tmp();
    const real = tmp();
    put(real, 'vocab.txt');
    mkdirSync(join(dir, 'Olicorne'), { recursive: true });
    symlinkSync(real, join(dir, 'Olicorne', 'a-repo'));
    assert.deepEqual(await discoverRepoRoots(dir), ['Olicorne/a-repo']);
    rmSync(dir, { recursive: true, force: true });
    rmSync(real, { recursive: true, force: true });
  });

  test('a mirror with no weights at all reports nothing', async () => {
    const dir = tmp();
    put(dir, 'Olicorne/some-repo/int8/encoder-model.int8.onnx');
    assert.deepEqual(await discoverRepoRoots(dir), []);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the generated manifest tree is skipped, not described', async () => {
    // e2e:manifest writes into <mirror>/.manifests, which is dotted precisely so
    // it cannot be walked back into and end up describing itself.
    const dir = tmp();
    put(dir, `${REPO_A}/vocab.txt`);
    put(dir, `.manifests/${REPO_A}/vocab.txt`);
    assert.deepEqual(await discoverRepoRoots(dir), [REPO_A]);
    rmSync(dir, { recursive: true, force: true });
  });
});
