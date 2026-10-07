#!/usr/bin/env node
// Compile the UltiMed model repo's regex-fixes/ rule files (the hand-written
// rules, then the drug rules, then the medical-term rules) into the ONE committed
// app/ui/public/drug-rules/drug_rules.json the app serves (see
// app/ui/src/lib/drugRules.js for the format and why it is split in two).
// The term rules are meant to run after the drug rules, and one ordered list
// gives exactly that, so the app keeps a single "Drugs" layer.
//
//   node scripts/compile-drug-rules.mjs            # (re)compile from the model repo
//   node scripts/compile-drug-rules.mjs --check    # exit 1 unless in sync (deploy.sh)
//   node scripts/compile-drug-rules.mjs --source a.jsonl --source b.jsonl  # in order
//
// --check fails when a source no longer hashes to the sha256 recorded for it
// in the COMMITTED compiled file, or when the compiled file has uncommitted
// changes: the server pulls from git, so a compiled file that only exists in
// this working copy would not deploy.
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
const REPO = 'fallback_models/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';
const HF = 'https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx/blob/main';
const DEFAULT_SOURCES = ['regex-fixes/manual_fix_rules.jsonl', 'regex-fixes/drug_fix_rules.jsonl', 'regex-fixes/term_fix_rules.jsonl'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const given = args.flatMap((a, i) => (a === '--source' ? [resolve(args[i + 1])] : []));
const sources = given.length ? given : DEFAULT_SOURCES.map((f) => resolve(root, REPO, f));

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

for (const p of sources) if (!existsSync(p)) die(`source not found: ${p}`);
const texts = sources.map((p) => readFileSync(p, 'utf8'));
const shas = texts.map((t) => createHash('sha256').update(t).digest('hex'));
const outRel = relative(root, OUT);

if (check) {
  const committed = git(root, 'show', `HEAD:${outRel}`);
  if (committed === null) die(`${outRel} is not committed`);
  const recorded = (JSON.parse(committed).sources || []).map((s) => s.sha256);
  if (recorded.length !== shas.length || recorded.some((r, i) => r !== shas[i])) {
    die(`OUT OF SYNC: ${sources.map((p, i) => `${relative(root, p)} is sha256 ${shas[i]}`).join(', ')}; `
      + `the committed ${outRel} was compiled from ${recorded.join(', ') || 'nothing recorded'}.\n`
      + '  Run: node scripts/compile-drug-rules.mjs, then commit the result.');
  }
  if (git(root, 'status', '--porcelain', '--', outRel)) die(`${outRel} has uncommitted changes; commit it so the server gets it.`);
  console.log(`[drug-rules] in sync (${shas.map((h) => h.slice(0, 12)).join(', ')})`);
  process.exit(0);
}

const meta = sources.map((p, i) => {
  const dir = dirname(p);
  const commit = git(dir, 'log', '-1', '--format=%H', '--', p);
  const dirty = git(dir, 'status', '--porcelain', '--', p);
  if (dirty) console.warn(`[drug-rules] WARNING: ${relative(root, p)} has uncommitted changes in its repo.`);
  const rel = relative(resolve(root, REPO), p);
  return {
    source: rel.startsWith('..') ? relative(root, p) : `${HF}/${rel}`,
    commit: commit ? `${commit}${dirty ? ' (plus uncommitted changes)' : ''}` : 'unknown',
    sha256: shas[i],
  };
});
// Rule files are JSONL: joining them keeps every rule, in order.
const compiled = compileDrugRuleSource(texts.join('\n'), { sources: meta });
const out = serialize(compiled);
// Round-trip guard: what we write must load back with every rule.
const back = loadDrugRules(JSON.parse(out));
if (!back || back.rules.length !== compiled.rules.length) die('compiled file does not load back');
writeFileSync(OUT, out);
console.log(`[drug-rules] ${compiled.rules.length} rules (${compiled.skipped} skipped, ${compiled.always.length} unanchored) -> ${outRel}, ${(out.length / 1e6).toFixed(2)} MB`);
