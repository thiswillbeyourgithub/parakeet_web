// Tier-1 cover for the `**bold**` splitter the encoder-precision radios use.
//
// The labels come from i18n, so they are translator-editable text rendered as
// markup. The two failure modes worth pinning are therefore both about a typo
// in a translation rather than about a caller: an unclosed marker must not
// emphasise the rest of the label, and a string with no markers at all must
// come back as one plain run (every other label in the list is exactly that).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { boldRuns } from '../../app/ui/src/lib/format.js';

describe('boldRuns', () => {
  test('splits a marked word out of the surrounding text', () => {
    assert.deepEqual(boldRuns('int8 (~900MB, **recommended**)'), [
      { text: 'int8 (~900MB, ', bold: false },
      { text: 'recommended', bold: true },
      { text: ')', bold: false },
    ]);
  });

  test('an unmarked string is a single plain run', () => {
    assert.deepEqual(boldRuns('fp32 (~2.4GB, reference quality)'), [
      { text: 'fp32 (~2.4GB, reference quality)', bold: false },
    ]);
  });

  test('an unclosed marker stays literal instead of bolding the tail', () => {
    assert.deepEqual(boldRuns('int8 (**recommended)'), [
      { text: 'int8 (', bold: false },
      { text: '**recommended)', bold: false },
    ]);
  });

  test('handles a marker at either end without emitting empty runs', () => {
    assert.deepEqual(boldRuns('**yes** no'), [
      { text: 'yes', bold: true },
      { text: ' no', bold: false },
    ]);
    assert.deepEqual(boldRuns('no **yes**'), [
      { text: 'no ', bold: false },
      { text: 'yes', bold: true },
    ]);
  });

  test('empty and nullish inputs are empty, not a crash', () => {
    assert.deepEqual(boldRuns(''), []);
    assert.deepEqual(boldRuns(null), []);
    assert.deepEqual(boldRuns(undefined), []);
  });
});
