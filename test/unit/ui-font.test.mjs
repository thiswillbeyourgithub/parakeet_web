// Tier-1 gate on the vendored UI font (Atkinson Hyperlegible Next).
//
// Every way this breaks is silent in the app: a typo in the family name, a
// url() pointing at a missing file, or a dropped import just falls through
// to the system font stack with no console error a test would notice. So
// the wiring is checked statically here, and the bytes against SOURCE.md.
//
// Written with the help of Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UI = join(ROOT, 'app/ui');
const FONT_DIR = join(UI, 'vendor/atkinson-hyperlegible-next');
const FAMILY = 'Atkinson Hyperlegible Next Variable';
const read = (p) => readFileSync(p, 'utf8');

test('fonts.css declares the family and every url() resolves to a vendored file', () => {
  const css = read(join(FONT_DIR, 'fonts.css'));
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  assert.equal(faces.length, 4, 'latin + latin-ext, normal + italic');
  for (const face of faces) {
    assert.ok(face.includes(`font-family: '${FAMILY}'`), face);
    const [, url] = face.match(/url\(([^)]+)\)/);
    assert.ok(existsSync(join(FONT_DIR, url)), `missing font file ${url}`);
  }
});

test('SOURCE.md hashes match the vendored bytes', () => {
  const rows = [...read(join(FONT_DIR, 'SOURCE.md')).matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.equal(rows.length, 5, '4 woff2 + LICENSE');
  for (const [, file, sha] of rows) {
    const actual = createHash('sha256').update(readFileSync(join(FONT_DIR, file))).digest('hex');
    assert.equal(actual, sha, file);
  }
});

test('both pages import the font and name it first in their font stacks', () => {
  for (const entry of ['src/App.jsx', 'src/remote-mic-entry.jsx']) {
    assert.match(read(join(UI, entry)), /import '\.\.\/vendor\/atkinson-hyperlegible-next\/fonts\.css';/, entry);
  }
  // App.css drives the main app; the inline <style> in each HTML covers the
  // pre-hydration paint (and is the whole stylesheet of the remote-mic page).
  assert.match(read(join(UI, 'src/App.css')), new RegExp(`--font:\\s*'${FAMILY}',`));
  for (const html of ['index.html', 'remote-mic.html']) {
    assert.match(read(join(UI, html)), new RegExp(`font-family: '${FAMILY}',`), html);
  }
});

test('form controls inherit the font instead of using the browser default', () => {
  // Buttons and inputs do not inherit font-family on their own: without this
  // rule the Load Model button kept the browser font next to Atkinson text.
  const rule = /button, input, select, textarea\s*{\s*font-family: inherit;\s*}/;
  assert.match(read(join(UI, 'src/App.css')), rule);
  assert.match(read(join(UI, 'remote-mic.html')), rule);
});
