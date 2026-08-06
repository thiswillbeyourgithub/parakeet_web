#!/usr/bin/env node
// Build the French-medical validation sets used to tune this repo's decoding
// knobs (phrase boosting, beam width, commitment scaling, ...).
//
// Source is the UltiMed-ASR-FR corpus (the "ultimate_french_medical_dataset"
// project): synthetic French medical speech in four independent subsets, each
// with its own NeMo manifest per split. Tuning against one blended medical
// corpus hides where a knob helps and where it hurts, so this script draws a
// SEPARATE small validation set per subset and keeps them separate all the way
// through `scripts/grid_search_benchmark.mjs` (which takes --manifest more than
// once and breaks every grid cell down per dataset).
//
// The four subsets are genuinely different distributions:
//   dictionary - prescriptions/notes built around one rare medical term each,
//                the densest source of vocabulary a phrase boost could fix
//   drugs      - prescriptions built around drug names and dosages
//   parhaf     - HealthDataHub PARHAF clinical documents, rewritten and spoken
//   parrot     - PARROT radiology reports (eval-only subset, hence its `test`
//                split: PARROT ships no train/val, see the corpus README)
//
// What it does per subset: read the split manifest, drop QC failures, dedupe by
// group so one term/drug cannot dominate the draw, take a seeded random sample,
// copy each clip's FLAC into the output tree, and write a NeMo manifest whose
// audio_filepath is RELATIVE to the output directory (so the benchmark runs
// with --audio-root <out> and the set stays portable). A README.md and a
// machine-readable sample.json record the provenance.
//
// The audio is not committed (a few hundred MB); this script plus the recorded
// seed is what makes the set reproducible from the source corpus.
//
// Usage:
//   node scripts/gen-medical-val-sets.mjs \
//     --source "/media/attila/ssd1TO/audio_datasets/NeMO_files" \
//     --per-subset 100 --seed 1234
//
//   node scripts/grid_search_benchmark.mjs \
//     --manifest ./benchmark_datasets/french_medical/dictionary_val.jsonl \
//     --manifest ./benchmark_datasets/french_medical/drugs_val.jsonl \
//     --audio-root ./benchmark_datasets/french_medical --ort wasm ...
//
// Built with Claude Code.

import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { mulberry32, shuffled } from './lib/sample.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Default subset:split pairs. PARROT is `test` because the corpus ships it as an
// eval-only subset with empty train/val splits, not by oversight.
const DEFAULT_SUBSETS = 'dictionary:val,drugs:val,PARHAF:val,PARROT:test';

// --- args -----------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    source: '/media/attila/ssd1TO/audio_datasets/NeMO_files',
    audioRoot: null,      // null => resolve audio_filepath relative to each manifest
    subsets: DEFAULT_SUBSETS,
    perSubset: 100,
    seed: 1234,
    out: resolve(ROOT, 'benchmark_datasets/french_medical'),
    maxCer: null,         // null => keep every QC-passing clip (see --max-cer)
    allowGroupDupes: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
    const inline = eq > 0 && arg.startsWith('--') ? arg.slice(eq + 1) : null;
    const val = () => (inline !== null ? inline : argv[++i]);
    switch (flag) {
      case '-h': case '--help': printHelp(); process.exit(0); break;
      case '--source': a.source = expandHome(val()); break;
      case '--audio-root': a.audioRoot = expandHome(val()); break;
      case '--subsets': a.subsets = val(); break;
      case '--per-subset': a.perSubset = parseInt(val(), 10); break;
      case '--seed': a.seed = parseInt(val(), 10); break;
      case '--out': a.out = resolve(expandHome(val())); break;
      case '--max-cer': a.maxCer = Number(val()); break;
      case '--allow-group-dupes': a.allowGroupDupes = true; break;
      case '--dry-run': a.dryRun = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isInteger(a.perSubset) || a.perSubset < 1) {
    throw new Error('--per-subset must be a positive integer');
  }
  if (!Number.isInteger(a.seed)) throw new Error('--seed must be an integer');
  if (a.maxCer !== null && !(Number.isFinite(a.maxCer) && a.maxCer >= 0)) {
    throw new Error('--max-cer must be a non-negative number');
  }
  return a;
}

