// Tier-1 unit test for the pure diarization<->transcript merge helpers
// (app/ui/src/lib/speakerAssign.js). Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assignSpeakersToWords, groupWordsIntoTurns, speakerCount, turnsToLabeledText, resolveSpeakerRoot, canonicalizeTurns } from '../../app/ui/src/lib/speakerAssign.js';

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

describe('resolveSpeakerRoot', () => {
  test('no merges -> identity', () => {
    assert.equal(resolveSpeakerRoot(2, null), 2);
    assert.equal(resolveSpeakerRoot(2, undefined), 2);
    assert.equal(resolveSpeakerRoot(2, {}), 2);
  });
  test('follows a single hop', () => {
    assert.equal(resolveSpeakerRoot(2, { 2: 1 }), 1);
  });
  test('follows a chain transitively (2->1->0)', () => {
    assert.equal(resolveSpeakerRoot(2, { 2: 1, 1: 0 }), 0);
  });
  test('is cycle-safe (terminates, never loops forever)', () => {
    // A pathological 2-cycle has no real root; we only require termination with
    // a deterministic member of the cycle (this can't arise in practice).
    assert.ok([0, 1].includes(resolveSpeakerRoot(1, { 0: 1, 1: 0 })));
  });
  test('a self-loop resolves to itself', () => {
    assert.equal(resolveSpeakerRoot(3, { 3: 3 }), 3);
  });
});

describe('canonicalizeTurns', () => {
  const T = (speaker, text) => ({ speaker, text });

  test('empty/invalid -> empty', () => {
    assert.deepEqual(canonicalizeTurns([], null), []);
    assert.deepEqual(canonicalizeTurns(null, null), []);
  });

  test('no merges, contiguous speakers -> positions track speakers', () => {
    const turns = canonicalizeTurns([T(0, 'a'), T(1, 'b'), T(0, 'c')], null);
    assert.deepEqual(turns.map((t) => t.speaker), [0, 1, 0]);
    assert.deepEqual(turns.map((t) => t.position), [0, 1, 0]);
  });

  test('non-contiguous raw speakers get gap-free positions (0,1,4 -> 0,1,2)', () => {
    // The diarizer can skip a cluster index; positions must not leave a gap so
    // the palette/default ordinal name stays contiguous.
    const turns = canonicalizeTurns([T(0, 'a'), T(1, 'b'), T(4, 'c')], null);
    assert.deepEqual(turns.map((t) => t.speaker), [0, 1, 4]);
    assert.deepEqual(turns.map((t) => t.position), [0, 1, 2]);
  });

  test('merging speaker 2 into 1 collapses to two positions and merges adjacency', () => {
    // speakers 0,1,2 with 2 renamed into 1: the now-adjacent 1 and 2 turns merge
    // into one block and share a single position/colour -> only two speakers.
    const turns = canonicalizeTurns([T(0, 'a'), T(1, 'b'), T(2, 'c'), T(0, 'd')], { 2: 1 });
    assert.deepEqual(turns.map((t) => t.speaker), [0, 1, 0]);
    assert.deepEqual(turns.map((t) => t.position), [0, 1, 0]);
    assert.equal(turns[1].text, 'b c'); // adjacent 1 + (merged) 2 concatenated
  });

  test('merge keeps the root speaker index stable (for name lookup/persistence)', () => {
    // Renaming the second speaker (raw 1) into the third (raw 2): turns carry the
    // surviving root index 2, but positions stay gap-free.
    const turns = canonicalizeTurns([T(2, 'a'), T(1, 'b')], { 1: 2 });
    assert.deepEqual(turns.map((t) => t.speaker), [2]);
    assert.deepEqual(turns.map((t) => t.position), [0]);
    assert.equal(turns[0].text, 'a b');
  });

  test('does not mutate the input turns', () => {
    const input = [T(0, 'a'), T(1, 'b')];
    canonicalizeTurns(input, { 1: 0 });
    assert.equal('position' in input[0], false);
    assert.equal(input[1].speaker, 1);
  });

  test('a 13th speaker still gets a contiguous position (App maps it to "Speaker 13")', () => {
    const many = Array.from({ length: 13 }, (_, i) => T(i, `t${i}`));
    const turns = canonicalizeTurns(many, null);
    assert.equal(turns[12].position, 12);
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

  // The dictation layer composes with the speaker view: getDisplayText passes a
  // textFor that runs the dictation regex on each turn, so a diarized + dictation
  // copy/export reads as "Name: cleaned text". Independent toggles -> both apply.
  test('textFor transforms each turn (diarized + dictation compose)', () => {
    const turns = [
      { speaker: 0, text: 'open paren foo close paren' },
      { speaker: 1, text: 'bar' },
    ];
    const upper = (t) => t.toUpperCase();
    assert.equal(
      turnsToLabeledText(turns, defName, upper),
      'Speaker 1: OPEN PAREN FOO CLOSE PAREN\n\nSpeaker 2: BAR',
    );
  });

  test('textFor that empties a turn drops it (post-transform filtering)', () => {
    const turns = [
      { speaker: 0, text: 'keep' },
      { speaker: 1, text: 'remove me' },
    ];
    // A rule that deletes "remove me" leaves only whitespace -> that turn drops.
    const strip = (t) => t.replace(/remove me/g, '');
    assert.equal(turnsToLabeledText(turns, defName, strip), 'Speaker 1: keep');
  });

  test('no textFor behaves exactly as before (null default)', () => {
    const turns = [{ speaker: 0, text: 'hi' }];
    assert.equal(turnsToLabeledText(turns, defName, null), 'Speaker 1: hi');
    assert.equal(turnsToLabeledText(turns, defName), 'Speaker 1: hi');
  });

  test('passes the display position to the resolver (gap-free default name)', () => {
    // After canonicalizeTurns a merged set can carry non-contiguous root speaker
    // indices but contiguous positions; the resolver labels by POSITION so the
    // default ordinal name never skips. Here root 4 sits at position 1.
    const turns = canonicalizeTurns([{ speaker: 0, text: 'a' }, { speaker: 4, text: 'b' }], null);
    const ordinal = (_spk, pos) => ['First', 'Second'][pos];
    assert.equal(turnsToLabeledText(turns, ordinal), 'First: a\n\nSecond: b');
  });
});
