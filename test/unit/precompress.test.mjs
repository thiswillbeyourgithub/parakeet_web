// Tier-1 unit test for scripts/precompress.mjs, the tool that generates the
// `<file>.br` / `<file>.zst` sidecars Caddy serves via
// `file_server { precompressed ... }`.
//
// What actually needs pinning here. A sidecar is invisible when it works and
// silent when it is wrong: a STALE one is served to every browser that accepts
// the encoding while the plain file stays correct, so only part of the audience
// sees outdated bytes and nothing logs an error. The rules that prevent that
// (never keep a sidecar older than its source, never leave a dangling one, and
// give every path that reaches the same bytes a sidecar of its own) are
// therefore worth more than the compression itself.
//
// The canonical/alias planning is the part that already shipped a bug: a
// maintainer tree reaches the same weights through the nested model repo, the
// flat root symlinks Caddy actually serves, and a symlinked `sharded/`
// directory. Compressing "each file" once per REACHABLE PATH wrote sidecars
// only where Caddy does not look and would have written a second full copy per
// duplicate view. So planCanonical is tested directly, including the ordering
// property that makes it pick the real file rather than whichever view the
// directory walk happened to hit first.
//
// The end-to-end cases below run on a real temp tree with real symlinks, in
// --static mode where possible (brotli is built into Node, so those need no
// external binary); the alias case needs --models, which falls back to Node's
// own zstd when the `zstd` binary is absent.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, lstatSync, readlinkSync, statSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import {
  isCompressibleStatic,
  isModelWeight,
  sidecarIsCurrent,
  worthKeeping,
  planCanonical,
  relativeSidecarLink,
  parseArgs,
  run,
  STATIC_MIN_BYTES,
} from '../../scripts/precompress.mjs';

describe('parseArgs', () => {
  test('takes the directory either way round', () => {
    // `--models=/models` used to be accepted with the path DROPPED, so the run
    // silently precompressed the default directory instead of the named one.
    assert.equal(parseArgs(['--models', '/models']).dir, '/models');
    assert.equal(parseArgs(['--models=/models']).dir, '/models');
    assert.equal(parseArgs(['--static=/srv']).dir, '/srv');
    assert.equal(parseArgs(['--static', '/srv']).dir, '/srv');
  });

  test('takes numeric options either way round', () => {
    assert.equal(parseArgs(['--models', '--level', '3']).level, 3);
    assert.equal(parseArgs(['--models', '--level=3']).level, 3);
    assert.equal(parseArgs(['--static', '--quality=5']).quality, 5);
  });

  test('falls back to the documented defaults', () => {
    assert.equal(parseArgs(['--static']).dir, 'app/ui/dist');
    assert.equal(parseArgs(['--models']).dir, 'fallback_models');
    assert.equal(parseArgs(['--models'], { LOCAL_MODEL_PATH: '/mnt/m' }).dir, '/mnt/m');
  });

  test('refuses to guess', () => {
    // No mode means no idea which compressor or which directory, and picking
    // one would either recompress the wrong tree or write the wrong format.
    assert.ok(parseArgs([]).error);
    assert.ok(parseArgs(['--models', '--bogus']).error);
    assert.ok(parseArgs(['--models', '--level', 'nine']).error);
  });

  test('help short-circuits without an error', () => {
    const p = parseArgs(['--help']);
    assert.equal(p.help, true);
    assert.equal(p.error, null);
  });
});

