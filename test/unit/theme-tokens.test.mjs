// Tier-1 unit test for the design-token contract between App.css and the
// components that reference its custom properties from inline styles.
//
// The bug it pins: three sibling hint panels in App.jsx were styled with
// `var(--surface-muted, #f9fafb)`, and --surface-muted is defined in no
// stylesheet. The fallback therefore always won, so the panel stayed near-white
// on every theme, and two of the three then set `color: var(--text-muted)`,
// which IS defined in dark mode, as #c4c8de: about 1.4:1 against the fallback,
// i.e. invisible. Nothing failed, because a var() fallback is exactly the
// mechanism that makes a missing token silent.
//
// A var() fallback is a legitimate tool, but not for a token this app owns: if
// the name is one of ours, it has to exist. This test asserts that, plus the
// mirror-image mistake of a token that only exists inside the dark-mode block
// (which would leave light mode on nothing at all).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../app/ui/src/', import.meta.url).pathname;

const cssFiles = readdirSync(SRC).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n');

// Every file that can reference a token: the stylesheets themselves plus the
// components, which set custom properties from inline style objects.
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(css|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const DEFINED = new Set([...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));

// The dark-mode overrides, so a token defined ONLY there can be spotted.
const darkBlock = (() => {
  const at = css.indexOf('@media (prefers-color-scheme: dark)');
  if (at < 0) return '';
  // Walk the braces so the whole at-rule is captured and nothing after it is.
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  return css.slice(at);
})();
const DARK_ONLY = new Set([...darkBlock.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
const LIGHT = new Set([...DEFINED].filter((t) => !DARK_ONLY.has(t) || css.split(darkBlock).join('').includes(`${t}:`)));

describe('design tokens', () => {
  test('every var(--token) the app references is actually defined', () => {
    const missing = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        if (!DEFINED.has(m[1])) missing.push(`${file.slice(SRC.length)}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], 'tokens referenced but never defined (a var() fallback hides this at runtime)');
  });

  test('no token exists only in the dark-mode block', () => {
    // The dark block OVERRIDES :root, it does not extend it, so a token that
    // appears nowhere else resolves to nothing in light mode.
    const darkOnly = [...DARK_ONLY].filter((t) => !LIGHT.has(t));
    assert.deepEqual(darkOnly, [], 'tokens defined only under prefers-color-scheme: dark');
  });

  test('the tokens the boost hint panel needs are themed on both sides', () => {
    // The panel that carried the bug. Each of these has to have a dark-mode
    // value, or the fix just moves the unreadable combination somewhere else.
    for (const token of ['--bg-subtle', '--border-strong', '--text-muted', '--warning-soft-text']) {
      assert.ok(LIGHT.has(token), `${token} must have a light value`);
      assert.ok(DARK_ONLY.has(token), `${token} must have a dark-mode override`);
    }
  });
});
