// Tier-1 gate on the container half of the mirror manifest.
//
// The manifest only helps if the whole chain holds: the entrypoint generates it,
// it has somewhere writable to go (the model mount is read-only by default and
// the rootfs is read-only too), Caddy serves it back under /models/, and the
// generator is actually in the runtime image. Any one of those missing costs
// nothing visible: the app falls back to HEAD-probing and every documented
// layout still loads, so a broken link in this chain would ship silently and
// only show up as a quant that is unavailable on a self-hosted mirror.
//
// So assert the plumbing from both ends, the same way the OpenAI server's env
// vars are checked against docker-compose.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE } from '../../scripts/model-manifest.mjs';
import { LOCAL_MANIFEST_FILE } from '../../app/src/hub.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const CADDYFILE = read('docker/Caddyfile');
const DOCKERFILE = read('docker/Dockerfile');
const COMPOSE = read('docker/docker-compose.yml');
const ENTRYPOINT = read('docker/entrypoint.sh');

const MANIFEST_DIR = '/var/model-manifests';

describe('mirror manifest: reader and writer agree on the filename', () => {
  test('hub.js and model-manifest.mjs name the same file', () => {
    // Two modules, one filename. A rename on one side alone is invisible: the
    // app just goes back to probing.
    assert.equal(LOCAL_MANIFEST_FILE, MANIFEST_FILE);
  });
});

describe('mirror manifest: the container chain', () => {
  test('the generator is in the runtime image', () => {
    assert.match(DOCKERFILE, /COPY[^\n]*scripts\/model-manifest\.mjs \/opt\/parakeet\/scripts\/model-manifest\.mjs/);
  });

  test('the entrypoint runs it over the mount, into the writable dir', () => {
    assert.match(ENTRYPOINT, /node \/opt\/parakeet\/scripts\/model-manifest\.mjs/);
    assert.ok(ENTRYPOINT.includes(`MODEL_MANIFEST_DIR="${MANIFEST_DIR}"`), MANIFEST_DIR);
    // It must be handed all three: the mount, the repo list (so a shared mount
    // gets one manifest per repo) and the writable destination.
    assert.match(ENTRYPOINT, /"\$\{LOCAL_MODEL_PATH\}" "\$\{_MODEL_REPOS\}" "\$\{MODEL_MANIFEST_DIR\}"/);
  });

  test('a failure to generate it is a warning, never a refused boot', () => {
    // A mount with no manifest is probed exactly as before, so this can only
    // ever cost the deployment a quant it could otherwise have served.
    const block = ENTRYPOINT.slice(ENTRYPOINT.indexOf('MODEL_MANIFEST_DIR='), ENTRYPOINT.indexOf('Precompressed sidecars'));
    assert.ok(block.includes('WARNING'), block);
    assert.ok(!block.includes('exit 1'), 'generating the manifest must not be able to fail the boot');
  });

  test('the destination exists and is writable under the read-only rootfs', () => {
    // read_only: true plus explicit tmpfs mounts, so a directory nobody listed
    // is simply not writable and the entrypoint would warn on every boot.
    assert.ok(COMPOSE.includes(`- ${MANIFEST_DIR}:uid=1000,gid=1000,mode=0700`), COMPOSE.slice(0, 0) || 'missing tmpfs');
  });

  test('Caddy serves it from there, for both mirror shapes', () => {
    const block = CADDYFILE.slice(CADDYFILE.indexOf('handle_path /models/*'));
    assert.ok(block.includes(`@model_manifest path /${MANIFEST_FILE}`), 'flat layout shape');
    assert.ok(block.includes(`/*/*/${MANIFEST_FILE}`), 'shared mount <owner>/<repo> shape');
    assert.ok(block.includes(`root * ${MANIFEST_DIR}`), 'served from the tmpfs, not the read-only mount');
  });

  test('the manifest route is matched before the model root, and both are exclusive', () => {
    // Falling through to the model root would 404 the manifest, since it is
    // deliberately not written into the mount.
    const block = CADDYFILE.slice(CADDYFILE.indexOf('handle_path /models/*'));
    const manifest = block.indexOf('handle @model_manifest');
    const weights = block.indexOf('{$LOCAL_MODEL_PATH');
    assert.ok(manifest > -1 && weights > manifest, 'the manifest handle must come first');
    // `handle` blocks are mutually exclusive; a bare directive at the same level
    // would apply to the manifest request too.
    assert.match(block.slice(manifest), /handle \{\n\t+root \* \{\$LOCAL_MODEL_PATH/);
  });
});
