// Tier-1 unit test for the phrase-boosting trie (app/src/phraseBoost.js) and its
// interaction with the BPE encoder. Validates phrase parsing, list directives,
// augmentation expansion, trie build/advance, the depth-scaled bonus map, top-k
// gating, and that applyBoost/restore flips a greedy argmax without permanently
// altering the logits.
//
// Uses the committed BPE fixture (no python needed at run time). Migrated from
// scripts/test-phrase-boost.mjs to node:test. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BpeEncoder, buildVocabToId } from '../../app/src/bpeEncoder.js';
import {
  BoostingTrie, parseBoostPhrases, parseBoostDirectives, encodePhrases,
  augmentVariants, expandAugmentations, selectPrebuilt, DEFAULT_BOOST_TOPK,
} from '../../app/src/phraseBoost.js';
import { loadCachedFixture, loadMergesAsset } from '../support/bpe-fixture.mjs';

const asset = loadMergesAsset();
const fixture = loadCachedFixture();
const encoder = new BpeEncoder(asset, buildVocabToId(fixture.id2token));

const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const argmaxOf = (arr) => { let m = -Infinity, mi = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) { m = arr[i]; mi = i; } return mi; };

describe('parseBoostPhrases', () => {
  const parsed = parseBoostPhrases(
    'acetaminophen\nibuprofen:2.5\n  spaced phrase  \nfoo:99\n\nratio 3:1\n:0.5\nbad:abc',
  );
  test('default weight 1', () => assert.ok(parsed[0].phrase === 'acetaminophen' && parsed[0].weight === 1));
  test('explicit weight 2.5', () => assert.ok(parsed[1].phrase === 'ibuprofen' && parsed[1].weight === 2.5));
  test('trims whitespace', () => assert.ok(parsed[2].phrase === 'spaced phrase' && parsed[2].weight === 1));
  test('out-of-range weight clamped + warning', () => assert.ok(parsed[3].phrase === 'foo' && parsed[3].weight === 1 && !!parsed[3].warning));
  test('trailing :num is a weight (documented)', () => assert.ok(parsed[4].phrase === 'ratio 3' && parsed[4].weight === 1));
  test('empty phrase before colon keeps whole line', () => assert.equal(parsed[5].phrase, ':0.5'));
  test('non-numeric tail is not a weight', () => assert.ok(parsed[6].phrase === 'bad:abc' && parsed[6].weight === 1));
  test('skips blank lines', () => assert.equal(parsed.length, 7));

  const signed = parseBoostPhrases('um:-3\nover:-99\nzero:0');
  test('negative weight in range kept', () => assert.ok(signed[0].phrase === 'um' && signed[0].weight === -3 && !signed[0].warning));
  test('under-range negative weight clamped + warning', () => assert.ok(signed[1].phrase === 'over' && signed[1].weight === 1 && !!signed[1].warning));
  test('zero weight rejected + warning', () => assert.ok(signed[2].phrase === 'zero' && signed[2].weight === 1 && !!signed[2].warning));

  const tk = parseBoostPhrases('plain\nfoo:3\nbar:3:50\nbaz:3:0\nqux:3:2.5\nratio 3:1');
  test('no suffix => default weight + default topk', () => assert.ok(tk[0].phrase === 'plain' && tk[0].weight === 1 && tk[0].topk === DEFAULT_BOOST_TOPK));
  test('one number is the weight, topk defaults', () => assert.ok(tk[1].phrase === 'foo' && tk[1].weight === 3 && tk[1].topk === DEFAULT_BOOST_TOPK));
  test('weight:topk parsed (inner weight, outer topk)', () => assert.ok(tk[2].phrase === 'bar' && tk[2].weight === 3 && tk[2].topk === 50));
  test('topk < 1 rejected + warning', () => assert.ok(tk[3].phrase === 'baz' && tk[3].weight === 3 && tk[3].topk === DEFAULT_BOOST_TOPK && !!tk[3].warning));
  test('non-integer topk rejected + warning', () => assert.ok(tk[4].phrase === 'qux' && tk[4].weight === 3 && tk[4].topk === DEFAULT_BOOST_TOPK && !!tk[4].warning));
  test('colon-only phrase still unaffected with topk parsing', () => assert.ok(tk[5].phrase === 'ratio 3' && tk[5].weight === 1 && tk[5].topk === DEFAULT_BOOST_TOPK));

  const fl = parseBoostPhrases('a::40\nb:5:50:i\nc:s\nd:2:i\ne:5:50\nf:abc:i\ng:5::fap\nh:5::p\ni:5::fa');
  test('empty weight keeps default, explicit topk', () => assert.ok(fl[0].phrase === 'a' && fl[0].weight === 1 && fl[0].topk === 40));
  test(':i alias parsed after weight:topk -> fap', () => assert.ok(fl[1].phrase === 'b' && fl[1].weight === 5 && fl[1].topk === 50 && fl[1].augment === 'fap'));
  test(':s alias alone -> none (defaults otherwise)', () => assert.ok(fl[2].phrase === 'c' && fl[2].weight === 1 && fl[2].augment === ''));
  test(':i alias right after weight (no topk)', () => assert.ok(fl[3].phrase === 'd' && fl[3].weight === 2 && fl[3].topk === DEFAULT_BOOST_TOPK && fl[3].augment === 'fap'));
  test('no flag leaves augment undefined', () => assert.equal(fl[4].augment, undefined));
  test('non-numeric middle field is not a weight', () => assert.ok(fl[5].phrase === 'f:abc' && fl[5].weight === 1 && fl[5].augment === 'fap'));
  test(':fap sets all three flags', () => assert.ok(fl[6].phrase === 'g' && fl[6].weight === 5 && fl[6].augment === 'fap'));
  test(':p sets prefix flag only', () => assert.ok(fl[7].phrase === 'h' && fl[7].augment === 'p'));
  test(':fa is canonicalised', () => assert.ok(fl[8].phrase === 'i' && fl[8].augment === 'fa'));
});

