// Tier-1 gate on the per-version release notes (app/ui/src/lib/changelog.js)
// and on the notes themselves (app/ui/changelog/<version>/{en,fr}.md).
//
// The content checks matter as much as the parser ones: the popup can only be
// as right as the files, and every way they go wrong is silent in the app (a
// missing fr.md shows English to a French visitor, a release with no folder
// shows nothing after the update it describes).
//
// Written with the help of Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions, releasesToShow, sortVersionsDesc, parseInline, parseChangelogMd,
} from '../../app/ui/src/lib/changelog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = resolve(ROOT, 'app/ui/changelog');
const APP_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'app/package.json'), 'utf-8')).version;

test('compareVersions is numeric, not lexical', () => {
  assert.ok(compareVersions('10.0.0', '9.9.0') > 0);
  assert.ok(compareVersions('11.3.10', '11.3.9') > 0);
  assert.equal(compareVersions('12.0.0', '12.0.0'), 0);
  assert.throws(() => compareVersions('12.0', '12.0.0'), /major\.minor\.patch/);
});

test('releasesToShow picks (stored, current], newest first', () => {
  const v = ['10.0.0', '11.0.0', '11.3.3', '12.0.0', '13.0.0', '14.0.0'];
  // 14.0.0 is a folder written ahead of the bump: not released yet, not shown.
  assert.deepEqual(releasesToShow(v, '11.0.0', '13.0.0'), ['13.0.0', '12.0.0', '11.3.3']);
  assert.deepEqual(releasesToShow(v, '12.0.0', '13.0.0'), ['13.0.0']);
});

test('releasesToShow shows nothing to a first visit, a same-version reload or a downgrade', () => {
  const v = ['12.0.0', '13.0.0'];
  assert.deepEqual(releasesToShow(v, null, '13.0.0'), []);
  assert.deepEqual(releasesToShow(v, undefined, '13.0.0'), []);
  assert.deepEqual(releasesToShow(v, '13.0.0', '13.0.0'), []);
  assert.deepEqual(releasesToShow(v, '14.0.0', '13.0.0'), []);
  // A corrupt stored value must not throw during boot.
  assert.deepEqual(releasesToShow(v, 'garbage', '13.0.0'), []);
});

test('sortVersionsDesc', () => {
  assert.deepEqual(sortVersionsDesc(['9.0.0', '11.0.0', '10.2.0']), ['11.0.0', '10.2.0', '9.0.0']);
});

test('parseInline: code, bold with nested code, italic, links, literal leftovers', () => {
  assert.deepEqual(parseInline('a `x*y` b'), [
    { type: 'text', text: 'a ' }, { type: 'code', text: 'x*y' }, { type: 'text', text: ' b' },
  ]);
  assert.deepEqual(parseInline('**`f` is fast**'), [
    { type: 'strong', children: [{ type: 'code', text: 'f' }, { type: 'text', text: ' is fast' }] },
  ]);
  assert.deepEqual(parseInline('*it* and _it_'), [
    { type: 'em', children: [{ type: 'text', text: 'it' }] },
    { type: 'text', text: ' and ' },
    { type: 'em', children: [{ type: 'text', text: 'it' }] },
  ]);
  assert.deepEqual(parseInline('[`repo`](https://x.org/a_b)'), [
    { type: 'link', href: 'https://x.org/a_b', children: [{ type: 'code', text: 'repo' }] },
  ]);
  // snake_case outside code, a lone star and an unclosed bracket stay text.
  assert.deepEqual(parseInline('snake_case_name 2 * 3 [x'), [{ type: 'text', text: 'snake_case_name 2 * 3 [x' }]);
});

test('parseChangelogMd: blocks and title validation', () => {
  const md = [
    '# 13.0.0 (2026-11-23)',
    '',
    'Intro line one',
    'continues here.',
    '',
    '## Added',
    '',
    '- first item',
    '  wraps on.',
    '- second',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | **2** |',
  ].join('\n');
  const r = parseChangelogMd(md, '13.0.0');
  assert.equal(r.version, '13.0.0');
  assert.equal(r.date, '2026-11-23');
  assert.deepEqual(r.blocks.map((b) => b.type), ['p', 'h', 'ul', 'table']);
  assert.deepEqual(r.blocks[0].children, [{ type: 'text', text: 'Intro line one continues here.' }]);
  assert.equal(r.blocks[1].level, 2);
  assert.deepEqual(r.blocks[2].items, [[{ type: 'text', text: 'first item wraps on.' }], [{ type: 'text', text: 'second' }]]);
  assert.deepEqual(r.blocks[3].header, [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]]);
  assert.deepEqual(r.blocks[3].rows, [[[{ type: 'text', text: '1' }], [{ type: 'strong', children: [{ type: 'text', text: '2' }] }]]]);

  assert.throws(() => parseChangelogMd(md, '12.0.0'), /title says 13\.0\.0, folder says 12\.0\.0/);
  assert.throws(() => parseChangelogMd('# 13.0.0\n', '13.0.0'), /first line must be/);
});

// ---- the shipped notes ----

const versions = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test('every changelog folder is a version holding en.md and fr.md that parse', () => {
  assert.ok(versions.length > 0);
  for (const v of versions) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `folder ${v} is not a version`);
    for (const lang of ['en', 'fr']) {
      const p = resolve(DIR, v, `${lang}.md`);
      assert.ok(existsSync(p), `missing ${v}/${lang}.md`);
      parseChangelogMd(readFileSync(p, 'utf-8'), v);
    }
  }
});

test('en and fr notes of each release have the same date and the same section structure', () => {
  for (const v of versions) {
    const en = parseChangelogMd(readFileSync(resolve(DIR, v, 'en.md'), 'utf-8'), v);
    const fr = parseChangelogMd(readFileSync(resolve(DIR, v, 'fr.md'), 'utf-8'), v);
    assert.equal(fr.date, en.date, `${v}: en and fr dates differ`);
    const shape = (r) => r.blocks.filter((b) => b.type === 'h' || b.type === 'table').map((b) => `${b.type}${b.level || ''}`);
    assert.deepEqual(shape(fr), shape(en), `${v}: en and fr have different headings/tables, one was edited without the other`);
  }
});

test('the current app version has release notes', () => {
  assert.ok(versions.includes(APP_VERSION),
    `app/package.json is ${APP_VERSION} but app/ui/changelog/${APP_VERSION}/ does not exist`);
});