describe('isCompressibleStatic', () => {
  const big = STATIC_MIN_BYTES * 10;

  test('takes the bundle formats that dominate the payload', () => {
    for (const name of ['main.js', 'main.mjs', 'style.css', 'index.html',
      'bpe-merges.json', 'favicon.svg', 'ort-wasm-simd-threaded.wasm',
      'probe-encoder.int8.onnx', 'SOURCE.md', 'main.js.map']) {
      assert.equal(isCompressibleStatic(name, big), true, name);
    }
  });

  test('leaves already-compressed payloads alone', () => {
    // A sidecar for these would cost a stat() per request to save nothing.
    for (const name of ['beep.mp3', 'shot.png', 'font.woff2', 'clip.webm', 'x.avif']) {
      assert.equal(isCompressibleStatic(name, big), false, name);
    }
  });

  test('never compresses a sidecar', () => {
    // Otherwise a second run would produce main.js.br.br and, worse, treat the
    // sidecar as a source whose own sidecar goes stale independently.
    for (const name of ['main.js.br', 'main.js.zst', 'main.js.gz']) {
      assert.equal(isCompressibleStatic(name, big), false, name);
    }
  });

  test('skips files below the size floor', () => {
    assert.equal(isCompressibleStatic('tiny.js', STATIC_MIN_BYTES - 1), false);
    assert.equal(isCompressibleStatic('tiny.js', STATIC_MIN_BYTES), true);
  });

  test('matches extensions case-insensitively', () => {
    assert.equal(isCompressibleStatic('READ.MD', big), true);
    assert.equal(isCompressibleStatic('LOGO.SVG', big), true);
  });
});

describe('isModelWeight', () => {
  test('takes the weights Caddy serves as octet-stream', () => {
    for (const name of ['encoder-model.int8.onnx', 'encoder-model.onnx.data',
      'encoder-model.onnx.data.000', 'encoder-model.onnx.data.017']) {
      assert.equal(isModelWeight(name), true, name);
    }
  });

  test('leaves text to Caddy\'s on-the-fly encode', () => {
    // vocab.txt / config.json are small and text/*, which `encode` already
    // compresses at negligible CPU.
    for (const name of ['vocab.txt', 'config.json', 'README.md']) {
      assert.equal(isModelWeight(name), false, name);
    }
  });

  test('never treats a sidecar as a source', () => {
    assert.equal(isModelWeight('encoder-model.onnx.zst'), false);
    assert.equal(isModelWeight('encoder-model.onnx.data.000.zst'), false);
  });
});

describe('sidecarIsCurrent', () => {
  test('a sidecar older than its source is not current', () => {
    assert.equal(sidecarIsCurrent(2000, 1000), false);
  });
  test('a newer sidecar is current', () => {
    assert.equal(sidecarIsCurrent(1000, 2000), true);
  });
  test('equal mtimes count as current', () => {
    // A fresh checkout or an rsync can land both in the same second; treating
    // that as stale would recompress the whole model set on every deploy.
    assert.equal(sidecarIsCurrent(1000, 1000), true);
  });
});

describe('worthKeeping', () => {
  test('keeps a real saving', () => {
    assert.equal(worthKeeping(1000, 500), true);
  });
  test('drops a sidecar that saves almost nothing', () => {
    assert.equal(worthKeeping(1000, 960), false);
  });
  test('keeps exactly at the threshold', () => {
    assert.equal(worthKeeping(1000, 950), true);
  });
  test('drops a sidecar bigger than its source', () => {
    assert.equal(worthKeeping(1000, 1200), false);
  });
});

