#!/usr/bin/env node
// Offline analysis for the confidence-gated selective beam experiment.
//
// Idea under test: decode every utterance greedy first (cheap), then re-decode
// beam ONLY where greedy was unsure, reusing the cached encoder output so the
// extra cost is decode-only. If beam's accuracy wins concentrate where greedy
// is unsure, a small beamed fraction should buy most of beam's WER gain.
//
// Input is a scripts/grid_search_benchmark.mjs JSONL holding a greedy cell run
// with --record-confidences (per-token softmax confidences in "tokenConfs") and
// at least one beam cell over the SAME utterances. Nothing is decoded here: the
// greedy and beam transcripts of every utterance already exist, so gating at
// any threshold is just choosing, per utterance, which of the two to score.
// That makes the whole threshold sweep free and exactly what a live gate would
// output (beam on cached encoder output is deterministic).
//
// Gating is expressed as "beam the least-confident X% of utterances" rather
// than as a raw threshold, so features with different scales compare on the
// same axis and the random-gate baseline is trivial: a gate that knows nothing
// recovers X% of beam's gain at X% of its extra cost. A useful feature sits
// well above that diagonal.
//
//   node scripts/selective-beam-analyze.mjs --jsonl results.jsonl [--beam 8]
//
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Confidence features, each oriented so LOWER = less confident = beam first.
// min and meanLog grow more pessimistic with utterance length (more tokens,
// more chances for one bad one); the fracAbove ones are length-invariant, which
// matters for the app's 60 s chunks.
export const FEATURES = {
  min: (c) => (c.length ? Math.min(...c) : 1),
  meanLog: (c) => (c.length ? c.reduce((a, x) => a + Math.log(Math.max(x, 1e-10)), 0) / c.length : 0),
  fracAbove90: (c) => (c.length ? c.filter((x) => x >= 0.9).length / c.length : 1),
  fracAbove50: (c) => (c.length ? c.filter((x) => x >= 0.5).length / c.length : 1),
};

// Pair each greedy utterance (beam 1, carrying tokenConfs) with the same
// utterance's beam-`beam` record. Keyed by dataset + audio so a file reused
// across manifests stays distinct. Utterances missing either side are dropped.
export function pairRecords(records, beam) {
  const key = (r) => `${r.dataset}\u0000${r.audio}`;
  const greedy = new Map();
  for (const r of records) {
    if (r.type === 'utterance' && r.beam === 1 && Array.isArray(r.tokenConfs)) greedy.set(key(r), r);
  }
  const pairs = [];
  for (const r of records) {
    if (r.type !== 'utterance' || r.beam !== beam) continue;
    const g = greedy.get(key(r));
    if (g) pairs.push({ dataset: r.dataset, greedy: g, beam: r });
  }
  return pairs;
}

const rate = (edits, total) => (total ? (100 * edits) / total : 0);

// Score one gating: `useBeam[i]` picks pair i's beam record over its greedy one.
// WER/CER are micro-averaged (summed edits over summed reference length), and
// cost is decode time relative to always-beam: greedy runs on everything, beam
// only where gated.
export function scoreGate(pairs, useBeam) {
  let we = 0, rw = 0, ce = 0, rc = 0, ms = 0, beamMs = 0, n = 0;
  pairs.forEach((p, i) => {
    const r = useBeam[i] ? p.beam : p.greedy;
    we += r.wordEdits; rw += r.refWords; ce += r.charEdits; rc += r.refChars;
    ms += p.greedy.metrics?.decode_ms ?? 0;
    if (useBeam[i]) { ms += p.beam.metrics?.decode_ms ?? 0; n++; }
    beamMs += p.beam.metrics?.decode_ms ?? 0;
  });
  return { wer: rate(we, rw), cer: rate(ce, rc), beamed: pairs.length ? n / pairs.length : 0, cost: beamMs ? ms / beamMs : 0 };
}

// Sweep "beam the least-confident fraction f" for each f, ranking by `feature`
// (stable, so ties keep input order). `recovered` is the share of beam's WER
// gain over greedy that the gate keeps (1 = all of it, null when beam does not
// beat greedy at all, where the ratio means nothing).
export function sweep(pairs, feature, fractions) {
  const vals = pairs.map((p) => FEATURES[feature](p.greedy.tokenConfs));
  const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
  const greedy = scoreGate(pairs, pairs.map(() => false));
  const beam = scoreGate(pairs, pairs.map(() => true));
  const gain = greedy.wer - beam.wer;
  return fractions.map((f) => {
    const k = Math.round(f * pairs.length);
    const useBeam = new Array(pairs.length).fill(false);
    for (let j = 0; j < k; j++) useBeam[order[j]] = true;
    const s = scoreGate(pairs, useBeam);
    return { fraction: f, threshold: k ? vals[order[k - 1]] : null, ...s, recovered: gain > 0 ? (greedy.wer - s.wer) / gain : null };
  });
}

function parseArgs(argv) {
  const a = { jsonl: null, beam: null, fractions: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1] };
  for (let i = 0; i < argv.length; i++) {
    const v = () => { if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`); return argv[++i]; };
    switch (argv[i]) {
      case '--jsonl': a.jsonl = v(); break;
      case '--beam': a.beam = parseInt(v(), 10); break;
      case '--fractions': a.fractions = v().split(',').map(Number); break;
      default: throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  if (!a.jsonl) throw new Error('--jsonl is required');
  return a;
}

const pct = (x) => (x == null ? '-' : `${(100 * x).toFixed(0)}%`);

function table(pairs, feature, fractions) {
  const rows = sweep(pairs, feature, fractions);
  const out = ['| beamed | threshold | WER % | CER % | decode cost vs always-beam | gain recovered |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    out.push(`| ${pct(r.beamed)} | ${r.threshold == null ? '-' : r.threshold.toFixed(4)} | ${r.wer.toFixed(2)} | ${r.cer.toFixed(2)} | ${pct(r.cost)} | ${pct(r.recovered)} |`);
  }
  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = readFileSync(args.jsonl, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const beams = [...new Set(records.filter((r) => r.type === 'utterance' && r.beam > 1).map((r) => r.beam))].sort((a, b) => a - b);
  if (!beams.length) throw new Error('no beam (>1) cell in the JSONL');
  for (const beam of args.beam ? [args.beam] : beams) {
    const pairs = pairRecords(records, beam);
    if (!pairs.length) throw new Error(`no greedy/beam-${beam} pairs: was the greedy cell run with --record-confidences?`);
    const datasets = [...new Set(pairs.map((p) => p.dataset))];
    console.log(`\n# Selective beam: greedy vs beam ${beam} (${pairs.length} utterances, ${datasets.join(', ')})\n`);
    for (const feature of Object.keys(FEATURES)) {
      console.log(`\n## Feature: ${feature}\n\n${table(pairs, feature, args.fractions)}`);
    }
    for (const ds of datasets) {
      const sub = pairs.filter((p) => p.dataset === ds);
      console.log(`\n## ${ds} (${sub.length} utterances), feature meanLog\n\n${table(sub, 'meanLog', args.fractions)}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`[selective-beam] error: ${e.message}`); process.exit(1); }
}
