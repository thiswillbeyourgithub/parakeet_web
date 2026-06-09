// Tier-1 unit test for the phrase-boosting trie (app/src/phraseBoost.js) and its
// interaction with the BPE encoder. Validates phrase parsing, list directives,
// augmentation expansion, trie build/advance, the depth-scaled bonus map, min-p
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
  augmentVariants, expandAugmentations, selectPrebuilt, DEFAULT_BOOST_MIN_P,
  isDefaultsLine, resolveBoostLines, findBoostConflicts, formatBoostConflict,
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

  const tk = parseBoostPhrases('plain\nfoo:3\nbar:3:0.5\nbaz:3:0\nqux:3:2.5\nratio 3:1');
  test('no suffix => default weight + default minp', () => assert.ok(tk[0].phrase === 'plain' && tk[0].weight === 1 && tk[0].minp === DEFAULT_BOOST_MIN_P));
  test('one number is the weight, minp defaults', () => assert.ok(tk[1].phrase === 'foo' && tk[1].weight === 3 && tk[1].minp === DEFAULT_BOOST_MIN_P));
  test('weight:minp parsed (inner weight, outer minp)', () => assert.ok(tk[2].phrase === 'bar' && tk[2].weight === 3 && tk[2].minp === 0.5));
  test('minp 0 rejected + warning', () => assert.ok(tk[3].phrase === 'baz' && tk[3].weight === 3 && tk[3].minp === DEFAULT_BOOST_MIN_P && !!tk[3].warning));
  test('minp > 1 rejected + warning', () => assert.ok(tk[4].phrase === 'qux' && tk[4].weight === 3 && tk[4].minp === DEFAULT_BOOST_MIN_P && !!tk[4].warning));
  test('colon-only phrase still unaffected with minp parsing', () => assert.ok(tk[5].phrase === 'ratio 3' && tk[5].weight === 1 && tk[5].minp === DEFAULT_BOOST_MIN_P));

  const fl = parseBoostPhrases('a::0.2\nb:5:0.3:i\nc:s\nd:2:i\ne:5:0.3\nf:abc:i\ng:5::fap\nh:5::p\ni:5::fa\nj:5::h\nk:5::hpf');
  test('empty weight keeps default, explicit minp', () => assert.ok(fl[0].phrase === 'a' && fl[0].weight === 1 && fl[0].minp === 0.2));
  test(':i alias parsed after weight:minp -> faph', () => assert.ok(fl[1].phrase === 'b' && fl[1].weight === 5 && fl[1].minp === 0.3 && fl[1].augment === 'faph'));
  test(':s alias alone -> none (defaults otherwise)', () => assert.ok(fl[2].phrase === 'c' && fl[2].weight === 1 && fl[2].augment === ''));
  test(':i alias right after weight (no minp)', () => assert.ok(fl[3].phrase === 'd' && fl[3].weight === 2 && fl[3].minp === DEFAULT_BOOST_MIN_P && fl[3].augment === 'faph'));
  test('no flag leaves augment undefined', () => assert.equal(fl[4].augment, undefined));
  test('non-numeric middle field is not a weight', () => assert.ok(fl[5].phrase === 'f:abc' && fl[5].weight === 1 && fl[5].augment === 'faph'));
  test(':fap sets the three casing/prefix flags', () => assert.ok(fl[6].phrase === 'g' && fl[6].weight === 5 && fl[6].augment === 'fap'));
  test(':p sets prefix flag only', () => assert.ok(fl[7].phrase === 'h' && fl[7].augment === 'p'));
  test(':fa is canonicalised', () => assert.ok(fl[8].phrase === 'i' && fl[8].augment === 'fa'));
  test(':h sets symbol-strip flag only', () => assert.ok(fl[9].phrase === 'j' && fl[9].augment === 'h'));
  test(':hpf is canonicalised to f,p,h order', () => assert.ok(fl[10].phrase === 'k' && fl[10].augment === 'fph'));
});

