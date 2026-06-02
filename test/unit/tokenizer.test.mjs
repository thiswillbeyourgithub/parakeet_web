// Tier-1 unit test for the Parakeet tokenizer parser + decoder
// (app/src/tokenizer.js). Covers vocab parsing, the SentencePiece ▁->space
// rule, blank/<unk> skipping, and the punctuation-cleanup pass.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseVocabText, ParakeetTokenizer } from '../../app/src/tokenizer.js';

// A tiny SentencePiece-style vocab. `▁` (U+2581) marks a leading space.
const VOCAB = [
  '<unk> 0',
  '▁hello 1',
  '▁world 2',
  ', 3',
  '▁Dr 4',
  '. 5',
  '<blk> 6',
  '▁a 7',
  'b 8',
].join('\n');

describe('parseVocabText', () => {
  test('builds an id-indexed array', () => {
    const id2token = parseVocabText(VOCAB);
    assert.equal(id2token[1], '▁hello');
    assert.equal(id2token[6], '<blk>');
    assert.equal(id2token.length, 9);
  });
  test('skips blank and malformed lines', () => {
    const id2token = parseVocabText('▁ok 0\n\ngarbage-no-id\n▁two 1');
    assert.equal(id2token[0], '▁ok');
    assert.equal(id2token[1], '▁two');
    assert.equal(id2token.length, 2);
  });
  test('honours CRLF line endings', () => {
    const id2token = parseVocabText('▁x 0\r\n<blk> 1\r\n');
    assert.equal(id2token[1], '<blk>');
  });
});

describe('ParakeetTokenizer', () => {
  const tok = new ParakeetTokenizer(parseVocabText(VOCAB));

  test('discovers the blank id dynamically', () => assert.equal(tok.blankId, 6));
  test('throws loudly when <blk> is missing', () => {
    assert.throws(() => new ParakeetTokenizer(parseVocabText('▁x 0\n▁y 1')), /Blank token <blk> not found/);
  });

  test('decodes ▁ as a leading space and trims', () => {
    // ids: ▁hello ▁world -> " hello world" -> trimmed "hello world"
    assert.equal(tok.decode([1, 2]), 'hello world');
  });
  test('skips blank tokens mid-stream', () => {
    assert.equal(tok.decode([1, 6, 2]), 'hello world');
  });
  test('skips <unk> tokens', () => {
    assert.equal(tok.decode([1, 0, 2]), 'hello world');
  });
  test('removes the space before sentence punctuation', () => {
    // ▁Dr . -> "Dr ." cleaned to "Dr."
    assert.equal(tok.decode([4, 5]), 'Dr.');
  });
  test('collapses repeated sentence punctuation', () => {
    // ▁hello . . . -> "hello ..." -> "hello."
    assert.equal(tok.decode([1, 5, 5, 5]), 'hello.');
  });
  test('ignores out-of-range ids', () => {
    assert.equal(tok.decode([1, 9999, 2]), 'hello world');
  });
  test('empty input decodes to empty string', () => assert.equal(tok.decode([]), ''));
});
