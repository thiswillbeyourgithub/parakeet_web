// Server-side phrase-boost prebuild.
//
// Encoding a boost-phrase list to token-id sequences (the BPE merge loop, once
// per phrase) is the only expensive part of building the BoostingTrie, and a
// large clinical list can be 10k-100k phrases. When the operator ships such
// lists (BOOST_PHRASES_SOURCE -> /var/boost/*.txt) AND the model vocab is on
// disk (local-model deployments), we can do that encode once at container boot
// instead of in every visitor's browser. This script reads the local vocab.txt
// plus the bundled BPE merges, encodes each /var/boost/*.txt to a sibling
// <name>.json, and Caddy serves it next to the .txt. The browser fetches the
// .json and, when its vocab signature matches the tokenizer it loaded, builds
// the trie directly with no BPE work (see App.jsx). If the vocab is absent
// (pure-HF deployment) the script exits 0 without writing anything and the
// browser falls back to encoding the .txt itself, exactly as before.
//
// Reuses the exact browser code paths (no duplicated tokenization rules):
// parseVocabText + vocabSignature + BpeEncoder + parseBoostPhrases +
// encodePhrases. Built with Claude Code.
//
// Usage:  node prebuild-boost.mjs <boostDir> <vocabPath> <mergesPath>

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseVocabText } from '../app/src/tokenizer.js';
import { BpeEncoder, buildVocabToId, vocabSignature } from '../app/src/bpeEncoder.js';
import { parseBoostPhrases, encodePhrases } from '../app/src/phraseBoost.js';

const [boostDir, vocabPath, mergesPath] = process.argv.slice(2);

function fail(msg) {
  console.error(`[prebuild-boost] ${msg}`);
  process.exit(1);
}

if (!boostDir || !vocabPath || !mergesPath) {
  fail('usage: node prebuild-boost.mjs <boostDir> <vocabPath> <mergesPath>');
}

// No local vocab (pure-HF deployment): nothing to prebuild. Exit clean so the
// browser keeps encoding the .txt itself.
if (!existsSync(vocabPath)) {
  console.log(`[prebuild-boost] no local vocab at ${vocabPath}; skipping prebuild (browser will encode).`);
  process.exit(0);
}
if (!existsSync(boostDir)) {
  console.log(`[prebuild-boost] no boost dir at ${boostDir}; nothing to prebuild.`);
  process.exit(0);
}
if (!existsSync(mergesPath)) {
  // The merges asset ships in the image, so a miss here is a real packaging
  // bug, not an operator choice: fail loudly rather than silently degrade.
  fail(`BPE merges asset not found at ${mergesPath} (expected to ship in the image).`);
}

const id2token = parseVocabText(readFileSync(vocabPath, 'utf-8'));
if (!id2token.length) fail(`vocab at ${vocabPath} parsed to 0 tokens.`);
const sig = vocabSignature(id2token);
const asset = JSON.parse(readFileSync(mergesPath, 'utf-8'));
const encoder = new BpeEncoder(asset, buildVocabToId(id2token));

const txtFiles = readdirSync(boostDir).filter(f => f.endsWith('.txt'));
if (!txtFiles.length) {
  console.log(`[prebuild-boost] no .txt lists in ${boostDir}; nothing to prebuild.`);
  process.exit(0);
}

console.log(`[prebuild-boost] vocab ${id2token.length} tokens (sig ${sig}); ${txtFiles.length} list(s) to encode.`);

for (const file of txtFiles) {
  const name = basename(file, '.txt');
  const raw = readFileSync(join(boostDir, file), 'utf-8');
  const entries = parseBoostPhrases(raw).filter(p => p.phrase);
  if (!entries.length) {
    console.log(`[prebuild-boost] ${file}: no phrases, skipping.`);
    continue;
  }
  const t0 = Date.now();
  const { encoded, skipped } = encodePhrases(entries, encoder);
  const ms = Date.now() - t0;
  const outPath = join(boostDir, `${name}.json`);
  // `vocabSig` lets the browser confirm the prebuilt ids match the tokenizer it
  // actually loaded before trusting them; on a mismatch it re-encodes the .txt.
  writeFileSync(outPath, JSON.stringify({ vocabSig: sig, encoded, skipped }));
  const perLine = entries.length ? (ms / entries.length) : 0;
  console.log(
    `[prebuild-boost] ${file}: encoded ${encoded.length}/${entries.length} phrase(s) `
    + `(${skipped.length} skipped) in ${ms}ms (avg ${perLine.toFixed(3)}ms/line) -> ${name}.json`
  );
}

console.log('[prebuild-boost] done.');