describe('planCanonical', () => {
  // realDir is the RESOLVED directory containing the path, which for a
  // symlinked file is not the directory its target lives in. Getting those two
  // confused made every flat root link look like a duplicate that needed no
  // sidecar, which is precisely the path Caddy serves.
  const real = (path, realDir) => ({ path, real: path, realDir });
  const link = (path, target, realDir) => ({ path, real: target, realDir });

  test('a lone real file is its own canonical', () => {
    const p = planCanonical([real('/m/a.onnx', '/m')]);
    assert.deepEqual(p.canonical, ['/m/a.onnx']);
    assert.deepEqual(p.aliases, []);
    assert.deepEqual(p.shared, []);
  });

  test('the real file owns the sidecar, the flat link points at it', () => {
    const p = planCanonical([
      real('/m/nested/a.onnx', '/m/nested'),
      link('/m/a.onnx', '/m/nested/a.onnx', '/m'),
    ]);
    assert.deepEqual(p.canonical, ['/m/nested/a.onnx']);
    assert.deepEqual(p.aliases, [{ path: '/m/a.onnx', canonical: '/m/nested/a.onnx' }]);
  });

  test('walk order does not decide who owns the sidecar', () => {
    // This is why the planner makes two passes. A directory walk hits the flat
    // root links before the nested repo, and writing the sidecar THROUGH the
    // link would put it next to the target anyway, leaving the flat path (the
    // one Caddy resolves) without one.
    const p = planCanonical([
      link('/m/a.onnx', '/m/nested/a.onnx', '/m'),
      real('/m/nested/a.onnx', '/m/nested'),
    ]);
    assert.deepEqual(p.canonical, ['/m/nested/a.onnx']);
    assert.deepEqual(p.aliases, [{ path: '/m/a.onnx', canonical: '/m/nested/a.onnx' }]);
  });

  test('a symlinked DIRECTORY needs no link at all', () => {
    // `sharded` is a symlinked directory, so <alias>.zst and <canonical>.zst
    // name the very same file. Linking there deleted the sidecar that had just
    // been generated and replaced it with a self-reference.
    const p = planCanonical([
      real('/m/nested/sharded/a.onnx.data.000', '/m/nested/sharded'),
      link('/m/sharded/a.onnx.data.000', '/m/nested/sharded/a.onnx.data.000', '/m/nested/sharded'),
    ]);
    assert.deepEqual(p.canonical, ['/m/nested/sharded/a.onnx.data.000']);
    assert.deepEqual(p.aliases, []);
    assert.deepEqual(p.shared, ['/m/sharded/a.onnx.data.000']);
  });

  test('several links to one file all point at the same sidecar', () => {
    const p = planCanonical([
      real('/m/nested/a.onnx', '/m/nested'),
      link('/m/a.onnx', '/m/nested/a.onnx', '/m'),
      link('/m/mirror/a.onnx', '/m/nested/a.onnx', '/m/mirror'),
    ]);
    assert.equal(p.canonical.length, 1);
    assert.equal(p.aliases.length, 2);
    for (const a of p.aliases) assert.equal(a.canonical, '/m/nested/a.onnx');
  });

  test('unrelated files each get their own sidecar', () => {
    const p = planCanonical([real('/m/a.onnx', '/m'), real('/m/b.onnx', '/m')]);
    assert.deepEqual(p.canonical, ['/m/a.onnx', '/m/b.onnx']);
    assert.deepEqual(p.aliases, []);
  });

  test('links with no real file among the entries still elect one owner', () => {
    // Both views are symlinks (the real file sits outside the served tree).
    // Exactly one must own the sidecar or both would compress the same bytes.
    const p = planCanonical([
      link('/m/a.onnx', '/elsewhere/a.onnx', '/m'),
      link('/m/mirror/a.onnx', '/elsewhere/a.onnx', '/m/mirror'),
    ]);
    assert.equal(p.canonical.length, 1);
    assert.equal(p.aliases.length, 1);
  });
});

describe('relativeSidecarLink', () => {
  test('points the flat sidecar at the nested one, relatively', () => {
    // Relative on purpose: `rsync -a` transfers symlinks as symlinks, so an
    // absolute target would dangle on the server (and leak the local path).
    assert.equal(
      relativeSidecarLink('/m/a.onnx', '/m/nested/a.onnx', '.zst'),
      'nested/a.onnx.zst');
  });

  test('walks back up when the alias is deeper', () => {
    assert.equal(
      relativeSidecarLink('/m/sub/a.onnx', '/m/a.onnx', '.zst'),
      '../a.onnx.zst');
  });
});

