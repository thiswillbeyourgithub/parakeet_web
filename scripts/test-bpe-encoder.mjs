// Cross-check the JS BPE encoder against the real HuggingFace `tokenizers`
// library. The fixture (ground-truth ids + the app's id2token table) is produced
// by scripts/gen-bpe-fixture.py, which this script invokes.
//
// Run from the repo root:  node scripts/test-bpe-encoder.mjs
// Requires python with: pip install tokenizers huggingface_hub
//
// Exits non-zero if any phrase encodes to a different id sequence than HF.
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpeEncoder, buildVocabToId } from '../app/src/bpeEncoder.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const asset = JSON.parse(
  readFileSync(resolve(root, 'app/ui/public/tokenizer/bpe-merges.json'), 'utf-8'),
);

console.log('Generating HuggingFace ground-truth fixture (python)...');
const fixtureRaw = execFileSync('python', [resolve(root, 'scripts/gen-bpe-fixture.py')], {
  maxBuffer: 256 * 1024 * 1024,
  encoding: 'utf-8',
});
const fixture = JSON.parse(fixtureRaw);

const enc = new BpeEncoder(asset, buildVocabToId(fixture.id2token));

let pass = 0;
const failures = [];
for (const { text, ids: expected } of fixture.cases) {
  const got = enc.encode(text);
  if (got.length === expected.length && got.every((v, i) => v === expected[i])) {
    pass++;
  } else {
    failures.push({ text, expected, got });
  }
}

const id2token = fixture.id2token;
const toks = (ids) => ids.map((i) => id2token[i] ?? `?${i}`).join('|');

for (const f of failures) {
  console.log(`\nMISMATCH ${JSON.stringify(f.text)}`);
  console.log(`  expected ${JSON.stringify(f.expected)}  ${toks(f.expected)}`);
  console.log(`  got      ${JSON.stringify(f.got)}  ${toks(f.got)}`);
}

console.log(`\n${pass}/${fixture.cases.length} phrases match HuggingFace.`);
if (failures.length) {
  console.log(`${failures.length} FAILED.`);
  process.exit(1);
}
console.log('All phrases match. PASS.');
