// Unit tests for postbuild.mjs's git-lfs pointer detection: a clone WITHOUT
// git-lfs checks out ~130-byte pointer text in place of the relaxed-SIMD ORT
// wasm (tracked via .gitattributes), and manifesting that pointer would make
// the app engage a broken runtime; isLfsPointer is what keeps the ort-relaxed
// manifest honest. Importing postbuild.mjs must NOT run a build (main() is
// guarded on argv), which this test proves by importing it at all.
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLfsPointer } from '../../app/ui/postbuild.mjs';

const POINTER = Buffer.from(
  'version https://git-lfs.github.com/spec/v1\n'
  + 'oid sha256:eb40df8e2886aa41744b864e0d90d539941ff39c363aff1476ec49261e0fe837\n'
  + 'size 33025562\n', 'utf8');

test('detects a real git-lfs pointer file', () => {
  assert.equal(isLfsPointer(POINTER), true);
});

test('never flags real artifacts', () => {
  // wasm magic
  assert.equal(isLfsPointer(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])), false);
  // a JS module
  assert.equal(isLfsPointer(Buffer.from('export default function ortWasmThreaded() {}', 'utf8')), false);
  // text that merely mentions the URL later on
  assert.equal(isLfsPointer(Buffer.from('// see version https://git-lfs.github.com/spec/', 'utf8')), false);
  // empty and tiny buffers
  assert.equal(isLfsPointer(Buffer.alloc(0)), false);
  assert.equal(isLfsPointer(Buffer.from('version', 'utf8')), false);
});
