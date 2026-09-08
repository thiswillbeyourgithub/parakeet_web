// Tier-1 gate on the HuggingFace hosts the CSP lets the browser reach.
//
// This list is the only thing standing between a visitor and every model
// weight, and getting it wrong fails in the most confusing way available: the
// BROWSER blocks the request, so hub.js sees a generic failed download, falls
// through to the local mirror, and reports whatever that mirror lacks. The
// actual cause (one missing origin in a header) appears nowhere in the app's
// own logs. That is not hypothetical: a deployment served every weight from
// us.aws.cdn.hf.co while the CSP allowed only cas-bridge.xethub.hf.co, and the
// symptom was a 404 loop against the local mirror.
//
// So pin the list against the redirect chain HF really serves. The hosts are
// asserted as data here rather than fetched, because the fast tier must stay
// network-free; scripts/check-hf-cdn-hosts.mjs is the online counterpart that
// resolves a real download and says whether this list still covers it.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = readFileSync(fileURLToPath(new URL('../../docker/entrypoint.sh', import.meta.url)), 'utf8');

const hfHosts = () => {
  const m = ENTRYPOINT.match(/^_HF_HOSTS_DEFAULT="([^"]*)"/m);
  assert.ok(m, '_HF_HOSTS_DEFAULT not found in docker/entrypoint.sh');
  return m[1].split(' ').filter(Boolean);
};

describe('CSP: HuggingFace origins', () => {
  test('covers the Xet CDN that model files are redirected to', () => {
    // Observed 2026-09-08 on a resolve?download=true for a weight in the app's
    // own model repo: the 302 points at https://us.aws.cdn.hf.co/xet-bridge-us/.
    // Every repo migrated to Xet storage answers the same way, so this is the
    // host that matters most, not the legacy cdn-lfs ones.
    const hosts = hfHosts();
    assert.ok(hosts.includes('https://us.aws.cdn.hf.co'), hosts.join(' '));
    assert.ok(hosts.includes('https://eu.aws.cdn.hf.co'), hosts.join(' '));
  });

  test('keeps the API origin and the legacy LFS CDNs', () => {
    // The listing call goes to huggingface.co itself, and repos that have NOT
    // been migrated still redirect to cdn-lfs*. Dropping either would break a
    // different half of the deployments.
    const hosts = hfHosts();
    for (const host of ['https://huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cas-bridge.xethub.hf.co']) {
      assert.ok(hosts.includes(host), `${host} missing from ${hosts.join(' ')}`);
    }
  });

  test('every entry is an https origin with no path, port or wildcard', () => {
    // The default is interpolated into the CSP header without passing through
    // _validate_csp_hosts (that one guards OPERATOR input), so it has to hold
    // itself to the same bar rather than being the one place a `*` can enter.
    for (const host of hfHosts()) {
      assert.match(host, /^https:\/\/[A-Za-z0-9.-]+$/, host);
    }
  });
});