describe('findBoostConflicts (actively-incompatible duplicates)', () => {
  test('same phrase with opposite-sign weights is a conflict', () => {
    const c = findBoostConflicts(parseBoostPhrases('venlafaxine:5\nvenlafaxine:-5'));
    assert.equal(c.length, 1);
    assert.equal(c[0].phrase, 'venlafaxine');
    assert.deepEqual(c[0].settings.map(s => s.weight), [5, -5]);
  });

  test('same phrase with different magnitudes is a conflict', () => {
    const c = findBoostConflicts(parseBoostPhrases('foo:5\nfoo:3'));
    assert.equal(c.length, 1);
  });

  test('different min-p for the same weight is a conflict', () => {
    const c = findBoostConflicts(parseBoostPhrases('foo:5:0.1\nfoo:5:0.3'));
    assert.equal(c.length, 1);
    assert.match(formatBoostConflict(c[0]), /min-p/);
  });

  test('a verbatim duplicate (same weight AND min-p) is NOT a conflict', () => {
    assert.equal(findBoostConflicts(parseBoostPhrases('foo:5\nfoo:5')).length, 0);
  });

  test('same weight/min-p but different :AUG is NOT a conflict', () => {
    assert.equal(findBoostConflicts(parseBoostPhrases('foo:5:0.2:f\nfoo:5:0.2:a')).length, 0);
  });

  test('distinct phrases never conflict', () => {
    assert.equal(findBoostConflicts(parseBoostPhrases('foo:5\nbar:-5')).length, 0);
  });

  test('formatBoostConflict reports the conflicting weights', () => {
    const [c] = findBoostConflicts(parseBoostPhrases('venlafaxine:5\nvenlafaxine:-5'));
    assert.equal(formatBoostConflict(c), '"venlafaxine" given conflicting weights (5, -5)');
  });
});

describe('parseBoostDirectives (only #!prefixes survives)', () => {
  const dirParsed = parseBoostPhrases("#!prefixes l' d'\nvenlafaxine:5\n#! a comment\namlodipine");
  test('directive lines skipped, not phrases', () => assert.ok(dirParsed.length === 2 && dirParsed[0].phrase === 'venlafaxine' && dirParsed[1].phrase === 'amlodipine'));
  test('removed #!strength / #!augment lines are still skipped, never phrases', () => {
    const p = parseBoostPhrases('#!strength 3\n#!augment fa\nfoo');
    assert.ok(p.length === 1 && p[0].phrase === 'foo');
  });
  test('#!strength is no longer parsed (replaced by a * defaults line)', () => assert.equal(parseBoostDirectives('#!strength 3\nfoo').strength, undefined));
  test('#!augment is no longer parsed (replaced by a * defaults line)', () => assert.equal(parseBoostDirectives('#!augment fa').augment, undefined));
  test('unknown directive key ignored', () => assert.equal(Object.keys(parseBoostDirectives('#!note hello')).length, 0));
  test('no directive => empty result', () => assert.equal(Object.keys(parseBoostDirectives('plain\nfoo:3')).length, 0));
  test('# without ! is still a phrase', () => assert.ok(parseBoostPhrases('#hashtag').length === 1 && parseBoostPhrases('#hashtag')[0].phrase === '#hashtag'));
  test('prefixes directive parsed (whitespace-separated)', () => assert.deepEqual(parseBoostDirectives("#!prefixes l' d' al-").prefixes, ["l'", "d'", "al-"]));
  test('empty prefixes value ignored', () => assert.equal(parseBoostDirectives('#!prefixes   ').prefixes, undefined));
  test('last prefixes directive wins', () => assert.deepEqual(parseBoostDirectives("#!prefixes l'\n#!prefixes d'").prefixes, ["d'"]));
});

