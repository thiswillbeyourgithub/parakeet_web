// test/e2e/serve.mjs must serve the mirror manifest from the sidecar tree, the
// way Caddy serves it from a tmpfs in the container.
//
// Both exist for the same reason: the directory being described is not one a
// generated file can be written into. In production the model mount is read-only;
// locally MODEL_DIR is a maintainer's symlinks INTO the model repo, which is a
// separate checkout and not ours to drop files in. A manifest that silently fails
// to be served costs nothing visible either (the app falls back to HEAD-probing
// and everything documented still loads), which is exactly why it needs a test:
// the symptom is a quant that is unavailable locally and fine on HuggingFace.
//
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE } from '../../scripts/model-manifest.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const SERVE = join(ROOT, 'test/e2e/serve.mjs');
const REPO = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';

test('serve.mjs serves model-manifest.json from the sidecar tree, weights from the model dir', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'serve-manifest-dist-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>t</title>');
  const models = await mkdtemp(join(tmpdir(), 'serve-manifest-models-'));
  const manifests = await mkdtemp(join(tmpdir(), 'serve-manifest-side-'));
  const boost = await mkdtemp(join(tmpdir(), 'serve-manifest-boost-'));

  // A weight only the sidecar manifest names: no candidate path in
  // modelLayout.js reaches into a nested sub-repo, which is the whole point.
  const NESTED = 'istupakov_smoothquant/int8-lite/encoder-model.int8.lite.onnx';
  await mkdir(join(models, REPO, 'istupakov_smoothquant/int8-lite'), { recursive: true });
  await writeFile(join(models, REPO, 'vocab.txt'), 'vocab');
  await writeFile(join(models, REPO, NESTED), 'weights');
  await mkdir(join(manifests, REPO), { recursive: true });
  await writeFile(join(manifests, REPO, MANIFEST_FILE), JSON.stringify(['vocab.txt', NESTED]));

  const port = 4188;
  const proc = spawn(process.execPath, [SERVE], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PARAKEET_E2E_DIST_DIR: dist,
      PARAKEET_E2E_MODEL_DIR: models,
      PARAKEET_E2E_MANIFEST_DIR: manifests,
      PARAKEET_E2E_BOOST_DIR: boost,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  let exited = null;
  proc.on('exit', (code, signal) => { exited = signal ? `signal ${signal}` : `code ${code}`; });

  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);
  try {
    let up = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && exited === null) {
      try { if ((await get('/')).ok) { up = true; break; } } catch { /* not up yet */ }
      await sleep(100);
    }
    assert.ok(up, `server never came up${exited ? ` (exited with ${exited})` : ''}: ${output.trim()}`);

    const manifest = await get(`/models/${REPO}/${MANIFEST_FILE}`);
    assert.equal(manifest.status, 200, 'the sidecar manifest must be served under /models');
    assert.deepEqual(await manifest.json(), ['vocab.txt', NESTED]);

    // Weights are untouched by the sidecar lookup: only the manifest filename
    // is redirected, and only when the sidecar actually has it.
    const weights = await get(`/models/${REPO}/${NESTED}`);
    assert.equal(weights.status, 200);
    assert.equal(await weights.text(), 'weights');

    // A repo with no sidecar manifest falls through and 404s rather than being
    // served some other repo's list.
    assert.equal((await get(`/models/other/repo/${MANIFEST_FILE}`)).status, 404);
  } finally {
    proc.kill('SIGKILL');
    await rm(dist, { recursive: true, force: true });
    await rm(models, { recursive: true, force: true });
    await rm(manifests, { recursive: true, force: true });
    await rm(boost, { recursive: true, force: true });
  }
});
