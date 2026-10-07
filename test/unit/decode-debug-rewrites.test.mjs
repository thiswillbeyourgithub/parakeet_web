// Tier-1 test for lib/decodeDebugRewrites.js: mapping the drug/term rules'
// rewrites back onto the decoded token pills of the decode-debug view.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDrugRuleSource, loadDrugRules } from '../../app/ui/src/lib/drugRules.js';
import { tokenRewrites } from '../../app/ui/src/lib/decodeDebugRewrites.js';

const WB = '(?<![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\'-])';
const WE = '(?![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F-])';
const rules = (...pairs) => loadDrugRules(JSON.parse(JSON.stringify(compileDrugRuleSource(
  pairs.map(([variant, replacement, pattern]) => JSON.stringify({ pattern: WB + pattern + WE, replacement, variant })).join('\n'),
))));
const toks = (...pieces) => pieces.map((piece) => ({ piece }));

const LANA = rules(["l'ananas de l'umab", 'lanadelumab', "l'ananas[\\s-]+de[\\s-]+l'umab"]);

test('a multi-token mishearing maps to the run of tokens it covers', () => {
  const tokens = toks('▁Traitement', '▁par', '▁l', "'", 'an', 'anas', '▁de', '▁l', "'", 'um', 'ab', '.');
  assert.deepEqual(tokenRewrites(tokens, LANA), [
    { first: 2, last: 10, from: "l'ananas de l'umab", to: 'lanadelumab', rules: [0] },
  ]);
});

test('the word-start space of the next token is not part of the rewrite', () => {
  const tokens = toks('▁l', "'", 'ananas', '▁de', '▁l', "'", 'umab', '▁et', '▁puis');
  assert.deepEqual(tokenRewrites(tokens, LANA).map((r) => [r.first, r.last]), [[0, 6]]);
});

test('several rewrites come back in token order', () => {
  const c = rules(['myrtazapine', 'mirtazapine', 'myrtazapine'], ['tim', 'Timolol', 'tim']);
  const tokens = toks('▁tim', '▁et', '▁myr', 'ta', 'zapine');
  assert.deepEqual(tokenRewrites(tokens, c).map((r) => [r.first, r.last, r.to]), [[0, 0, 'Timolol'], [2, 4, 'mirtazapine']]);
});

test('no layer, no tokens or nothing to fix: nothing to show', () => {
  assert.deepEqual(tokenRewrites(toks('▁foo'), null), []);
  assert.deepEqual(tokenRewrites([], LANA), []);
  assert.deepEqual(tokenRewrites(toks('▁rien', '▁ici'), LANA), []);
});
