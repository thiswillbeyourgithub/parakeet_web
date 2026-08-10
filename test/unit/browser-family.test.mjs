// Unit tests for the engine-family gate behind the slow-browser popup
// (app/ui/src/lib/browserFamily.js): Chromium derivatives must never be
// nagged, Firefox/Safari must be, and anything unknowable resolves to
// "Chromium" so the popup cannot fire spuriously.
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChromiumFamily } from '../../app/ui/src/lib/browserFamily.js';

const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const EDGE_UA = CHROME_UA + ' Edg/148.0.0.0';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

test('client-hints brands decide when present', () => {
  const brands = (list) => ({ userAgentData: { brands: list.map((b) => ({ brand: b, version: '148' })) } });
  // Chrome, Brave, Edge all carry a Chromium brand entry.
  assert.equal(isChromiumFamily(brands(['Chromium', 'Google Chrome', 'Not=A?Brand'])), true);
  assert.equal(isChromiumFamily(brands(['Brave', 'Chromium', 'Not=A?Brand'])), true);
  assert.equal(isChromiumFamily(brands(['Microsoft Edge', 'Chromium', 'Not=A?Brand'])), true);
  // A hypothetical non-Chromium engine that implements client hints.
  assert.equal(isChromiumFamily({ ...brands(['SomeEngine', 'Not=A?Brand']), userAgent: FIREFOX_UA }), false);
});

test('UA fallback when client hints are absent', () => {
  assert.equal(isChromiumFamily({ userAgent: CHROME_UA }), true);
  assert.equal(isChromiumFamily({ userAgent: EDGE_UA }), true);
  assert.equal(isChromiumFamily({ userAgent: FIREFOX_UA }), false);
  assert.equal(isChromiumFamily({ userAgent: SAFARI_UA }), false);
});

test('unknowable environments never nag', () => {
  assert.equal(isChromiumFamily(undefined), true);
  assert.equal(isChromiumFamily(null), true);
  assert.equal(isChromiumFamily({}), true);
  assert.equal(isChromiumFamily({ userAgent: '' }), true);
  assert.equal(isChromiumFamily({ userAgentData: { brands: [] }, userAgent: CHROME_UA }), true);
  // Hostile getter must not throw through.
  const hostile = {};
  Object.defineProperty(hostile, 'userAgentData', { get() { throw new Error('boom'); } });
  assert.equal(isChromiumFamily(hostile), true);
});
