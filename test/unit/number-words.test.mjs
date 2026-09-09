// Unit tests for the spelled-out-numbers-to-digits converter (English and
// French) behind the "Numbers as digits" setting.
//
// The interesting cases are not the happy ones: they are the guards that stop
// the converter from making a transcript worse (an article read as a digit, two
// unrelated numbers welded together, a hyphenated ordinary word).
//
// Built with Claude Code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { numberWordsToDigits, numberWordsToDigitsInWords } from '../../app/ui/src/lib/numberWords.js';

const en = (s) => numberWordsToDigits(s, 'en');
const fr = (s) => numberWordsToDigits(s, 'fr');

test('English cardinals convert, spelled apart or hyphenated', () => {
  assert.equal(en('I need twenty-three of them'), 'I need 23 of them');
  assert.equal(en('twenty three'), '23');
  assert.equal(en('two hundred'), '200');
  assert.equal(en('one hundred and five people'), '105 people');
  assert.equal(en('one hundred and twenty three'), '123');
  assert.equal(en('three thousand four hundred and twelve'), '3412');
  assert.equal(en('two million three thousand'), '2003000');
  assert.equal(en('zero'), '0');
});

test('French cardinals, including the compound forms', () => {
  assert.equal(fr('vingt-cinq milligrammes'), '25 milligrammes');
  assert.equal(fr('vingt et un'), '21');
  assert.equal(fr('soixante et onze ans'), '71 ans');
  assert.equal(fr('soixante-quinze'), '75');
  assert.equal(fr('dix-sept'), '17');
  assert.equal(fr('quatre-vingt-dix-sept'), '97');
  assert.equal(fr('quatre vingt dix sept'), '97', 'un ASR sans traits d’union');
  assert.equal(fr('quatre-vingts ans'), '80 ans');
  assert.equal(fr('cent quatre-vingt-dix-neuf euros'), '199 euros');
  assert.equal(fr('deux mille vingt-quatre'), '2024');
  assert.equal(fr('mille neuf cent quatre-vingt-quatre'), '1984');
  assert.equal(fr('trois millions deux cent mille'), '3200000');
  assert.equal(fr('zéro'), '0');
});

test('decimals convert, in both languages, with a dot', () => {
  // A decimal is exactly the case where "un" IS part of a number, so the
  // ambiguity guard must not keep it as a word here.
  assert.equal(fr('un virgule trente'), '1.30');
  assert.equal(fr('un virgule cinq milligrammes'), '1.5 milligrammes');
  assert.equal(fr('un virgule trente et un'), '1.31');
  assert.equal(fr('zéro virgule cinq'), '0.5');
  assert.equal(en('one point five'), '1.5');
  assert.equal(en('two point five milligrams'), '2.5 milligrams');
  // The fraction is read group by group, so a leading zero survives.
  assert.equal(fr('deux virgule zéro cinq'), '2.05');
  assert.equal(en('three point one four'), '3.14');
});

test('a decimal separator outside a number stays an ordinary word', () => {
  assert.equal(en('the point is'), 'the point is');
  assert.equal(fr('virgule'), 'virgule');
  // A trailing separator with nothing after it is left in the text.
  assert.equal(fr('deux virgule'), '2 virgule');
  assert.equal(fr('vingt-cinq, virgule'), '25, virgule');
});

test('words that are only sometimes numbers stay words when alone', () => {
  // The whole point of the guard: these are articles and pronouns far more
  // often than they are the digit 1.
  assert.equal(en('one of them stayed'), 'one of them stayed');
  assert.equal(fr('un chat et une souris'), 'un chat et une souris');
  // ...but they convert as part of a real number.
  assert.equal(en('twenty-one'), '21');
  assert.equal(fr('cent un'), '101');
  assert.equal(fr('vingt et une minutes'), '21 minutes');
});

test('two numbers that cannot combine stay two numbers', () => {
  assert.equal(en('two two three'), '2 2 3');
  assert.equal(en('nineteen eighty four'), '19 84', 'years are a known limitation');
  assert.equal(fr('deux deux'), '2 2');
});

test('a joiner outside a number is left alone', () => {
  assert.equal(en('give me five and six'), 'give me 5 and 6');
  assert.equal(en('and then five'), 'and then 5');
  assert.equal(fr('deux et deux'), '2 et 2');
  assert.equal(fr('et voilà'), 'et voilà');
});

test('ordinary hyphenated words are not numbers', () => {
  assert.equal(en('a well-known T-shirt'), 'a well-known T-shirt');
  assert.equal(en('nothing here'), 'nothing here');
});

test('surrounding text, punctuation and case are preserved', () => {
  assert.equal(en('Take two, then three.'), 'Take 2, then 3.');
  assert.equal(fr('Dose : vingt-cinq mg ; puis dix.'), 'Dose : 25 mg ; puis 10.');
  assert.equal(en('TWENTY-THREE'), '23', 'matching is case-insensitive');
});

test('an unsupported language or empty input is returned untouched', () => {
  assert.equal(numberWordsToDigits('twenty three', 'de'), 'twenty three');
  assert.equal(numberWordsToDigits('twenty three', undefined), 'twenty three');
  assert.equal(numberWordsToDigits('', 'en'), '');
  assert.equal(numberWordsToDigits(null, 'en'), null);
});

test('the word-timestamp array collapses a spelled number into one word', () => {
  const words = [
    { text: 'vingt-cinq', start_time: 0, end_time: 0.5, confidence: 0.9 },
    { text: 'milligrammes,', start_time: 0.5, end_time: 1, confidence: 0.8 },
    { text: 'cent', start_time: 1, end_time: 1.3, confidence: 0.7 },
    { text: 'cinq.', start_time: 1.3, end_time: 1.6, confidence: 0.6 },
  ];
  const out = numberWordsToDigitsInWords(words, 'fr');
  assert.deepEqual(out.map(w => w.text), ['25', 'milligrammes,', '105.']);
  // The merged word spans the whole run and keeps the least confident piece.
  assert.equal(out[2].start_time, 1);
  assert.equal(out[2].end_time, 1.6);
  assert.equal(out[2].confidence, 0.6);
  // Words outside a number are passed through by identity.
  assert.equal(out[1], words[1]);
});

test('the two entry points agree on what a number is', () => {
  const sentences = [
    ['en', 'one of them took twenty-three minutes and five seconds'],
    ['fr', 'un patient sur quatre-vingt-dix-sept, soit deux mille cas'],
    ['en', 'nothing numeric at all'],
  ];
  for (const [lang, sentence] of sentences) {
    const words = sentence.split(' ').map((text, i) => ({ text, start_time: i, end_time: i + 1 }));
    const viaWords = numberWordsToDigitsInWords(words, lang).map(w => w.text).join(' ');
    assert.equal(viaWords, numberWordsToDigits(sentence, lang), sentence);
  }
});

test('an absent or malformed word array is handled', () => {
  assert.deepEqual(numberWordsToDigitsInWords([], 'en'), []);
  assert.equal(numberWordsToDigitsInWords(null, 'en'), null);
  const odd = [{ start_time: 0, end_time: 1 }, { text: 'five', start_time: 1, end_time: 2 }];
  assert.deepEqual(numberWordsToDigitsInWords(odd, 'en').map(w => w.text), [undefined, '5']);
});
