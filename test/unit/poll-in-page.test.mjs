// Tier-1 unit test for pollInPage (test/e2e/seed.mjs), the poll seedSettings
// uses for its boot gate and its stable-hold loop.
//
// It exists because the two guards used to call page.waitForFunction with an
// async predicate, which Playwright does not await: the returned Promise is
// truthy, so the wait resolved after one evaluation even when the predicate
// said false. Neither guard ever waited, and seeded specs flaked whenever the
// first boot's version purge landed after the single write. The contract
// pinned here is exactly what waitForFunction lacked: an async false keeps the
// poll going, only a real true ends it, and a condition that never comes true
// fails loudly instead of passing.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pollInPage } from '../../test/e2e/seed.mjs';

// A page whose evaluate() runs the predicate in Node, which is all pollInPage
// needs from it.
const fakePage = () => ({ evaluate: async (fn, arg) => fn(arg) });

describe('pollInPage', () => {
  test('keeps polling while an async predicate resolves false', async () => {
    let calls = 0;
    await pollInPage(fakePage(), async () => { calls += 1; return calls >= 3; }, null, { interval: 1 });
    assert.equal(calls, 3);
  });

  test('only a strict true ends the wait (a truthy Promise or value does not)', async () => {
    let calls = 0;
    const results = [Promise.resolve(false), 'yes', 1, true];
    await pollInPage(fakePage(), () => results[calls++], null, { interval: 1 });
    assert.equal(calls, 4);
  });

  test('times out loudly on a condition that never holds', async () => {
    await assert.rejects(
      pollInPage(fakePage(), async () => false, null, { interval: 5, timeout: 30, what: 'the seed' }),
      /timed out after 30 ms waiting for the seed/,
    );
  });

  test('an evaluation error counts as not yet, and is reported on timeout', async () => {
    let calls = 0;
    const page = { evaluate: async () => { calls += 1; if (calls === 1) throw new Error('context destroyed'); return true; } };
    await pollInPage(page, () => true, null, { interval: 1 });
    assert.equal(calls, 2);
    const failing = { evaluate: async () => { throw new Error('context destroyed'); } };
    await assert.rejects(
      pollInPage(failing, () => true, null, { interval: 5, timeout: 20 }),
      /last evaluation error: context destroyed/,
    );
  });

  test('passes its argument through to the predicate', async () => {
    let seen;
    await pollInPage(fakePage(), (arg) => { seen = arg; return true; }, { k: 1 });
    assert.deepEqual(seen, { k: 1 });
  });
});