describe('parseBoostDirectives', () => {
  const dirParsed = parseBoostPhrases('#!strength 3\nvenlafaxine:5\n#! a comment\namlodipine');
  test('directive lines skipped, not phrases', () => assert.ok(dirParsed.length === 2 && dirParsed[0].phrase === 'venlafaxine' && dirParsed[1].phrase === 'amlodipine'));
  test('strength directive parsed (space)', () => assert.equal(parseBoostDirectives('#!strength 3\nfoo').strength, 3));
  test('strength directive parsed (= separator)', () => assert.equal(parseBoostDirectives('#!strength=2.5').strength, 2.5));
  test('strength directive parsed (: separator)', () => assert.equal(parseBoostDirectives('#!strength:-4').strength, -4));
  test('strength directive case-insensitive key', () => assert.equal(parseBoostDirectives('#!STRENGTH 1.5').strength, 1.5));
  test('last strength directive wins', () => assert.equal(parseBoostDirectives('#!strength 2\n#!strength 7').strength, 7));
  test('non-finite strength ignored', () => assert.equal(parseBoostDirectives('#!strength abc').strength, undefined));
  test('unknown directive key ignored', () => assert.equal(Object.keys(parseBoostDirectives('#!note hello')).length, 0));
  test('no directive => empty result', () => assert.equal(Object.keys(parseBoostDirectives('plain\nfoo:3')).length, 0));
  test('# without ! is still a phrase', () => assert.ok(parseBoostPhrases('#hashtag').length === 1 && parseBoostPhrases('#hashtag')[0].phrase === '#hashtag'));
  test('prefixes directive parsed (whitespace-separated)', () => assert.deepEqual(parseBoostDirectives("#!prefixes l' d' al-").prefixes, ["l'", "d'", "al-"]));
  test('empty prefixes value ignored', () => assert.equal(parseBoostDirectives('#!prefixes   ').prefixes, undefined));
  test('last prefixes directive wins', () => assert.deepEqual(parseBoostDirectives("#!prefixes l'\n#!prefixes d'").prefixes, ["d'"]));
});

