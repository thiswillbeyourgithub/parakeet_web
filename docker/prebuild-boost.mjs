// Server-side phrase-boost prebuild.
//
// Encoding a boost-phrase list to token-id sequences (the BPE merge loop, once
// per phrase) is the only expensive part of building the BoostingTrie, and a
// large clinical list can be 10k-100k phrases. When the operator ships such
// lists (BOOST_PHRASES_SOURCE -> /var/boost/*.txt) AND the model vocab is on
// disk (local-model deployments), we do that encode once at container boot
// instead of in every visitor's browser. This script reads the local vocab.txt
// plus the bundled BPE merges, encodes each /var/boost/*.txt to a sibling
// <name>.json, and Caddy serves it next to the .txt. The browser fetches the
// .json and, when its vocab signature matches the tokenizer it loaded, builds
// the trie directly with no BPE work (see App.jsx). If the vocab is absent
// (pure-HF deployment) the script exits 0 without writing anything and the
// browser falls back to encoding the .txt itself, exactly as before.
//
// Precompiled .pwc cache: that boot-time encode still runs on EVERY container
// start. An operator can avoid it by running scripts/compile-boost.mjs ahead of
// time to produce a sibling <name>.pwc and shipping it next to the .txt. When a
// .pwc is present and its vocab signature matches the model loaded here, this
// script reuses its ids (decompresses the gzip .pwc via readPwc, then writes a
// plain <name>.json for the browser, no encode); on any mismatch it falls back
// to encoding the .txt, so a stale .pwc is never wrong, only ignored.
//
// Reuses the shared compile pipeline (no duplicated tokenization rules); see
// app/src/boostCompile.js. Built with Claude Code.
//
// Usage:  node prebuild-boost.mjs <boostDir> <vocabPath> <mergesPath>

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  loadBoostEncoder,
  compileBoostText,
  isReusableArtifact,
  effectiveAugmentDefault,
  readPwc,
  AUGMENT_DEFAULT,
} from '../app/src/boostCompile.js';

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

const { encoder, vocabSig, tokenCount } = loadBoostEncoder(vocabPath, mergesPath);

const txtFiles = readdirSync(boostDir).filter((f) => f.endsWith('.txt'));
if (!txtFiles.length) {
  console.log(`[prebuild-boost] no .txt lists in ${boostDir}; nothing to prebuild.`);
  process.exit(0);
}

console.log(`[prebuild-boost] vocab ${tokenCount} tokens (sig ${vocabSig}); ${txtFiles.length} list(s) to process.`);

for (const file of txtFiles) {
  const name = basename(file, '.txt');
  const outPath = join(boostDir, `${name}.json`);
  const pwcPath = join(boostDir, `${name}.pwc`);

  const raw = readFileSync(join(boostDir, file), 'utf-8');
  // The list's own `#!augment` directive (if any) sets the augmentation it must
  // be expanded at, so the reuse check below compares the .pwc against the same
  // default that compileBoostText would bake; otherwise a directive list would
  // never match its own .pwc and re-encode every boot.
  const wantAugment = effectiveAugmentDefault(raw, AUGMENT_DEFAULT);

  // Reuse a sibling precompiled .pwc when it matches this model's vocab, so the
  // operator who ran scripts/compile-boost.mjs ahead of time skips the encode
  // entirely at boot. Any mismatch falls through to encoding the .txt below.
  if (existsSync(pwcPath)) {
    let artifact = null;
    try {
      artifact = readPwc(pwcPath);
    } catch (e) {
      console.log(`[prebuild-boost] ${name}.pwc is unparseable (${e.message}); re-encoding ${file}.`);
    }
    if (artifact && isReusableArtifact(artifact, vocabSig, wantAugment)) {
      writeFileSync(outPath, JSON.stringify(artifact));
      console.log(
        `[prebuild-boost] ${file}: reused precompiled ${name}.pwc `
        + `(${artifact.encoded.length} encoded, ${artifact.skipped?.length ?? 0} skipped) `
        + `-> ${name}.json (no encode).`
      );
      continue;
    }
    if (artifact) {
      console.log(`[prebuild-boost] ${name}.pwc does not match this model's vocab/format; re-encoding ${file}.`);
    }
  }

  const t0 = Date.now();
  const { artifact, parsedCount, expandedCount } = compileBoostText(raw, encoder, vocabSig);
  const ms = Date.now() - t0;
  if (!parsedCount) {
    console.log(`[prebuild-boost] ${file}: no phrases, skipping.`);
    continue;
  }
  writeFileSync(outPath, JSON.stringify(artifact));
  const perLine = expandedCount ? (ms / expandedCount) : 0;
  console.log(
    `[prebuild-boost] ${file}: ${parsedCount} phrase(s) -> ${expandedCount} after casing `
    + `expansion; encoded ${artifact.encoded.length} (${artifact.skipped.length} skipped) in ${ms}ms `
    + `(avg ${perLine.toFixed(3)}ms/line) -> ${name}.json`
  );
}

console.log('[prebuild-boost] done.');
