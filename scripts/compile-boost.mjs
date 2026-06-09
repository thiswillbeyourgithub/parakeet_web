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

// How many entries of a warning list to print before truncating with a
// "...and N more" tail. The web UI shows the full list in a scrollable box; a
// CLI log must not flood the terminal for a 100k-line clinical list, but the
// admin still needs the first offenders by name (a bare count tells them
// nothing about WHICH terms are wrong).
const WARN_LIST_CAP = 20;

// Print a non-fatal warning block to stderr: a header plus up to WARN_LIST_CAP
// item lines, truncated with a count tail. Empty lists print nothing.
function printWarnBlock(header, items, format) {
  if (!items.length) return;
  console.error(`[compile-boost] WARNING: ${header}`);
  for (const item of items.slice(0, WARN_LIST_CAP)) console.error(`    - ${format(item)}`);
  if (items.length > WARN_LIST_CAP) console.error(`    ... and ${items.length - WARN_LIST_CAP} more`);
}

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

// Minimal in-place progress bar for the encode loop. Only draws to a TTY (so
// piped/CI logs stay clean) and throttles redraws to ~50ms so a 100k-line list
// does not spend its time writing to the terminal. Returns a render(done,total)
// callback plus a done() to finish the line.
function makeProgressBar(label) {
  const tty = process.stderr.isTTY;
  let last = 0;
  const draw = (done, total, force) => {
    if (!tty) return;
    const now = Date.now();
    if (!force && now - last < 50) return;
    last = now;
    const frac = total ? done / total : 1;
    const width = 30;
    const filled = Math.round(frac * width);
    const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
    process.stderr.write(`\r${label} [${bar}] ${done}/${total} (${(frac * 100).toFixed(0)}%)`);
  };
  return {
    render: (done, total) => draw(done, total, false),
    done: (done, total) => { draw(done, total, true); if (tty) process.stderr.write('\n'); },
  };
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
  let compiled;
  const bar = makeProgressBar(`[compile-boost] encoding ${input}`);
  let lastTotal = 0;
  try {
    compiled = compileBoostText(raw, encoder, vocabSig, {
      onProgress: (done, total) => { lastTotal = total; bar.render(done, total); },
    });
    if (lastTotal) bar.done(lastTotal, lastTotal);
  } catch (e) {
    // An inconsistent list (BoostConflictError) is the admin's bug, not a
    // transient: fail this file loudly with the conflict list and a non-zero
    // exit, but keep going so every bad list in the batch is reported at once.
    console.error(`[compile-boost] ${input}: ${e.message}`);
    failures++;
    continue;
  }
  const { artifact, parsedCount, expandedCount, warnings } = compiled;
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
  // Surface the same non-fatal issues the web UI flags in its sidebar, so a
  // clean exit no longer hides them from the admin who ran this. (Conflicts,
  // the third UI warning, are fatal here and already threw above.) Both are
  // non-fatal: the .pwc is written and the batch's exit code is unaffected.
  printWarnBlock(
    `${input}: ${warnings.length} phrase(s) had an out-of-range weight or invalid min-p, reset to a default:`,
    warnings,
    (w) => `"${w.phrase}": ${w.warning}`,
  );
  printWarnBlock(
    `${input}: ${artifact.skipped.length} phrase(s) dropped (encode to <unk>, e.g. CJK/scripts absent from the model vocab; cannot ever be boosted):`,
    artifact.skipped,
    (ph) => `"${ph}"`,
  );
}

if (failures) process.exit(1);
console.log('[compile-boost] done.');