function printHelp() {
  console.log(`Build the per-subset French-medical validation sets.

  --source DIR          UltiMed NeMo manifest root, holding <subset>/<split>.jsonl
                        (default: /media/attila/ssd1TO/audio_datasets/NeMO_files)
  --audio-root DIR      Resolve each manifest's audio_filepath against DIR instead
                        of against the manifest's own directory.
  --subsets LIST        Comma-separated subset:split pairs
                        (default: ${DEFAULT_SUBSETS})
  --per-subset N        Clips to draw per subset (default: 100)
  --seed N              PRNG seed; same seed => same sample (default: 1234)
  --out DIR             Output tree (default: ./benchmark_datasets/french_medical)
  --max-cer X           Also drop clips whose recorded TTS-fidelity CER exceeds X.
                        Off by default: that CER measures how well a checking STT
                        model reproduced the text from the synthetic audio, so
                        filtering on it would preferentially discard the hardest
                        pronunciations, which is exactly where phrase boosting is
                        supposed to earn its keep. The residual label noise is
                        identical in every grid cell, so it cannot flip a ranking.
  --allow-group-dupes   Keep several clips from the same group_id (the corpus emits
                        many variants per term/drug). Off by default so one term
                        cannot take over the draw.
  --dry-run             Report what would be drawn; copy nothing, write nothing.
`);
}

const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// "dictionary:val,PARROT:test" -> [{subset, split}]
function parseSubsets(spec) {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const [subset, split] = pair.split(':').map((x) => x.trim());
    if (!subset || !split) throw new Error(`--subsets entry must be "subset:split" (got "${pair}")`);
    return { subset, split };
  });
}

