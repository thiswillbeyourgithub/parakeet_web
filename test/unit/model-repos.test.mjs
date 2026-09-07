// Tier-1 unit test for the model-repo picker policy (app/ui/src/lib/modelRepos.js):
// parsing the operator's comma-separated VITE_MODEL_REPO, labelling entries for
// the sidebar, and resolving a `?model=` link to one of them by closest match.
//
// Worth pinning tightly because every failure here is SILENT: picking the wrong
// repo still produces a fluent transcript from a real model, so nothing in the
// UI or the console says the visitor got the model they did not ask for.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_REPO,
  parseModelRepos,
  shortRepoLabel,
  matchModelRepo,
} from '../../app/ui/src/lib/modelRepos.js';

const BASE = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const ULTIMED = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';
const BOTH = [BASE, ULTIMED];

describe('parseModelRepos', () => {
  test('a single repo id still parses (the historical value)', () => {
    assert.deepEqual(parseModelRepos(BASE), [BASE]);
  });

  test('splits a comma-separated list and keeps the configured order', () => {
    assert.deepEqual(parseModelRepos(`${BASE},${ULTIMED}`), BOTH);
    assert.deepEqual(parseModelRepos(`${ULTIMED},${BASE}`), [ULTIMED, BASE]);
  });

  test('tolerates whitespace, blank entries and a trailing comma', () => {
    assert.deepEqual(parseModelRepos(`  ${BASE} , , ${ULTIMED} ,`), BOTH);
  });

  test('drops duplicates, keeping the first occurrence', () => {
    assert.deepEqual(parseModelRepos(`${BASE},${ULTIMED},${BASE}`), BOTH);
  });

  test('drops malformed entries rather than offering a option that 404s', () => {
    assert.deepEqual(parseModelRepos(`${BASE},not-a-repo,owner/`), [BASE]);
    assert.deepEqual(parseModelRepos(`${BASE},../etc/passwd`), [BASE]);
    assert.deepEqual(parseModelRepos(`${BASE},a/b/c`), [BASE]);
  });

  test('falls back to the built-in default when nothing usable is configured', () => {
    for (const raw of [undefined, null, '', '   ', ',,', 'garbage']) {
      assert.deepEqual(parseModelRepos(raw), [DEFAULT_MODEL_REPO], `for ${JSON.stringify(raw)}`);
    }
  });
});

describe('shortRepoLabel', () => {
  test('strips owner, shared model stem and the -onnx suffix', () => {
    assert.equal(shortRepoLabel(BASE), 'optimized');
    assert.equal(shortRepoLabel(ULTIMED), 'UltiMed');
  });

  test('keeps the product casing intact', () => {
    // Lowercasing would make the picker read as a typo of the real name.
    assert.equal(shortRepoLabel(ULTIMED), 'UltiMed');
  });

  test('falls back to the bare repo name when stripping would leave nothing', () => {
    // Upstream's repo is the stem and nothing else, so there is no
    // distinguishing part to show: keep the whole name over an empty label.
    assert.equal(shortRepoLabel('istupakov/parakeet-tdt-0.6b-v3-onnx'), 'parakeet-tdt-0.6b-v3-onnx');
  });

  test('leaves an unrelated repo name alone apart from the owner', () => {
    assert.equal(shortRepoLabel('owner/whisper-large'), 'whisper-large');
  });

  test('never returns an empty label', () => {
    for (const id of ['owner/parakeet-tdt-0.6b-v3-onnx', 'owner/x', 'bare']) {
      assert.ok(shortRepoLabel(id).length > 0, `empty label for ${id}`);
    }
  });
});

describe('matchModelRepo', () => {
  test('the documented example: ?model=ultimed picks the UltiMed repo', () => {
    assert.equal(matchModelRepo('ultimed', BOTH), ULTIMED);
  });

  test('matching is case-insensitive', () => {
    for (const q of ['UltiMed', 'ULTIMED', 'uLtImEd']) {
      assert.equal(matchModelRepo(q, BOTH), ULTIMED);
    }
  });

  test('an exact repo id matches', () => {
    assert.equal(matchModelRepo(ULTIMED, BOTH), ULTIMED);
    assert.equal(matchModelRepo(BASE, BOTH), BASE);
  });

  test('the bare repo name matches', () => {
    assert.equal(matchModelRepo('parakeet-tdt-0.6b-v3-UltiMed-onnx', BOTH), ULTIMED);
  });

  test('a label prefix matches', () => {
    assert.equal(matchModelRepo('ulti', BOTH), ULTIMED);
    assert.equal(matchModelRepo('opti', BOTH), BASE);
  });

  test('a substring anywhere in the id matches', () => {
    assert.equal(matchModelRepo('optimized-onnx', BOTH), BASE);
  });

  test('surrounding whitespace is tolerated', () => {
    assert.equal(matchModelRepo('  ultimed  ', BOTH), ULTIMED);
  });

  test('an unknown value matches nothing', () => {
    assert.equal(matchModelRepo('whisper', BOTH), null);
    assert.equal(matchModelRepo('v4', BOTH), null);
  });

  test('empty/absent input matches nothing', () => {
    for (const q of [undefined, null, '', '   ']) {
      assert.equal(matchModelRepo(q, BOTH), null);
    }
  });

  test('an ambiguous query resolves to nothing rather than a coin flip', () => {
    // 'parakeet' is a substring of BOTH ids and a prefix of neither label, so
    // no tier yields a single candidate. Guessing here would silently load a
    // model the link author did not mean.
    assert.equal(matchModelRepo('parakeet', BOTH), null);
    assert.equal(matchModelRepo('olicorne', BOTH), null);
  });

  test('a query ambiguous at one tier can still resolve at a stricter one', () => {
    // 'optimized' is an exact label for BASE and merely a substring for the
    // decoy, so the exact-label tier settles it.
    const withDecoy = [BASE, 'Olicorne/parakeet-tdt-0.6b-v3-optimized-experimental-onnx'];
    assert.equal(matchModelRepo('optimized', withDecoy), BASE);
  });

  test('an empty repo list matches nothing', () => {
    assert.equal(matchModelRepo('ultimed', []), null);
    assert.equal(matchModelRepo('ultimed', null), null);
  });
});
