#!/usr/bin/env node
// Compile the UltiMed model repo's drug_fix_rules.jsonl into the committed
// app/ui/public/drug-rules/drug_rules.json the app serves (see
// app/ui/src/lib/drugRules.js for the format and why it is split in two).
//
//   node scripts/compile-drug-rules.mjs            # (re)compile from the model repo
//   node scripts/compile-drug-rules.mjs --check    # exit 1 unless in sync (deploy.sh)
//   node scripts/compile-drug-rules.mjs --source path/to/drug_fix_rules.jsonl
//
// --check fails when the model repo's rules no longer hash to the
// source_sha256 recorded in the COMMITTED compiled file, or when the compiled
// file has uncommitted changes: the server pulls from git, so a compiled file
// that only exists in this working copy would not deploy.
//
// Built with Claude Code.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDrugRuleSource, loadDrugRules } from '../app/ui/src/lib/drugRules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'app/ui/public/drug-rules/drug_rules.json');
const DEFAULT_SOURCE = resolve(root, 'fallback_models/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx/regex-fixes/drug_fix_rules.jsonl');

const args = process.argv.slice(2);
const check = args.includes('--check');
const si = args.indexOf('--source');
const source = si >= 0 ? resolve(args[si + 1]) : DEFAULT_SOURCE;

function die(msg) {
  console.error(`[drug-rules] ${msg}`);
  process.exit(1);
}

// One rule / anchor per line, so a rule refresh diffs readably in git.
function serialize(c) {
  const { rules, anchors, always, ...header } = c;
  const head = Object.entries(header).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`);
  return [
    '{',
    ...head,
    '"rules":[',
    rules.map((r) => JSON.stringify(r)).join(',\n'),
    '],',
    '"anchors":{',
    Object.entries(anchors).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'),
    '},',
    `"always":${JSON.stringify(always)}`,
    '}',
    '',
  ].join('\n');
}

const git = (cwd, ...a) => {
  try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; }
};

if (!existsSync(source)) die(`source not found: ${source}`);
const text = readFileSync(source, 'utf8');
const sha = createHash('sha256').update(text).digest('hex');
const outRel = relative(root, OUT);

if (check) {
  const committed = git(root, 'show', `HEAD:${outRel}`);
  if (committed === null) die(`${outRel} is not committed`);
  const recorded = JSON.parse(committed).source_sha256;
  if (recorded !== sha) {
    die(`OUT OF SYNC: ${relative(root, source)} is sha256 ${sha}, but the committed ${outRel} was compiled from ${recorded}.\n`
      + '  Run: node scripts/compile-drug-rules.mjs, then commit the result.');
  }
  if (git(root, 'status', '--porcelain', '--', outRel)) die(`${outRel} has uncommitted changes; commit it so the server gets it.`);
  console.log(`[drug-rules] in sync (${sha.slice(0, 12)})`);
  process.exit(0);
}

const srcDir = dirname(source);
const commit = git(srcDir, 'log', '-1', '--format=%H', '--', source);
const dirty = git(srcDir, 'status', '--porcelain', '--', source);
const compiled = compileDrugRuleSource(text, {
  source: 'https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx/blob/main/regex-fixes/drug_fix_rules.jsonl',
  source_commit: commit ? `${commit}${dirty ? ' (plus uncommitted changes)' : ''}` : 'unknown',
  source_sha256: sha,
});
const out = serialize(compiled);
// Round-trip guard: what we write must load back with every rule.
const back = loadDrugRules(JSON.parse(out));
if (!back || back.rules.length !== compiled.rules.length) die('compiled file does not load back');
writeFileSync(OUT, out);
console.log(`[drug-rules] ${compiled.rules.length} rules (${compiled.skipped} skipped, ${compiled.always.length} unanchored) -> ${outRel}, ${(out.length / 1e6).toFixed(2)} MB`);
if (dirty) console.warn('[drug-rules] WARNING: the source has uncommitted changes in the model repo.');
