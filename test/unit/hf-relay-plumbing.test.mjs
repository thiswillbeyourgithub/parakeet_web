// Tier-1 plumbing gate for the HuggingFace model relay.
//
// The relay is a chain of five files: the browser asks /models/<repo>/<file>
// (app/src/hub.js), Caddy hands /models/* to the signaling sidecar
// (docker/Caddyfile), the sidecar streams it from HF (signaling/hf-relay.js),
// the entrypoint builds the repo allowlist and proves HF is reachable before
// anything starts (docker/entrypoint.sh), and compose passes the operator's
// variables in (docker/docker-compose.yml). Every link can break on its own
// without any test of the relay code itself failing, and most of the breaks
// would be silent: a compressed proxy hop drops Content-Length and quietly
// disables Range resume, a missing compose line means HF_TOKEN never reaches
// the container. So the links are asserted here, in the files themselves.
//
// The behaviour of the relay is covered by test/http/hf-relay.test.mjs.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { MANIFEST_FILE as WRITER_MANIFEST_FILE } from '../../scripts/model-manifest.mjs';
import { LOCAL_MANIFEST_FILE } from '../../app/src/hub.js';

const require = createRequire(import.meta.url);
const { MANIFEST_FILE: RELAY_MANIFEST_FILE } = require('../../signaling/hf-relay.js');

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const CADDYFILE = read('docker/Caddyfile');
const DOCKERFILE = read('docker/Dockerfile');
const COMPOSE = read('docker/docker-compose.yml');
const ENTRYPOINT = read('docker/entrypoint.sh');
const SERVER = read('signaling/server.js');

const RETIRED = ['LOCAL_MODEL_PATH', 'PRECOMPRESS_MODELS', 'VITE_MODEL_SOURCE'];

describe('model manifest: every producer names the file hub.js reads', () => {
  test('the relay synthesizes the same filename', () => {
    // A rename on one side alone is invisible: the app just goes back to
    // HEAD-probing, and misses any weight in a layout it cannot guess.
    assert.equal(RELAY_MANIFEST_FILE, LOCAL_MANIFEST_FILE);
  });

  test('so does the static mirror writer (CI model fetch, dev mirrors)', () => {
    assert.equal(WRITER_MANIFEST_FILE, LOCAL_MANIFEST_FILE);
  });
});