describe('augmentVariants / expandAugmentations', () => {
  test('no flags => as-typed only', () => assert.ok(eqArr(augmentVariants('venlafaxine', ''), ['venlafaxine'])));
  test('f => as-typed + Title Case', () => assert.ok(eqArr(augmentVariants('venlafaxine', 'f'), ['venlafaxine', 'Venlafaxine'])));
  test('a => as-typed + ALL CAPS', () => assert.ok(eqArr(augmentVariants('venlafaxine', 'a'), ['venlafaxine', 'VENLAFAXINE'])));
  test('f Title-cases each word of a multi-word phrase', () => {
    assert.ok(augmentVariants('myocardial infarction', 'f').includes('Myocardial Infarction'));
  });
  test('as-typed mixed casing is preserved', () => assert.ok(augmentVariants('mRNA', 'fa').includes('mRNA')));
  test('empty phrase yields nothing', () => assert.ok(eqArr(augmentVariants('', 'fap'), [])));

  test('p on a vowel-initial phrase adds elision-prefixed forms', () => {
    const v = augmentVariants('amoxicilline', 'p', ["l'", "d'"]);
    assert.ok(v.includes("l'amoxicilline") && v.includes("d'amoxicilline"));
  });
  test('p on a consonant-initial phrase adds no elision form', () => {
    assert.ok(eqArr(augmentVariants('beta', 'p', ["l'", "d'"]), ['beta']));
  });
  test('p with a non-apostrophe prefix attaches unconditionally', () => {
    assert.ok(augmentVariants('beta', 'p', ['al-']).includes('al-beta'));
  });
  test('p applies to each casing form so far (with f)', () => {
    const v = augmentVariants('amoxicilline', 'fp', ["l'"]);
    assert.ok(v.includes("l'amoxicilline") && v.includes("l'Amoxicilline"));
  });

  test('default off => no expansion', () => assert.equal(expandAugmentations([{ phrase: 'venlafaxine', weight: 5, topk: 50 }]).length, 1));
  const expanded = expandAugmentations([{ phrase: 'venlafaxine', weight: 5, topk: 50 }], 'fa');
  test('default fa => expands one entry into 3 forms', () => assert.equal(expanded.length, 3));
  test('expanded entries carry the original weight + topk', () => assert.ok(expanded.every(e => e.weight === 5 && e.topk === 50)));
  test('expanded entries cover each form', () => assert.ok(['venlafaxine', 'Venlafaxine', 'VENLAFAXINE'].every(p => expanded.some(e => e.phrase === p))));
  test('per-phrase augment expands even when default is off', () => assert.equal(expandAugmentations([{ phrase: 'venlafaxine', weight: 1, augment: 'fa' }], '').length, 3));
  test('per-phrase empty augment stays single even when default is on', () => assert.equal(expandAugmentations([{ phrase: 'venlafaxine', weight: 1, augment: '' }], 'fa').length, 1));
  const dedup = expandAugmentations([
    { phrase: 'venlafaxine', weight: 2 },
    { phrase: 'Venlafaxine', weight: 8 },
  ], 'fa');
  test('collision keeps the larger-magnitude weight', () => assert.equal(dedup.find(e => e.phrase === 'Venlafaxine').weight, 8));
  test('no duplicate phrase strings after expansion', () => assert.equal(new Set(dedup.map(e => e.phrase)).size, dedup.length));
});

const ids = encoder.encode('acetaminophen');

describe('BoostingTrie build + advance + bonus map', () => {
  const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 2 }], encoder, { strength: 1, depthScaling: 0.5 });
  test('non-empty after build', () => assert.ok(!trie.isEmpty && trie.size === 1));

  trie.reset();
  test('root boosts only first token', () => assert.ok(trie.childBoostFor(ids[0]) !== null && trie.childBoostFor(ids[1]) === null));
  test('depth-1 bonus = weight*(1+0.5*0) = 2', () => assert.equal(trie.childBoostFor(ids[0]).bonus, 2));
  test('default topk carried on the bonus', () => assert.equal(trie.childBoostFor(ids[0]).topk, DEFAULT_BOOST_TOPK));

  test('after advance: second token boosted, root still active', () => {
    trie.advance(ids[0]);
    assert.ok(trie.childBoostFor(ids[1]) !== null);
    assert.equal(trie.childBoostFor(ids[1]).bonus, 3); // weight*(1+0.5*1)
    assert.equal(trie.childBoostFor(ids[0]).bonus, 2); // root still active
  });
  test('mismatch drops to root only', () => {
    trie.advance(999999);
    assert.ok(trie.childBoostFor(ids[1]) === null && trie.childBoostFor(ids[0]).bonus === 2);
  });
});

