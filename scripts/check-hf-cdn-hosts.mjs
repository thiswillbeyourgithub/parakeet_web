#!/usr/bin/env node
// Does the CSP still let the browser reach where HuggingFace serves weights?
//
// The connect-src allowlist in docker/entrypoint.sh names HF's download hosts
// explicitly, and HF moves them: repos migrated to Xet storage stopped being
// served from cdn-lfs*.huggingface.co and are now redirected to the regional
// Xet CDN (us.aws.cdn.hf.co and friends). A host that is missing from the list
// fails in the worst possible way, because the block happens in the BROWSER:
// hub.js only sees a failed download, falls through to the local mirror, and
// the deployment reports whatever that mirror happens to lack. Nothing in the
// app's logs names the real cause.
//
// So resolve a real download the way a visitor's browser would, and say whether
// the origin it lands on is allowed. Network-dependent by nature, which is why
// it is a script rather than a unit test (test/unit/csp-hf-hosts.test.mjs pins
// the list itself, offline).
//
//   node scripts/check-hf-cdn-hosts.mjs [repo] [file]
//
// Exit 0 when every resolved origin is covered, 1 when one is not (with the
// line to add), 2 when the check could not be run at all.
//
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = fileURLToPath(new URL('../docker/entrypoint.sh', import.meta.url));

const DEFAULT_PROBES = [
  // One repo the app ships against, and one file big enough to be stored as LFS
  // or Xet (a small text file may be served inline from huggingface.co itself,
  // which would prove nothing about the CDN).
  ['Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx', 'int8/encoder-model.int8.onnx'],
  ['istupakov/parakeet-tdt-0.6b-v3-onnx', 'encoder-model.int8.onnx'],
];

function allowedHosts() {
  const src = readFileSync(ENTRYPOINT, 'utf8');
  const m = src.match(/^_HF_HOSTS_DEFAULT="([^"]*)"/m);
  if (!m) {
    console.error('[hf-hosts] _HF_HOSTS_DEFAULT not found in docker/entrypoint.sh');
    process.exit(2);
  }
  return new Set(m[1].split(' ').filter(Boolean));
}

// Where a download really lands. Redirects are followed by hand so every hop is
// visible: the CSP has to allow each origin the browser is sent to, not just the
// last one.
async function resolveChain(repo, file) {
  let url = `https://huggingface.co/${repo}/resolve/main/${file}?download=true`;
  const chain = [];
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0' } });
    chain.push(new URL(url).origin);
    const next = res.headers.get('location');
    if (!next) return { chain, status: res.status };
    url = new URL(next, url).toString();
  }
  return { chain, status: 'too many redirects' };
}

const allowed = allowedHosts();
const probes = process.argv[2] ? [[process.argv[2], process.argv[3]]] : DEFAULT_PROBES;
const missing = new Set();

for (const [repo, file] of probes) {
  if (!file) {
    console.error('[hf-hosts] usage: node scripts/check-hf-cdn-hosts.mjs [repo] [file]');
    process.exit(2);
  }
  let result;
  try {
    result = await resolveChain(repo, file);
  } catch (err) {
    console.error(`[hf-hosts] could not resolve ${repo}/${file}: ${err.message}`);
    process.exit(2);
  }
  for (const origin of result.chain) {
    const ok = allowed.has(origin);
    if (!ok) missing.add(origin);
    console.log(`${ok ? 'ok     ' : 'MISSING'} ${origin}   (${repo}/${file})`);
  }
}

if (missing.size === 0) {
  console.log(`\n[hf-hosts] every origin is already in the CSP allowlist (${allowed.size} hosts).`);
  process.exit(0);
}
console.log(`\n[hf-hosts] add to _HF_HOSTS_DEFAULT in docker/entrypoint.sh:\n  ${[...missing].join(' ')}`);
process.exit(1);
