// Tier-1 unit test for the pure diarization<->transcript merge helpers
// (app/ui/src/lib/speakerAssign.js). Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assignSpeakersToWords, groupWordsIntoTurns, speakerCount, turnsToLabeledText } from '../../app/ui/src/lib/speakerAssign.js';

const W = (text, s, e) => ({ text, start_time: s, end_time: e });

describe('assignSpeakersToWords', () => {
  const segments = [
    { start: 0, end: 2, speaker: 0 },
    { start: 2, end: 4, speaker: 1 },
  ];

  test('assigns by max overlap', () => {
    const words = [W('hello', 0.1, 0.6), W('there', 2.2, 2.9)];
    const out = assignSpeakersToWords(words, segments);
    assert.equal(out[0].speaker, 0);
    assert.equal(out[1].speaker, 1);
  });

  test('a word straddling a boundary goes to the larger-overlap speaker', () => {
    // [1.5,2.5]: 0.5 s in spk0, 0.5 s in spk1 -> tie broken by first-seen (spk0).
    const tie = assignSpeakersToWords([W('mid', 1.5, 2.5)], segments);
    assert.equal(tie[0].speaker, 0);
    // [1.8,2.6]: 0.2 s in spk0, 0.6 s in spk1 -> spk1.
    const lean = assignSpeakersToWords([W('lean', 1.8, 2.6)], segments);
    assert.equal(lean[0].speaker, 1);
  });

  test('a word in a gap falls to the nearest segment', () => {
    const segs = [{ start: 0, end: 1, speaker: 0 }, { start: 5, end: 6, speaker: 1 }];
    // midpoint 4.5 is nearer to [5,6] than [0,1].
    const out = assignSpeakersToWords([W('gap', 4, 5)], segs);
    assert.equal(out[0].speaker, 1);
  });

  test('zero-duration word still assigns by nearest', () => {
    const out = assignSpeakersToWords([W('x', 3.0, 3.0)], segments);
    assert.equal(out[0].speaker, 1); // point 3.0 sits inside [2,4]
  });

  test('a point exactly on a segment boundary breaks the tie to first-seen', () => {
    const out = assignSpeakersToWords([W('edge', 2.0, 2.0)], segments);
    assert.equal(out[0].speaker, 0); // equidistant to [0,2] and [2,4]
  });

  test('no segments -> speaker 0 for all', () => {
    const out = assignSpeakersToWords([W('a', 0, 1), W('b', 1, 2)], []);
    assert.deepEqual(out.map((w) => w.speaker), [0, 0]);
  });

  test('is non-mutating', () => {
    const words = [W('hi', 0, 1)];
    const out = assignSpeakersToWords(words, segments);
    assert.equal('speaker' in words[0], false);
    assert.equal(out[0].speaker, 0);
    assert.notEqual(out[0], words[0]);
  });

  test('empty words -> empty', () => {
    assert.deepEqual(assignSpeakersToWords([], segments), []);
  });
});

describe('groupWordsIntoTurns', () => {
  test('groups consecutive same-speaker words and rebuilds text', () => {
    const words = [
      { text: 'hello', start_time: 0, end_time: 1, speaker: 0 },
      { text: 'world', start_time: 1, end_time: 2, speaker: 0 },
      { text: 'hi', start_time: 2, end_time: 3, speaker: 1 },
      { text: 'again', start_time: 3, end_time: 4, speaker: 0 },
    ];
    const turns = groupWordsIntoTurns(words);
    assert.equal(turns.length, 3);
    assert.deepEqual(turns.map((t) => t.speaker), [0, 1, 0]);
    assert.equal(turns[0].text, 'hello world');
    assert.equal(turns[0].start_time, 0);
    assert.equal(turns[0].end_time, 2);
    assert.equal(turns[1].text, 'hi');
    assert.equal(turns[2].text, 'again');
  });

  test('trims and drops empty word text', () => {
    const words = [
      { text: '  hey ', start_time: 0, end_time: 1, speaker: 0 },
      { text: '', start_time: 1, end_time: 2, speaker: 0 },
      { text: 'you', start_time: 2, end_time: 3, speaker: 0 },
    ];
    const turns = groupWordsIntoTurns(words);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].text, 'hey you');
  });

  test('empty -> empty', () => {
    assert.deepEqual(groupWordsIntoTurns([]), []);
  });
});

describe('speakerCount', () => {
  test('counts distinct speakers', () => {
    assert.equal(speakerCount([{ speaker: 0 }, { speaker: 1 }, { speaker: 0 }]), 2);
  });
  test('empty -> 0', () => {
    assert.equal(speakerCount([]), 0);
  });
});

describe('turnsToLabeledText', () => {
  const defName = (s) => `Speaker ${s + 1}`;

  test('joins turns as "Name: text" blocks separated by a blank line', () => {
    const turns = [
      { speaker: 0, text: 'hello there' },
      { speaker: 1, text: 'general kenobi' },
      { speaker: 0, text: 'so uncivilized' },
    ];
    assert.equal(
      turnsToLabeledText(turns, defName),
      'Speaker 1: hello there\n\nSpeaker 2: general kenobi\n\nSpeaker 1: so uncivilized',
    );
  });

  test('uses the resolver so renamed speakers appear (and repeat) by name', () => {
    const turns = [
      { speaker: 0, text: 'one' },
      { speaker: 1, text: 'two' },
      { speaker: 0, text: 'three' },
    ];
    const names = { 0: 'Alice', 1: 'Bob' };
    assert.equal(
      turnsToLabeledText(turns, (s) => names[s] ?? defName(s)),
      'Alice: one\n\nBob: two\n\nAlice: three',
    );
  });

  test('drops turns whose text is empty/whitespace, trims the rest', () => {
    const turns = [
      { speaker: 0, text: '  hi  ' },
      { speaker: 1, text: '   ' },
      { speaker: 0, text: '' },
    ];
    assert.equal(turnsToLabeledText(turns, defName), 'Speaker 1: hi');
  });

  test('empty/invalid -> empty string', () => {
    assert.equal(turnsToLabeledText([], defName), '');
    assert.equal(turnsToLabeledText(null, defName), '');
  });
});