describe('end to end on a real tree', () => {
  let dir;

  before(() => { dir = mkdtempSync(join(tmpdir(), 'precompress-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('static mode compresses what it should and nothing else', async () => {
    const root = join(dir, 'dist');
    mkdirSync(root, { recursive: true });
    const text = 'x'.repeat(50_000);
    writeFileSync(join(root, 'main.js'), text);
    writeFileSync(join(root, 'tiny.js'), 'x');
    writeFileSync(join(root, 'beep.mp3'), text);

    const c = await run({ mode: 'static', dir: root, quality: 5 });
    assert.equal(c.made, 1);
    assert.equal(c.failed, 0);
    assert.ok(existsSync(join(root, 'main.js.br')));
    assert.ok(!existsSync(join(root, 'tiny.js.br')));
    assert.ok(!existsSync(join(root, 'beep.mp3.br')));

    // Byte-exact after decoding: the browser decodes the sidecar and the app
    // must see the file it asked for, hash checks included.
    const back = zlib.brotliDecompressSync(readFileSync(join(root, 'main.js.br')));
    assert.equal(back.toString(), text);
  });

  test('static mode runs on a Node with no zstd at all', () => {
    // The Docker builder is Node 20, which has brotli but no zlib.zstdCompress.
    // Promisifying zstd at import time made the module fail to LOAD there, so
    // the bundle step died on a mode that never compresses a byte with zstd.
    // Reproduced by blanking the export before the tool is loaded, since this
    // process's own Node is new enough to have it.
    const root = join(dir, 'no-zstd');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'main.js'), 'x'.repeat(50_000));
    const preload = join(root, 'blank-zstd.mjs');
    writeFileSync(preload,
      "import zlib from 'node:zlib';\nzlib.zstdCompress = undefined;\nzlib.zstdCompressSync = undefined;\n");

    const tool = fileURLToPath(new URL('../../scripts/precompress.mjs', import.meta.url));
    const r = spawnSync(process.execPath,
      ['--import', pathToFileURL(preload).href, tool, '--static', root, '--quality', '5'],
      { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(root, 'main.js.br')));
  });

  test('models mode says so instead of crashing when no zstd exists', () => {
    const root = join(dir, 'no-zstd-models');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'encoder-model.onnx'), 'z'.repeat(200_000));
    const preload = join(dir, 'no-zstd', 'blank-zstd.mjs');
    const tool = fileURLToPath(new URL('../../scripts/precompress.mjs', import.meta.url));
    // PATH emptied so the `zstd` binary cannot stand in for the missing API.
    const r = spawnSync(process.execPath,
      ['--import', pathToFileURL(preload).href, tool, '--models', root],
      { encoding: 'utf-8', env: { ...process.env, PATH: '' } });
    assert.equal(r.status, 0, 'a missing compressor is not fatal, Caddy serves the plain file');
    assert.ok(!existsSync(join(root, 'encoder-model.onnx.zst')));
    assert.match(r.stderr, /no zstd available/,
      'the operator has to be told why nothing was compressed');
  });

  test('a second run does nothing', async () => {
    const c = await run({ mode: 'static', dir: join(dir, 'dist'), quality: 5 });
    assert.equal(c.made, 0);
    assert.equal(c.kept, 1);
  });

  test('a newer source regenerates the sidecar', async () => {
    const root = join(dir, 'dist');
    const src = join(root, 'main.js');
    const before = statSync(join(root, 'main.js.br')).mtimeMs;
    // Touch the source into the future: mtime granularity would otherwise make
    // an immediate rewrite look identical.
    const future = new Date(Date.now() + 10_000);
    writeFileSync(src, 'y'.repeat(50_000));
    utimesSync(src, future, future);

    const c = await run({ mode: 'static', dir: root, quality: 5 });
    assert.equal(c.made, 1);
    assert.equal(c.pruned, 1, 'the stale sidecar must be removed, not overwritten in place');
    assert.notEqual(statSync(join(root, 'main.js.br')).mtimeMs, before);
  });

  test('check mode reports staleness without touching anything', async () => {
    const root = join(dir, 'dist');
    const src = join(root, 'main.js');
    const future = new Date(Date.now() + 20_000);
    utimesSync(src, future, future);
    const stamp = statSync(join(root, 'main.js.br')).mtimeMs;

    const c = await run({ mode: 'static', dir: root, quality: 5, check: true });
    assert.equal(c.stale, 1);
    assert.equal(c.made, 0);
    assert.equal(statSync(join(root, 'main.js.br')).mtimeMs, stamp,
      'check mode must not rewrite, the model dir is often mounted read-only');
  });

  test('a sidecar whose source is gone is swept up', async () => {
    const root = join(dir, 'orphans');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'keep.js'), 'x'.repeat(50_000));
    writeFileSync(join(root, 'gone.js.br'), 'stale bytes');

    const c = await run({ mode: 'static', dir: root, quality: 5 });
    assert.ok(!existsSync(join(root, 'gone.js.br')));
    assert.ok(existsSync(join(root, 'keep.js.br')));
    assert.equal(c.pruned, 1);
  });

  test('the flat layout Caddy serves gets a sidecar via a relative link', async () => {
    // The maintainer shape: weights in a nested repo, linked into the flat root
    // that Caddy actually resolves. Both paths must end up served compressed,
    // from ONE copy of the bytes.
    const root = join(dir, 'models');
    const nested = join(root, 'Owner', 'repo');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'encoder-model.onnx'), 'z'.repeat(200_000));
    symlinkSync(join('Owner', 'repo', 'encoder-model.onnx'), join(root, 'encoder-model.onnx'));

    const c = await run({ mode: 'models', dir: root, level: 1 });
    assert.equal(c.made, 1, 'the bytes must be compressed exactly once');
    assert.equal(c.linked, 1);
    assert.equal(c.failed, 0);

    const flat = join(root, 'encoder-model.onnx.zst');
    assert.ok(lstatSync(flat).isSymbolicLink(), 'the flat sidecar must be a link, not a second copy');
    assert.equal(readlinkSync(flat), join('Owner', 'repo', 'encoder-model.onnx.zst'));
    assert.ok(existsSync(flat), 'the link must resolve, a dangling one fails the tier-3 check');
    assert.ok(!lstatSync(join(nested, 'encoder-model.onnx.zst')).isSymbolicLink());
  });

  test('check mode reports a missing link, not just a missing sidecar', async () => {
    // The flat link is the path Caddy resolves. Delete it and the compressed
    // bytes still exist on disk, served to nobody, with every mtime healthy: a
    // staleness-only check calls that tree perfectly fine.
    const root = join(dir, 'models');
    rmSync(join(root, 'encoder-model.onnx.zst'), { force: true });

    const c = await run({ mode: 'models', dir: root, level: 1, check: true });
    assert.equal(c.stale, 0);
    assert.equal(c.made, 0);
    assert.ok(!existsSync(join(root, 'encoder-model.onnx.zst')),
      'check mode must not create the link it reports');

    // ...and the write pass puts it back.
    const w = await run({ mode: 'models', dir: root, level: 1 });
    assert.equal(w.linked, 1);
    assert.equal(w.made, 0, 'the bytes were already compressed, only the link was gone');
  });

  test('a dangling sidecar link is cleaned up rather than left to fail the tier-3 check', async () => {
    const root = join(dir, 'models');
    rmSync(join(root, 'Owner', 'repo', 'encoder-model.onnx.zst'), { force: true });
    // The flat link now points at nothing. Regenerating restores it.
    const c = await run({ mode: 'models', dir: root, level: 1 });
    assert.equal(c.failed, 0);
    assert.ok(existsSync(join(root, 'encoder-model.onnx.zst')));
  });
});