describe('* defaults line', () => {
  test('isDefaultsLine recognises * and *: lines only', () => {
    assert.ok(isDefaultsLine('*'));
    assert.ok(isDefaultsLine('*:2::fa'));
    assert.ok(!isDefaultsLine('*alpha')); // a phrase that merely starts with *
    assert.ok(!isDefaultsLine('plain'));
  });

  test('a leading * sets default weight/minp/augment for following phrases', () => {
    const p = parseBoostPhrases('*:2:0.3:fa\nvenlafaxine\namlodipine:7');
    assert.equal(p.length, 2);
    assert.deepEqual([p[0].phrase, p[0].weight, p[0].minp, p[0].augment], ['venlafaxine', 2, 0.3, 'fa']);
    // explicit weight overrides the * default weight; minp/augment still inherited.
    assert.deepEqual([p[1].phrase, p[1].weight, p[1].minp, p[1].augment], ['amlodipine', 7, 0.3, 'fa']);
  });

  test('* is stateful: a later * changes the defaults for subsequent lines', () => {
    const p = parseBoostPhrases('*:2::fa\nalpha\n*:3::s\nbeta');
    assert.deepEqual([p[0].weight, p[0].augment], [2, 'fa']);
    assert.deepEqual([p[1].weight, p[1].augment], [3, '']); // *:::s forces no augmentation
  });

  test('empty * fields keep the base default (only the set field applies)', () => {
    // *:::fa sets augment only; weight falls back to base 1, minp to the default.
    const p = parseBoostPhrases('*:::fa\nalpha');
    assert.deepEqual([p[0].weight, p[0].minp, p[0].augment], [1, DEFAULT_BOOST_MIN_P, 'fa']);
  });

  test('a bare * is a no-op defaults line (skipped, changes nothing)', () => {
    const p = parseBoostPhrases('*\nalpha');
    assert.ok(p.length === 1 && p[0].phrase === 'alpha' && p[0].weight === 1 && p[0].augment === undefined);
  });

  test('an out-of-range * weight is ignored, the prior default stands', () => {
    // *:99 is out of range so it is dropped (no warning poisoning every phrase);
    // the running default is unchanged, so alpha gets the base weight 1.
    const p = parseBoostPhrases('*:99\nalpha');
    assert.ok(p[0].weight === 1 && !p[0].warning);
  });

  test('per-phrase fields still override the * defaults', () => {
    const p = parseBoostPhrases('*:2::fa\nalpha:9::s');
    assert.deepEqual([p[0].weight, p[0].augment], [9, '']);
  });

  test('resolveBoostLines leaves weight/minp undefined with no * and no per-phrase field', () => {
    const r = resolveBoostLines(['alpha']);
    assert.deepEqual([r[0].phrase, r[0].weight, r[0].minp, r[0].augment], ['alpha', undefined, undefined, undefined]);
  });
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

  test('h => as-typed + symbol-stripped (hyphen -> space)', () => {
    assert.ok(eqArr(augmentVariants('alpha-methyl', 'h'), ['alpha-methyl', 'alpha methyl']));
  });
  test('h strips every symbol class (, . \' " - _ ? ! `)', () => {
    for (const sym of [',', '.', "'", '"', '-', '_', '?', '!', '`']) {
      const v = augmentVariants(`alpha${sym}methyl`, 'h');
      assert.ok(v.includes('alpha methyl'), `symbol "${sym}" not stripped to a space`);
    }
  });
  test('h collapses a run of mixed symbols to one space', () => {
    assert.ok(augmentVariants('co-trimoxazole/IV?', 'h').includes('co trimoxazole IV'));
  });
  test('h on a phrase with no symbols adds nothing (deduped)', () => {
    assert.ok(eqArr(augmentVariants('venlafaxine', 'h'), ['venlafaxine']));
  });
  test('h applies to each casing form (with a)', () => {
    const v = augmentVariants('alpha-methyl', 'ah');
    assert.ok(v.includes('alpha methyl') && v.includes('ALPHA METHYL'));
  });
  test('h runs before p so prefixes attach to the stripped form', () => {
    // "alpha methyl" is vowel-initial, so an elision prefix attaches to it.
    const v = augmentVariants('alpha-methyl', 'hp', ["l'"]);
    assert.ok(v.includes("l'alpha methyl"));
  });
  test('full faph set yields casing + symbol-stripped + prefixed forms', () => {
    const v = augmentVariants('alpha-methyl', 'faph', ["l'"]);
    assert.ok(v.includes('alpha-methyl') && v.includes('Alpha-methyl')
      && v.includes('ALPHA-METHYL') && v.includes('alpha methyl')
      && v.includes("l'alpha methyl"));
  });

  test('default off => no expansion', () => assert.equal(expandAugmentations([{ phrase: 'venlafaxine', weight: 5, minp: 0.3 }]).length, 1));
  const expanded = expandAugmentations([{ phrase: 'venlafaxine', weight: 5, minp: 0.3 }], 'fa');
  test('default fa => expands one entry into 3 forms', () => assert.equal(expanded.length, 3));
  test('expanded entries carry the original weight + minp', () => assert.ok(expanded.every(e => e.weight === 5 && e.minp === 0.3)));
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
  test('default minp carried on the bonus', () => assert.equal(trie.childBoostFor(ids[0]).minp, DEFAULT_BOOST_MIN_P));

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

test('min-p gating only boosts tokens the model finds plausible enough', () => {
  const V = fixture.id2token.length;
  const gateLogits = new Float32Array(V);
  // ids[0] sits 4 logits below the top token, i.e. exp(-4) ~= 1.83% as likely.
  gateLogits[100] = 5; gateLogits[ids[0]] = 1;
  // min-p 0.05 = "at least 5% as likely as the top": 1.83% < 5%, gated out.
  const strict = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, minp: 0.05 }], encoder, { strength: 1 });
  strict.reset();
  assert.equal(strict.applyBoost(gateLogits), null, 'candidate below the min-p ratio is gated out');
  assert.equal(gateLogits[ids[0]], 1, 'gated-out logit is untouched');
  // min-p 0.01 = "at least 1% as likely": 1.83% > 1%, boosted (by weight*1 = 5).
  const loose = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, minp: 0.01 }], encoder, { strength: 1 });
  loose.reset();
  const gateSaved = loose.applyBoost(gateLogits);
  assert.ok(Array.isArray(gateSaved) && gateLogits[ids[0]] === 6, 'candidate above the min-p ratio is boosted');
  loose.restore(gateLogits, gateSaved);
  assert.equal(gateLogits[ids[0]], 1, 'restore after gated boost');
});

