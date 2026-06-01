// Unit test for the phrase-boosting trie (app/src/phraseBoost.js) and its
// interaction with the BPE encoder. Validates phrase parsing, trie build/advance,
// the depth-scaled bonus map, and that applyBoost/restore flips a greedy argmax
// without permanently altering the logits.
//
// Run from the repo root:  node scripts/test-phrase-boost.mjs
// Requires python with tokenizers + huggingface_hub (for the vocab fixture).
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpeEncoder, buildVocabToId } from '../app/src/bpeEncoder.js';
import { BoostingTrie, parseBoostPhrases, MAX_PHRASE_WEIGHT } from '../app/src/phraseBoost.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asset = JSON.parse(readFileSync(resolve(root, 'app/ui/public/tokenizer/bpe-merges.json'), 'utf-8'));
const fixture = JSON.parse(
  execFileSync('python', [resolve(root, 'scripts/gen-bpe-fixture.py')], {
    maxBuffer: 256 * 1024 * 1024, encoding: 'utf-8',
  }),
);
const encoder = new BpeEncoder(asset, buildVocabToId(fixture.id2token));

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { console.log(`FAIL  ${name}`); failures++; }
}
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- parseBoostPhrases ---------------------------------------------------
console.log('parseBoostPhrases:');
const parsed = parseBoostPhrases(
  'acetaminophen\nibuprofen:2.5\n  spaced phrase  \nfoo:99\n\nratio 3:1\n:0.5\nbad:abc',
);
check('default weight 1', parsed[0].phrase === 'acetaminophen' && parsed[0].weight === 1);
check('explicit weight 2.5', parsed[1].phrase === 'ibuprofen' && parsed[1].weight === 2.5);
check('trims whitespace', parsed[2].phrase === 'spaced phrase' && parsed[2].weight === 1);
check('out-of-range weight clamped + warning', parsed[3].phrase === 'foo' && parsed[3].weight === 1 && !!parsed[3].warning);
check('trailing :num is a weight (documented)', parsed[4].phrase === 'ratio 3' && parsed[4].weight === 1);
check('empty phrase before colon keeps whole line', parsed[5].phrase === ':0.5');
check('non-numeric tail is not a weight', parsed[6].phrase === 'bad:abc' && parsed[6].weight === 1);
check('skips blank lines', parsed.length === 7);

// --- trie build + advance + bonus map ------------------------------------
console.log('BoostingTrie:');
const ids = encoder.encode('acetaminophen'); // [691,291,316,281,669,1722]
const trie = BoostingTrie.buildFromPhrases([{ phrase: 'acetaminophen', weight: 2 }], encoder, { strength: 1, depthScaling: 0.5 });
check('non-empty after build', !trie.isEmpty && trie.size === 1);

trie.reset();
let boosts = trie.activeChildBoosts();
check('root boosts only first token', boosts.size === 1 && boosts.has(ids[0]));
check('depth-1 bonus = weight*(1+0.5*0) = 2', boosts.get(ids[0]) === 2);

trie.advance(ids[0]);
boosts = trie.activeChildBoosts();
check('after advance: second token boosted', boosts.has(ids[1]));
check('depth-2 bonus = weight*(1+0.5*1) = 3', boosts.get(ids[1]) === 3);
check('root still active: first token also boosted', boosts.get(ids[0]) === 2);

trie.advance(999999); // a token not in any phrase
boosts = trie.activeChildBoosts();
check('mismatch drops to root only', boosts.size === 1 && boosts.get(ids[0]) === 2);

// --- applyBoost / restore flips argmax, then restores --------------------
console.log('applyBoost / restore:');
const V = fixture.id2token.length;
const logits = new Float32Array(V); // all zero
logits[5] = 1.0;        // some other token is the unboosted winner
trie.reset();           // first phrase token (ids[0]) is now boostable
const before = logits[ids[0]];
const argmaxOf = (arr) => { let m = -Infinity, mi = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) { m = arr[i]; mi = i; } return mi; };
check('unboosted argmax is token 5', argmaxOf(logits) === 5);
const saved = trie.applyBoost(logits); // strength 1 * bonus 2 => logits[ids[0]] = 2
check('applyBoost returned saved pairs', Array.isArray(saved) && saved.length === 2);
check('boosted argmax is the phrase token', argmaxOf(logits) === ids[0]);
trie.restore(logits, saved);
check('restore returns original value', logits[ids[0]] === before);
check('argmax back to token 5 after restore', argmaxOf(logits) === 5);

// strength 0 disables boosting entirely
trie.strength = 0;
check('strength 0 => applyBoost is a no-op', trie.applyBoost(logits) === null);

// --- OOV (<unk>) phrases are skipped, not inserted -----------------------
console.log('skip <unk> phrases:');
check('東京 encodes to <unk>', encoder.encode('東京').includes(encoder.unkId));
const mixedTrie = BoostingTrie.buildFromPhrases(
  [{ phrase: 'acetaminophen', weight: 1 }, { phrase: '東京', weight: 1 }, { phrase: 'sœur', weight: 1 }],
  encoder,
);
check('clean Latin phrases inserted (accents + œ ligature)', mixedTrie.size === 2);
check('CJK phrase recorded as skipped', eqArr(mixedTrie.skipped, ['東京']));
check('skipped phrase is not boostable', !mixedTrie.root.children.has(encoder.unkId));

console.log(`\n${failures === 0 ? 'PASS' : failures + ' FAILED'}`);
process.exit(failures ? 1 : 0);