function readManifest(path) {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// A clip is usable when QC did not give up on it and it has the two fields the
// benchmark needs. `qc_status: 'exhausted'` means the corpus's own regeneration
// loop ran out of attempts on that clip, i.e. the audio never matched its text.
function rejectReason(entry, maxCer) {
  if (entry.qc_status === 'exhausted') return 'qc_exhausted';
  if (!entry.audio_filepath) return 'no_audio_filepath';
  if (!entry.text || !String(entry.text).trim()) return 'empty_text';
  if (maxCer !== null && Number.isFinite(entry.cer) && entry.cer > maxCer) return 'cer_above_max';
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const subsets = parseSubsets(args.subsets);
  const rng = mulberry32(args.seed);

  if (!existsSync(args.source)) {
    throw new Error(`--source not found: ${args.source}`);
  }

  const report = [];
  for (const { subset, split } of subsets) {
    const manifestPath = join(args.source, subset, `${split}.jsonl`);
    if (!existsSync(manifestPath)) throw new Error(`missing manifest: ${manifestPath}`);

    const entries = readManifest(manifestPath);
    if (entries.length === 0) {
      throw new Error(`${subset}/${split} is empty (PARROT ships no train/val split: use PARROT:test)`);
    }

    // Reject, then dedupe by group, then shuffle: dropping before the shuffle
    // keeps the draw uniform over the eligible pool rather than over the raw
    // split (where a reject would silently shrink the sample).
    const rejects = Object.create(null);
    const eligible = [];
    const seenGroups = new Set();
    for (const e of shuffled(entries, rng)) {
      const why = rejectReason(e, args.maxCer);
      if (why) { rejects[why] = (rejects[why] ?? 0) + 1; continue; }
      const group = e.group_id ?? null;
      if (!args.allowGroupDupes && group !== null) {
        if (seenGroups.has(group)) { rejects.group_dupe = (rejects.group_dupe ?? 0) + 1; continue; }
        seenGroups.add(group);
      }
      eligible.push(e);
      if (eligible.length >= args.perSubset) break;
    }

    if (eligible.length < args.perSubset) {
      console.error(`[gen] WARNING ${subset}/${split}: only ${eligible.length} of ${args.perSubset} `
        + `clips eligible (rejected: ${JSON.stringify(rejects)})`);
    }

    const name = `${subset.toLowerCase()}_${split}`;
    const audioDir = join(args.out, 'audio', subset.toLowerCase());
    if (!args.dryRun) mkdirSync(audioDir, { recursive: true });

    const lines = [];
    let totalSec = 0;
    let totalBytes = 0;
    for (const e of eligible) {
      // audio_filepath is stored relative to the manifest's own directory unless
      // the caller points --audio-root elsewhere.
      const srcAudio = resolve(args.audioRoot ?? dirname(manifestPath), e.audio_filepath);
      if (!existsSync(srcAudio)) throw new Error(`missing audio: ${srcAudio} (from ${manifestPath})`);
      const file = basename(srcAudio);
      const relOut = join('audio', subset.toLowerCase(), file);
      totalBytes += statSync(srcAudio).size;
      if (!args.dryRun) copyFileSync(srcAudio, join(args.out, relOut));

      totalSec += e.duration ?? 0;
      lines.push(JSON.stringify({
        audio_filepath: relOut,
        duration: e.duration,
        // `text` is the corpus's ASR target. It differs from the spoken form in
        // ~3% of clips (the target writes "type II" where the TTS said "type
        // deux"), which costs every configuration the same handful of errors.
        text: e.text,
        // Kept for auditing that constant offset, never scored against.
        asr_training_source: e.asr_training_source,
        category: e.category ?? subset.toLowerCase(),
        source_manifest: `${subset}/${split}.jsonl`,
        group_id: e.group_id ?? null,
        tts_check_cer: e.cer ?? null,
        qc_status: e.qc_status ?? null,
      }));
    }

    const manifestOut = join(args.out, `${name}.jsonl`);
    if (!args.dryRun) writeFileSync(manifestOut, `${lines.join('\n')}\n`);

    report.push({
      name,
      subset,
      split,
      manifest: `${name}.jsonl`,
      sourceManifest: manifestPath,
      poolSize: entries.length,
      sampled: eligible.length,
      rejected: rejects,
      totalDurationSec: Number(totalSec.toFixed(2)),
      totalAudioBytes: totalBytes,
    });
    console.error(`[gen] ${name}: ${eligible.length} clips, ${(totalSec / 60).toFixed(1)} min, `
      + `${(totalBytes / 1e6).toFixed(0)} MB (pool ${entries.length})`);
  }

  const provenance = {
    generatedBy: 'scripts/gen-medical-val-sets.mjs',
    corpus: 'UltiMed-ASR-FR (ultimate_french_medical_dataset)',
    source: args.source,
    seed: args.seed,
    perSubset: args.perSubset,
    maxCer: args.maxCer,
    allowGroupDupes: args.allowGroupDupes,
    datasets: report,
  };

  if (!args.dryRun) {
    writeFileSync(join(args.out, 'sample.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    writeFileSync(join(args.out, 'README.md'), renderReadme(provenance));
  }

  const grandSec = report.reduce((s, r) => s + r.totalDurationSec, 0);
  console.error(`[gen] ${args.dryRun ? '(dry run) ' : ''}total ${report.reduce((s, r) => s + r.sampled, 0)} clips, `
    + `${(grandSec / 3600).toFixed(2)} h of audio -> ${args.out}`);
}

function renderReadme(p) {
  const rows = p.datasets.map((d) => `| \`${d.manifest}\` | ${d.subset} | ${d.split} | ${d.sampled} | `
    + `${(d.totalDurationSec / 60).toFixed(1)} | ${d.poolSize} |`).join('\n');
  return `# French medical validation sets

Generated by \`${p.generatedBy}\` (seed \`${p.seed}\`, ${p.perSubset} clips per subset)
from the ${p.corpus} corpus at \`${p.source}\`.

Do not edit by hand: re-run the generator with the same seed to rebuild an
identical set. The audio is deliberately not committed.

| manifest | subset | split | clips | minutes | pool |
|---|---|---|---:|---:|---:|
${rows}

Each subset is a separate manifest on purpose. \`scripts/grid_search_benchmark.mjs\`
takes \`--manifest\` repeatedly and reports every grid cell per dataset plus a
size-weighted overall row, which is what shows whether a knob tuned on one
medical domain quietly costs accuracy on another.

PARROT uses its \`test\` split because the corpus ships it as an eval-only subset
with no train/val.

Run the benchmark against them with:

\`\`\`bash
node scripts/grid_search_benchmark.mjs \\
${p.datasets.map((d) => `  --manifest ./benchmark_datasets/french_medical/${d.manifest} \\`).join('\n')}
  --audio-root ./benchmark_datasets/french_medical \\
  --model-dir ./fallback_models \\
  --ort wasm
\`\`\`

Built with Claude Code.
`;
}

main();