// These sequences mutate a shared logits buffer step by step, so each is a
// single test running the assertions in order (node:test executes the describe
// body at registration time, so body-level mutations would run before any
// test callback).
test('applyBoost / restore flips argmax, then restores', () => {
  const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 2 }], encoder, { strength: 1, depthScaling: 0.5 });
  const V = fixture.id2token.length;
  const logits = new Float32Array(V);
  logits[5] = 1.0;        // some other token is the unboosted winner
  logits[ids[0]] = 0.5;   // phrase token is a genuine top-k runner-up
  trie.reset();
  const before = logits[ids[0]];

  assert.equal(argmaxOf(logits), 5, 'unboosted argmax is token 5');
  const saved = trie.applyBoost(logits);
  assert.ok(Array.isArray(saved) && saved.length === 2, 'applyBoost returned saved pairs');
  assert.equal(argmaxOf(logits), ids[0], 'boosted argmax is the phrase token');
  trie.restore(logits, saved);
  assert.equal(logits[ids[0]], before, 'restore returns original value');
  assert.equal(argmaxOf(logits), 5, 'argmax back to token 5 after restore');
  trie.strength = 0;
  assert.equal(trie.applyBoost(logits), null, 'strength 0 => applyBoost is a no-op');
});

test('penalise (negative weight) flips the argmax away, then restores', () => {
  const penTrie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: -2 }], encoder, { strength: 1, depthScaling: 0.5 });
  penTrie.reset();
  assert.equal(penTrie.childBoostFor(ids[0]).bonus, -2, 'negative bonus is stored, not lost against 0');
  const penLogits = new Float32Array(fixture.id2token.length);
  penLogits[ids[0]] = 1.0;
  penLogits[5] = 0.5;
  assert.equal(argmaxOf(penLogits), ids[0], 'unpenalised argmax is the phrase token');
  const penSaved = penTrie.applyBoost(penLogits);
  assert.equal(argmaxOf(penLogits), 5, 'penalty pushed the phrase token below the runner-up');
  penTrie.restore(penLogits, penSaved);
  assert.equal(penLogits[ids[0]], 1.0, 'restore brings the phrase token back');
});

test('top-k gating only boosts tokens already in the model top-k', () => {
  const V = fixture.id2token.length;
  const gateLogits = new Float32Array(V);
  gateLogits[100] = 5; gateLogits[101] = 4; gateLogits[ids[0]] = 1; // ids[0] ranks 3rd
  const gate2 = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, topk: 2 }], encoder, { strength: 1 });
  gate2.reset();
  assert.equal(gate2.applyBoost(gateLogits), null, 'candidate outside top-k is gated out');
  assert.equal(gateLogits[ids[0]], 1, 'gated-out logit is untouched');
  const gate3 = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, topk: 3 }], encoder, { strength: 1 });
  gate3.reset();
  const gateSaved = gate3.applyBoost(gateLogits);
  assert.ok(Array.isArray(gateSaved) && gateLogits[ids[0]] === 6, 'candidate inside top-k is boosted');
  gate3.restore(gateLogits, gateSaved);
  assert.equal(gateLogits[ids[0]], 1, 'restore after gated boost');
});

describe('skip <unk> phrases', () => {
  test('CJK encodes to <unk>', () => assert.ok(encoder.encode('東京').includes(encoder.unkId)));
  const mixedTrie = BoostingTrie.buildFromPhrases(
    [{ phrase: 'acetaminophen', weight: 1 }, { phrase: '東京', weight: 1 }, { phrase: 'sœur', weight: 1 }],
    encoder,
  );
  test('clean Latin phrases inserted (accents + œ ligature)', () => assert.equal(mixedTrie.size, 2));
  test('CJK phrase recorded as skipped', () => assert.ok(eqArr(mixedTrie.skipped, ['東京'])));
  test('skipped phrase is not boostable', () => assert.ok(!mixedTrie.root.children.has(encoder.unkId)));
});

