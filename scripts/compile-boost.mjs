#!/usr/bin/env node
// Compile a phrase-boost .txt list into a .pwc (parakeet-web-compiled) artifact,
// so the production container can skip re-encoding the list on every boot. The
// .pwc is gzip-compressed JSON (written via writePwc); it is read back only by
// Node, never fetched by a browser, so compressing it just shrinks what the
// operator ships.
//
// Background: when an operator ships boost lists via BOOST_PHRASES_SOURCE and
// the model vocab is on disk, the container pre-encodes each list to token ids
// at startup (docker/prebuild-boost.mjs). That encode (the per-phrase BPE merge
// loop) is the only expensive part, and for a 10k-100k clinical list it runs on
// EVERY container start. Running this script once, ahead of time, writes a
// <name>.pwc next to <name>.txt; ship the .pwc alongside the .txt in your
// BOOST_PHRASES_SOURCE folder and the container reuses it verbatim at boot
// (no encode) whenever the .pwc's vocab signature matches the model's vocab.txt.
//
// A .pwc is pinned to the exact vocab it was built against, so compile it
// against the SAME model folder you deploy (the one you bind-mount at
// LOCAL_MODEL_PATH). If the vocab ever differs, the container silently ignores
// the stale .pwc and re-encodes the .txt, exactly as before: a mismatched .pwc
// is never wrong, only skipped.
//
// Reuses the shared compile pipeline in app/src/boostCompile.js, so the ids it
// emits are identical to what the container and the browser would produce.
// Built with Claude Code.
//
// Usage:
//   node scripts/compile-boost.mjs LIST.txt [LIST2.txt ...] --model-dir DIR
//   node scripts/compile-boost.mjs LIST.txt --vocab /path/to/vocab.txt
//
// Options:
//   --model-dir DIR   Model folder containing vocab.txt (e.g. your
//                     LOCAL_MODEL_PATH bind-mount). vocab.txt is read from here.
//   --vocab PATH      Path to vocab.txt directly (alternative to --model-dir).
//   --merges PATH     bpe-merges.json to use. Defaults to the bundled
//                     app/ui/public/tokenizer/bpe-merges.json.
//   -o, --out PATH    Output path for a SINGLE input (default: LIST.pwc next to
//                     the input). Ignored for multiple inputs.
//   -h, --help        Show this help.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBoostEncoder, compileBoostText, writePwc } from '../app/src/boostCompile.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MERGES = join(ROOT, 'app/ui/public/tokenizer/bpe-merges.json');

function usage() {
  console.log(`Compile a phrase-boost .txt list into a .pwc artifact.

Usage:
  node scripts/compile-boost.mjs LIST.txt [LIST2.txt ...] --model-dir DIR
  node scripts/compile-boost.mjs LIST.txt --vocab /path/to/vocab.txt

Options:
  --model-dir DIR   Model folder containing vocab.txt (e.g. your LOCAL_MODEL_PATH).
  --vocab PATH      Path to vocab.txt directly (alternative to --model-dir).
  --merges PATH     bpe-merges.json to use (default: bundled tokenizer asset).
  -o, --out PATH    Output path for a SINGLE input (default: LIST.pwc next to it).
  -h, --help        Show this help.

Ship the resulting .pwc next to its .txt in your BOOST_PHRASES_SOURCE folder.
The container reuses it at boot (no re-encode) when the model's vocab matches.`);
}

function parseArgs(argv) {
  const inputs = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const need = (name) => {
      if (i + 1 >= argv.length) { console.error(`Missing value for ${name}`); process.exit(2); }
      return argv[++i];
    };
    switch (arg) {
      case '-h': case '--help': opts.help = true; break;
      case '--model-dir': opts.modelDir = need(arg); break;
      case '--vocab': opts.vocab = need(arg); break;
      case '--merges': opts.merges = need(arg); break;
      case '-o': case '--out': opts.out = need(arg); break;
      default:
        if (arg.startsWith('-')) { console.error(`Unknown option: ${arg}`); process.exit(2); }
        inputs.push(arg);
    }
  }
  return { inputs, opts };
}

function resolveVocab(opts) {
  if (opts.vocab) {
    if (!existsSync(opts.vocab)) { console.error(`--vocab not found: ${opts.vocab}`); process.exit(1); }
    return opts.vocab;
  }
  if (opts.modelDir) {
    const v = join(opts.modelDir, 'vocab.txt');
    if (!existsSync(v)) { console.error(`vocab.txt not found in --model-dir: ${opts.modelDir}`); process.exit(1); }
    return v;
  }
  console.error('Provide --model-dir DIR (with vocab.txt) or --vocab PATH. See --help.');
  process.exit(2);
}

const { inputs, opts } = parseArgs(process.argv.slice(2));
if (opts.help || !inputs.length) { usage(); process.exit(opts.help ? 0 : 2); }
if (opts.out && inputs.length > 1) {
  console.error('-o/--out is only valid with a single input list.');
  process.exit(2);
}

const vocabPath = resolveVocab(opts);
const mergesPath = opts.merges || DEFAULT_MERGES;
if (!existsSync(mergesPath)) { console.error(`merges file not found: ${mergesPath}`); process.exit(1); }

const { encoder, vocabSig, tokenCount } = loadBoostEncoder(vocabPath, mergesPath);
console.log(`[compile-boost] vocab ${tokenCount} tokens (sig ${vocabSig}) from ${vocabPath}`);

let failures = 0;
for (const input of inputs) {
  if (!existsSync(input) || !statSync(input).isFile()) {
    console.error(`[compile-boost] not a file, skipping: ${input}`);
    failures++;
    continue;
  }
  const outPath = opts.out || (input.replace(/\.txt$/i, '') + '.pwc');
  const raw = readFileSync(input, 'utf-8');
  const t0 = Date.now();
  const { artifact, parsedCount, expandedCount } = compileBoostText(raw, encoder, vocabSig);
  const ms = Date.now() - t0;
  if (!parsedCount) {
    console.error(`[compile-boost] ${input}: no phrases found, not writing ${outPath}.`);
    failures++;
    continue;
  }
  writePwc(outPath, artifact);
  const perLine = expandedCount ? (ms / expandedCount) : 0;
  console.log(
    `[compile-boost] ${input}: ${parsedCount} phrase(s) -> ${expandedCount} after casing `
    + `expansion; encoded ${artifact.encoded.length} (${artifact.skipped.length} skipped) in ${ms}ms `
    + `(avg ${perLine.toFixed(3)}ms/line) -> ${outPath}`
  );
}

if (failures) process.exit(1);
console.log('[compile-boost] done.');
