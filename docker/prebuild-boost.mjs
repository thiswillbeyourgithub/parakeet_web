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
// expandCasingVariants + encodePhrases. Built with Claude Code.
//
// Usage:  node prebuild-boost.mjs <boostDir> <vocabPath> <mergesPath>

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseVocabText } from '../app/src/tokenizer.js';
import { BpeEncoder, buildVocabToId, vocabSignature } from '../app/src/bpeEncoder.js';
import { parseBoostPhrases, expandCasingVariants, encodePhrases } from '../app/src/phraseBoost.js';

// Casing-default baked into the prebuilt encoding. The browser turns casing
// expansion ON by default, so prebuilding at the same default lets it reuse
// these ids without re-encoding; it falls back to encoding the .txt itself when
// the user has flipped the global toggle the other way (caseDefault mismatch).
// Per-phrase `:s`/`:i` flags are honoured here regardless, exactly as in the UI.
const CASE_DEFAULT = true;

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
  const parsed = parseBoostPhrases(raw).filter(p => p.phrase);
  if (!parsed.length) {
    console.log(`[prebuild-boost] ${file}: no phrases, skipping.`);
    continue;
  }
  // Expand casings exactly as the browser will at CASE_DEFAULT, so the prebuilt
  // ids are reusable without a re-encode in the common (default) configuration.
  const entries = expandCasingVariants(parsed, CASE_DEFAULT);
  const t0 = Date.now();
  const { encoded, skipped } = encodePhrases(entries, encoder);
  const ms = Date.now() - t0;
  const outPath = join(boostDir, `${name}.json`);
  // `vocabSig` lets the browser confirm the prebuilt ids match the tokenizer it
  // actually loaded before trusting them; on a mismatch it re-encodes the .txt.
  // `caseDefault` records the expansion default these ids were built at.
  writeFileSync(outPath, JSON.stringify({ vocabSig: sig, caseDefault: CASE_DEFAULT, encoded, skipped }));
  const perLine = entries.length ? (ms / entries.length) : 0;
  console.log(
    `[prebuild-boost] ${file}: ${parsed.length} phrase(s) -> ${entries.length} after casing `
    + `expansion; encoded ${encoded.length} (${skipped.length} skipped) in ${ms}ms `
    + `(avg ${perLine.toFixed(3)}ms/line) -> ${name}.json`
  );
}

console.log('[prebuild-boost] done.');
