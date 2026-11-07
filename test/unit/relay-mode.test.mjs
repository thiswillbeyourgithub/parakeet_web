// The /models relay debug override (app/ui/src/lib/relayMode.js) and the one
// download-option rule it feeds (buildDownloadOpts in lib/modelRequest.js).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RELAY_MODES, DEFAULT_RELAY_MODE, normalizeRelayMode, resolveModelSourcing,
} from '../../app/ui/src/lib/relayMode.js';
import { buildDownloadOpts } from '../../app/ui/src/lib/modelRequest.js';

describe('normalizeRelayMode', () => {
  test('keeps the three known modes', () => {
    for (const m of RELAY_MODES) assert.equal(normalizeRelayMode(m), m);
  });
  test('anything else is auto, so a stale value never pins a source', () => {
    for (const v of [undefined, null, '', 'FORCE', 'local', 1, {}]) {
      assert.equal(normalizeRelayMode(v), DEFAULT_RELAY_MODE);
    }
    assert.equal(DEFAULT_RELAY_MODE, 'auto');
  });
});

describe('resolveModelSourcing', () => {
  test('auto passes the operator source through, mirror allowed', () => {
    for (const src of ['hf', 'local', 'both']) {
      assert.deepEqual(resolveModelSourcing(src, 'auto'), { modelSource: src, mirrorAllowed: true });
    }
  });
  test('force serves everything from /models, whatever the operator set', () => {
    for (const src of ['hf', 'local', 'both']) {
      assert.deepEqual(resolveModelSourcing(src, 'force'), { modelSource: 'local', mirrorAllowed: true });
    }
  });
  test('forbid is HuggingFace only AND turns the mirror off', () => {
    // modelSource 'hf' alone still lets the upgrade probe and the local-copy
    // probe reach /models, hence the separate flag.
    for (const src of ['hf', 'local', 'both']) {
      assert.deepEqual(resolveModelSourcing(src, 'forbid'), { modelSource: 'hf', mirrorAllowed: false });
    }
  });
});

describe('buildDownloadOpts under the relay modes', () => {
  const base = { backend: 'wasm', wasmEncoderQuant: 'int8', webgpuEncoderQuant: 'fp16' };
  test('an HF attempt keeps the /models quant-upgrade probe by default', () => {
    const { opts } = buildDownloadOpts(base);
    assert.equal(opts.localUpgradeBaseUrl, '/models');
    assert.equal(opts.localFallbackBaseUrl, undefined);
  });
  test('forbid drops it, so nothing reaches /models', () => {
    const { opts } = buildDownloadOpts({ ...base, mirrorAllowed: false });
    assert.equal(opts.localUpgradeBaseUrl, undefined);
    assert.equal(opts.localFallbackBaseUrl, undefined);
  });
  test('a local attempt serves from /models', () => {
    const { opts } = buildDownloadOpts({ ...base, useLocalFallback: true });
    assert.equal(opts.localFallbackBaseUrl, '/models');
  });
});
