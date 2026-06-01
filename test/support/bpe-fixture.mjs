/**
 * Loader for the BPE cross-check fixture used by the tier-1 tokenizer/boost
 * tests. The fixture pairs each phrase with the ground-truth token ids emitted
 * by the REAL HuggingFace `tokenizers` library, plus the app's id2token table
 * parsed from vocab.txt (see scripts/gen-bpe-fixture.py).
 *
 * A pre-generated copy is committed at test/fixtures/bpe-fixture.json so the
 * suite runs everywhere without python. When python + the `tokenizers` /
 * `huggingface_hub` packages ARE present, regenerate() reproduces it fresh so a
 * test can assert the committed copy has not drifted from upstream. When they
 * are absent, regenerate() returns null and the caller skips the freshness gate.
 *
 * Built with Claude Code.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
const CACHED_PATH = resolve(ROOT, 'test/fixtures/bpe-fixture.json');
const GEN_SCRIPT = resolve(ROOT, 'scripts/gen-bpe-fixture.py');
const MERGES_ASSET = resolve(ROOT, 'app/ui/public/tokenizer/bpe-merges.json');

/** The committed fixture: { id2token: string[], cases: {text, ids}[] }. */
export function loadCachedFixture() {
  return JSON.parse(readFileSync(CACHED_PATH, 'utf-8'));
}

/** The BPE merges asset shipped to the browser at runtime. */
export function loadMergesAsset() {
  return JSON.parse(readFileSync(MERGES_ASSET, 'utf-8'));
}

/**
 * Regenerate the fixture from the real HuggingFace tokenizer. Returns the parsed
 * fixture object, or null if python / its deps are unavailable (heavy optional
 * dep, auto-skipped rather than failing the suite).
 */
export function regenerateFixture() {
  try {
    const raw = execFileSync('python', [GEN_SCRIPT], {
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
