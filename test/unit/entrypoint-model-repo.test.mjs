// Tier-1 unit test for the VITE_MODEL_REPO validator in docker/entrypoint.sh.
//
// That value is concatenated verbatim into a HuggingFace URL path AND into the
// IndexedDB cache key (F-101), so a traversal or a stray character has to be
// refused at boot rather than cached forever in visitors' browsers. Since the
// value became a comma-separated LIST feeding the sidebar model picker, EVERY
// entry has to clear the same bar, not just the first: a validator that only
// checked the head would wave through
// `good/repo,../../evil/repo` because the head is fine.
//
// The functions are extracted from the real entrypoint and executed by /bin/sh,
// so this tests the shipped code rather than a transcription of it. There is no
// container involved, so it runs in the normal unit tier.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = fileURLToPath(new URL('../../docker/entrypoint.sh', import.meta.url));
const src = readFileSync(ENTRYPOINT, 'utf8');

// Pull the two validator functions out of the script by brace matching from
// their definition line. Fails loudly if they are renamed, which is the point:
// a rename that loses the multi-entry check should not quietly stop being
// tested.
function extractFunction(name) {
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in docker/entrypoint.sh`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const PRELUDE = [extractFunction('_validate_one_model_repo'), extractFunction('_validate_model_repo')].join('\n');

/** Run the shipped validator against `value`; true = accepted. */
function accepts(value) {
  const script = `${PRELUDE}\nif _validate_model_repo "$1"; then echo OK; else echo NO; fi\n`;
  const out = execFileSync('/bin/sh', ['-c', script, 'sh', value], { encoding: 'utf8' }).trim();
  assert.ok(out === 'OK' || out === 'NO', `unexpected validator output: ${out}`);
  return out === 'OK';
}

const BASE = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const ULTIMED = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

describe('entrypoint _validate_model_repo', () => {
  test('accepts empty (the bundle falls back to its default repo)', () => {
    assert.equal(accepts(''), true);
  });

  test('accepts a single repo id, the historical value', () => {
    assert.equal(accepts(BASE), true);
    assert.equal(accepts('istupakov/parakeet-tdt-0.6b-v3-onnx'), true);
  });

  test('accepts a comma-separated list', () => {
    assert.equal(accepts(`${BASE},${ULTIMED}`), true);
  });

  test('rejects a bad entry anywhere in the list, not just the first', () => {
    // The whole reason this test exists: head-only validation accepts these.
    assert.equal(accepts(`${BASE},../../evil/repo`), false);
    assert.equal(accepts(`${BASE},owner/name/extra`), false);
    assert.equal(accepts(`${BASE},not-a-repo`), false);
    assert.equal(accepts(`${BASE},owner/na me`), false);
    assert.equal(accepts(`${BASE},"; touch /tmp/pwned; "`), false);
  });

  test('rejects traversal and out-of-alphabet characters in a single value', () => {
    for (const bad of [
      'main/../../other-owner/other-repo',
      'owner/name;rm -rf /',
      'owner/name$(id)',
      'owner/na*me',
      '/owner/name',
      'owner/name/',
      'owner',
      'owner/name/extra',
    ]) {
      assert.equal(accepts(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('rejects empty entries produced by a stray comma', () => {
    // A leading/trailing/doubled comma is a typo, and an empty entry would
    // otherwise be skipped by the split loop and silently accepted.
    for (const bad of [`,${BASE}`, `${BASE},`, `${BASE},,${ULTIMED}`, ',']) {
      assert.equal(accepts(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('does not treat whitespace around an entry as valid', () => {
    // The app-side parser trims, but the shell one must not: a space is not in
    // the HF alphabet, and accepting it here would let a value through that
    // then fails to resolve as a path under the local mirror.
    assert.equal(accepts(`${BASE}, ${ULTIMED}`), false);
  });
});