describe('encodePhrases + buildFromEncoded (worker split)', () => {
  const splitEntries = [
    { phrase: 'acetaminophen', weight: 1 },
    { phrase: '東京', weight: 1 },
    { phrase: 'sœur', weight: 1 },
  ];
  const { encoded, skipped } = encodePhrases(splitEntries, encoder);
  test('encodePhrases drops the <unk> phrase', () => assert.ok(skipped.length === 1 && skipped[0] === '東京'));
  test('encodePhrases keeps the clean phrases', () => assert.equal(encoded.length, 2));
  test('encoded ids match a direct encode', () => assert.ok(eqArr(encoded[0].ids, encoder.encode('acetaminophen'))));
  const mixedTrie = BoostingTrie.buildFromPhrases(
    [{ phrase: 'acetaminophen', weight: 1 }, { phrase: 'sœur', weight: 1 }], encoder,
  );
  const fromEncoded = BoostingTrie.buildFromEncoded(encoded, { strength: 1 });
  test('buildFromEncoded yields the same size as buildFromPhrases', () => assert.equal(fromEncoded.size, mixedTrie.size));
  test('buildFromEncoded reaches the same first token', () => assert.ok(fromEncoded.root.children.has(ids[0])));
});

describe('selectPrebuilt (reload fast-path gate)', () => {
  // This gate decides whether the reload/restore path can reuse the server
  // prebuilt encoding and so SKIP the in-browser parse + augment-expand + BPE
  // encode. A false negative here means the UI re-encodes a large curated list
  // on the main thread (the freeze the prebuilt exists to avoid), so the match
  // conditions are pinned exactly.
  const pre = {
    text: 'venlafaxine\nacetaminophen',
    vocabSig: 'sig-abc',
    augmentDefault: '',
    encoded: [{ ids: [1, 2], weight: 1 }],
  };
  const base = { text: pre.text, vocabSig: 'sig-abc', augmentDefault: '' };

  test('reuses the prebuilt when text + vocab + augment all agree', () => {
    const r = selectPrebuilt(pre, base);
    assert.equal(r.usePrebuilt, true);
    assert.deepEqual(r.reasons, []);
  });

  test('no prebuilt => not used, no reasons', () => {
    assert.deepEqual(selectPrebuilt(null, base), { usePrebuilt: false, reasons: [] });
  });

  test('edited text rejects the prebuilt', () => {
    const r = selectPrebuilt(pre, { ...base, text: pre.text + '\nibuprofen' });
    assert.equal(r.usePrebuilt, false);
    assert.equal(r.reasons.length, 1);
    assert.match(r.reasons[0], /text was edited/);
  });

  test('vocab mismatch rejects the prebuilt', () => {
    const r = selectPrebuilt(pre, { ...base, vocabSig: 'sig-different' });
    assert.equal(r.usePrebuilt, false);
    assert.match(r.reasons[0], /vocab mismatch/);
  });

  test('a null model vocabSig (model not loaded) rejects the prebuilt', () => {
    assert.equal(selectPrebuilt(pre, { ...base, vocabSig: null }).usePrebuilt, false);
  });

  test('augment default differing from the prebuilt rejects it', () => {
    const r = selectPrebuilt(pre, { ...base, augmentDefault: 'fap' });
    assert.equal(r.usePrebuilt, false);
    assert.match(r.reasons[0], /augment default differs/);
  });

  test('legacy prebuilt (no augmentDefault) is treated as un-augmented ("")', () => {
    const legacy = { ...pre };
    delete legacy.augmentDefault;
    assert.equal(selectPrebuilt(legacy, { ...base, augmentDefault: '' }).usePrebuilt, true);
    assert.equal(selectPrebuilt(legacy, { ...base, augmentDefault: 'fap' }).usePrebuilt, false);
  });

  test('multiple mismatches are all reported', () => {
    const r = selectPrebuilt(pre, { text: 'edited', vocabSig: 'other', augmentDefault: 'fap' });
    assert.equal(r.usePrebuilt, false);
    assert.equal(r.reasons.length, 3);
  });
});
