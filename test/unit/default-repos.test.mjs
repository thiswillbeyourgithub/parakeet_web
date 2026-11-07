// The CLI's default model and the web app's default repo must be the same
// model: app/src/models.js keeps its own registry entry (the repo id is part
// of the entry's identity, not a pointer to "whatever the default is"), so the
// two are tied here instead of in code.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MODEL_REPO } from '../../app/src/defaultRepos.js';
import { MODELS, DEFAULT_MODEL } from '../../app/src/models.js';

test('the CLI default model is the web app default repo', () => {
  assert.equal(MODELS[DEFAULT_MODEL].repoId, DEFAULT_MODEL_REPO);
});