describe('HF relay: the container chain', () => {
  test('Caddy proxies /models/* to the sidecar, unbuffered', () => {
    const at = CADDYFILE.indexOf('handle /models/* {');
    assert.ok(at > -1, 'no /models/* handle');
    const block = CADDYFILE.slice(at, at + 300);
    assert.match(block, /^handle \/models\/\* \{\n\s+reverse_proxy localhost:3001 \{/);
    // Without it Caddy buffers, and a 1.4 GB shard would sit in its memory.
    assert.match(block, /flush_interval -1/);
  });

  test('Caddy never compresses relayed bytes', () => {
    // Compression drops Content-Length and rewrites Content-Range, which turns
    // off buffer preallocation, byte progress and the resumable prefix cache
    // in hub.js without any error.
    const m = CADDYFILE.match(/@compress not path ([^\n]+)/);
    assert.ok(m, 'no @compress matcher');
    assert.ok(m[1].split(/\s+/).includes('/models/*'), m[1]);
  });

  test('no trace of the static mirror remains in Caddy or the image', () => {
    for (const s of ['LOCAL_MODEL_PATH', 'model-manifests', 'precompressed zstd']) {
      assert.ok(!CADDYFILE.includes(s), `Caddyfile still mentions ${s}`);
    }
    assert.ok(!DOCKERFILE.includes('scripts/model-manifest.mjs'), 'Dockerfile still copies the mirror manifest writer');
    assert.ok(!COMPOSE.includes('/var/model-manifests'), 'compose still mounts the manifest tmpfs');
  });

  test('the sidecar mounts the relay from the allowlist and token it is given', () => {
    assert.match(SERVER, /parseRepoAllowlist\(process\.env\.HF_RELAY_REPOS/);
    assert.match(SERVER, /token: process\.env\.HF_TOKEN/);
    assert.match(SERVER, /app\.use\('\/models', hfRelay\.handler\)/);
  });

  test('the image ships the defaults module the entrypoint reads', () => {
    assert.match(ENTRYPOINT, /\/opt\/parakeet\/app\/src\/defaultRepos\.js/);
    assert.match(DOCKERFILE, /COPY --from=builder [^\n]*\/build\/app\/src \/opt\/parakeet\/app\/src/);
  });
});

describe('HF relay: the entrypoint', () => {
  test('checks HF at start and refuses to boot when it fails', () => {
    const i = ENTRYPOINT.indexOf('if ! node /signaling/hf-relay.js --check');
    assert.ok(i > -1, 'no startup check');
    assert.match(ENTRYPOINT.slice(i, i + 500), /exit 1/);
  });

  test('exports the allowlist and the token to the sidecar', () => {
    // The sidecar is started later by the same shell: an unexported variable
    // would leave it with an empty allowlist, i.e. a relay that 404s everything.
    assert.match(ENTRYPOINT, /export HF_RELAY_REPOS HF_TOKEN/);
  });

  test('the check runs before the sidecar and Caddy start', () => {
    const check = ENTRYPOINT.indexOf('hf-relay.js --check');
    assert.ok(check < ENTRYPOINT.indexOf('node /signaling/server.js'));
    assert.ok(check < ENTRYPOINT.indexOf('exec caddy run'));
  });

  test('tells the bundle whether /models is the relay', () => {
    assert.match(ENTRYPOINT, /VITE_MODEL_RELAY="true"/);
    assert.match(ENTRYPOINT, /"VITE_MODEL_RELAY",/);
  });

  test('rejects anything but true/false for HF_MODEL_RELAY', () => {
    assert.match(ENTRYPOINT, /case "\$HF_MODEL_RELAY" in\n\s+true\|false\) ;;\n\s+\*\)[\s\S]*?exit 1/);
  });

  test('refuses every retired variable, and a leftover /models mount', () => {
    const loop = ENTRYPOINT.match(/for _old_var in ([^;]+); do([\s\S]*?)\ndone/);
    assert.ok(loop, 'no retired-variable loop');
    assert.deepEqual(loop[1].trim().split(/\s+/), RETIRED);
    assert.match(loop[2], /exit 1/);
    // The loop must run before the entrypoint itself assigns VITE_MODEL_SOURCE,
    // or it would trip on its own value.
    assert.ok(ENTRYPOINT.indexOf('for _old_var in') < ENTRYPOINT.indexOf('VITE_MODEL_SOURCE="both"'));
    assert.match(ENTRYPOINT, /if \[ -d \/models \] && \[ -n "\$\(ls -A \/models[\s\S]{0,400}?exit 1/);
  });
});

describe('HF relay: renamed repos are migrated before the allowlist is built', () => {
  // The browser replaces a renamed VITE_MODEL_REPO entry (a v1-era UltiMed
  // id) by its current id, so if the entrypoint allowlisted the raw value the
  // relay would refuse the exact repo the app asks for.
  const m = ENTRYPOINT.match(/_migrated_repos="\$\(node --input-type=module -e '([^']+)'/);

  test('the migration runs before the relay loop', () => {
    assert.ok(m, 'no VITE_MODEL_REPO migration in the entrypoint');
    assert.ok(ENTRYPOINT.indexOf(m[0]) < ENTRYPOINT.indexOf('for _repo in ${VITE_MODEL_REPO'));
  });

  test('the shipped one-liner maps the v1-era UltiMed ids to v1', () => {
    const local = new URL('../../app/src/defaultRepos.js', import.meta.url).href;
    assert.ok(m[1].includes('/opt/parakeet/app/src/defaultRepos.js'));
    const js = m[1].replace('/opt/parakeet/app/src/defaultRepos.js', local);
    const run = (v) => execFileSync(process.execPath, ['--input-type=module', '-e', js, v], { encoding: 'utf8' });
    assert.equal(
      run('Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx,Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-onnx'),
      'Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx,Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v1-onnx',
    );
    assert.equal(run('Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx'), 'Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx');
  });
});

describe('HF relay: compose passes every variable through', () => {
  // A value in docker/.env does not reach the container unless compose names
  // it. For the retired ones that matters as much: an operator's leftover
  // LOCAL_MODEL_PATH has to arrive for the entrypoint to refuse it.
  for (const v of ['HF_MODEL_RELAY', 'HF_TOKEN', 'HF_RELAY_MAX_STREAMS', ...RETIRED]) {
    test(v, () => {
      assert.match(COMPOSE, new RegExp(`- ${v}=\\$\\{${v}:-[^}]*\\}`));
    });
  }
});