test('min-p adapts to the per-frame max (entropy-aware): same logit, different gate', () => {
  // The whole point of min-p over a fixed top-k: the SAME candidate logit is
  // gated out on a confident (peaked) frame but boosted on a flat (uncertain)
  // one. log(0.05) ~= -3.0, so the gate admits ids[0] iff maxLogit - logit <= 3.
  const V = fixture.id2token.length;
  const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, minp: 0.05 }], encoder, { strength: 1 });

  const peaked = new Float32Array(V);
  peaked[100] = 10; peaked[ids[0]] = 1; // gap 9 >> 3: the model is confident elsewhere
  trie.reset();
  assert.equal(trie.applyBoost(peaked), null, 'on a confident frame the same logit is gated out');

  const flat = new Float32Array(V);
  flat[100] = 2; flat[ids[0]] = 1; // gap 1 < 3: the model is unsure, the term is plausible
  trie.reset();
  const saved = trie.applyBoost(flat);
  assert.ok(Array.isArray(saved) && flat[ids[0]] === 6, 'on a flat frame the same logit clears the gate');
});

test('minpOverride supersedes every per-phrase min-p (the grid-search sweep knob)', () => {
  const V = fixture.id2token.length;
  // The phrase bakes a strict gate (0.5 = "at least 50% as likely as the top"),
  // which would reject ids[0] at exp(-4) ~= 1.83% of the max.
  const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, minp: 0.5 }], encoder, { strength: 1 });
  const logits = new Float32Array(V);
  logits[100] = 5; logits[ids[0]] = 1;
  trie.reset();
  assert.equal(trie.applyBoost(logits), null, 'baked strict min-p gates the candidate out');
  // Override to a looser gate (0.01): now 1.83% > 1%, so it boosts despite the
  // baked 0.5, proving the override wins over both the per-node minp and minMinp.
  trie.minpOverride = 0.01;
  trie.reset();
  const saved = trie.applyBoost(logits);
  assert.ok(Array.isArray(saved) && logits[ids[0]] === 6, 'override loosens the gate and boosts');
  trie.restore(logits, saved);
  // And a stricter override can gate out a candidate the baked min-p would pass.
  const loose = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 5, minp: 0.01 }], encoder, { strength: 1 });
  loose.minpOverride = 0.5;
  loose.reset();
  assert.equal(loose.applyBoost(logits), null, 'a stricter override gates out what the baked min-p would pass');
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

describe('encodePhrases opts.cache (incremental re-encode)', () => {
  const entries = [
    { phrase: 'acetaminophen', weight: 1 },
    { phrase: '東京', weight: 2 },          // <unk>, must still be skipped via the cache
    { phrase: 'sœur', weight: 3 },
  ];
  // A spying encoder wrapper that counts encode() calls but delegates the real work.
  function spyEncoder() {
    let calls = 0;
    return {
      unkId: encoder.unkId,
      encode(text) { calls++; return encoder.encode(text); },
      get calls() { return calls; },
    };
  }

  test('cached result is identical to uncached', () => {
    const cache = new Map();
    const cold = encodePhrases(entries, encoder, { cache });
    const plain = encodePhrases(entries, encoder);
    assert.equal(cold.encoded.length, plain.encoded.length);
    assert.deepEqual(cold.skipped, plain.skipped);
    for (let i = 0; i < cold.encoded.length; i++) {
      assert.ok(eqArr(cold.encoded[i].ids, plain.encoded[i].ids));
      assert.equal(cold.encoded[i].weight, plain.encoded[i].weight);
    }
  });

  test('a warm rebuild re-encodes nothing (every variant served from cache)', () => {
    const cache = new Map();
    const spy = spyEncoder();
    encodePhrases(entries, spy, { cache });
    const afterCold = spy.calls;
    assert.equal(afterCold, entries.length, 'cold pass encodes every phrase once');
    encodePhrases(entries, spy, { cache });
    assert.equal(spy.calls, afterCold, 'warm pass must not call encode() again');
  });

  test('only a new/changed phrase is encoded on the next rebuild', () => {
    const cache = new Map();
    const spy = spyEncoder();
    encodePhrases(entries, spy, { cache });
    const afterCold = spy.calls;
    // Drop 'sœur', keep the rest, add one new phrase: only the new phrase encodes.
    const edited = [
      { phrase: 'acetaminophen', weight: 1 },
      { phrase: '東京', weight: 2 },
      { phrase: 'ibuprofen', weight: 4 },
    ];
    encodePhrases(edited, spy, { cache });
    assert.equal(spy.calls - afterCold, 1, 'only the newly added phrase is encoded');
  });

  test('the <unk> phrase is skipped consistently from the cache', () => {
    const cache = new Map();
    const warm = (() => { encodePhrases(entries, encoder, { cache }); return encodePhrases(entries, encoder, { cache }); })();
    assert.deepEqual(warm.skipped, ['東京']);
  });
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
