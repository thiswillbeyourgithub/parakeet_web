#!/usr/bin/env node
// Generate the precompressed sidecars Caddy serves via
// `file_server { precompressed ... }`, and prune any that went stale.
//
// Two modes, because the two payloads want different compressors:
//
//   --static [DIR]   the built UI bundle (default app/ui/dist) -> `<file>.br`
//   --models [DIR]   the locally served weights (default $LOCAL_MODEL_PATH,
//                    then ./fallback_models)                   -> `<file>.zst`
//
// Why static uses brotli. dist is 138 MB, 130 MB of which is WASM
// (ffmpeg-core 32 MB, the four ORT builds, sherpa 18 MB). Caddy compresses
// those on the fly today, per request, for every visitor. Brotli q11 takes the
// 13.5 MB ORT build to 2.2 MB (16.3%) against 2.5 MB for q9, and it is paid
// once at build time, so the slowest setting is the right one here. Node has
// brotli built in, so this needs no extra binary in the builder image.
//
// Why models use zstd. The weights are hundreds of MB each and brotli q11
// would take tens of minutes on them; zstd -9 takes the 841 MB int8 encoder to
// 642 MB (27% off) in ~11 s with the `zstd` binary, ~32 s through Node's own
// zstd. Caddy's `encode` directive skips application/octet-stream entirely, so
// without a sidecar those bytes cross the wire raw on every first load.
//
// Nothing in the app changes either way: a Content-Encoding response is
// decoded before `fetch` hands over the body, and a browser that does not
// accept the encoding (or a file with no sidecar) gets the plain file exactly
// as before.
//
// Staleness is the one real hazard: a sidecar older than its source would be
// served to every browser that accepts the encoding while the plain file stays
// correct, which is silent and hits only part of the audience. So this never
// leaves an out-of-date sidecar behind: it regenerates what it can and DELETES
// what it cannot, since serving the plain file is always safe.
//
// Usage:
//   node scripts/precompress.mjs --static [DIR] [--quality N] [--check]
//   node scripts/precompress.mjs --models [DIR] [--level N] [--check]
//
// --check reports what is missing or stale and writes nothing (this is what
// the container runs at boot when PRECOMPRESS_MODELS is not set).
// Idempotent: an up-to-date sidecar is left alone, so re-running is cheap.
// Never fatal: a failure here only means Caddy serves the plain file.
//
// Built with Claude Code.

import { existsSync, lstatSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, readlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const execFileAsync = promisify(execFile);
const brotliCompress = promisify(zlib.brotliCompress);

// Resolved lazily, NOT at import: Node only grew zstd in 22.15, and the Docker
// builder that runs --static over the bundle is Node 20. Promisifying it up
// here made the whole module fail to load there, on a mode that never
// compresses a single byte with it.
let zstdCompressAsync;
function nodeZstd() {
  if (zstdCompressAsync === undefined) {
    zstdCompressAsync = typeof zlib.zstdCompress === 'function'
      ? promisify(zlib.zstdCompress)
      : null;
  }
  return zstdCompressAsync;
}

// ---------------------------------------------------------------------------
// Pure decisions (exported for test/unit/precompress.test.mjs)
// ---------------------------------------------------------------------------

/** Extensions worth a brotli sidecar in the built bundle. Allowlist, not a
 *  denylist: an unknown extension is more likely to be an already-compressed
 *  media blob than a new text format, and a missing sidecar costs nothing. */
export const STATIC_EXTENSIONS = [
  '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.svg', '.txt',
  '.csv', '.md', '.wasm', '.onnx', '.webmanifest', '.ico', '.xml',
];

/** Below this, the sidecar is not worth the directory entry: Caddy's on-the-fly
 *  `encode` already covers small text at negligible CPU. */
export const STATIC_MIN_BYTES = 1024;

/** A sidecar that saves less than this is dropped: it would cost a stat() per
 *  request to save nothing, and it usually means the source was already
 *  compressed. */
export const MIN_GAIN_RATIO = 0.95;

/** The weight files served under /models/. `.onnx.data.NNN` are the fp32
 *  shards. Text (vocab.txt, config.json) is left to Caddy's `encode`. */
const MODEL_WEIGHT_RE = /\.onnx$|\.onnx\.data$|\.onnx\.data\.\d{3}$/;

export function isModelWeight(name) {
  return MODEL_WEIGHT_RE.test(name) && !name.endsWith('.zst') && !name.endsWith('.br');
}

export function isCompressibleStatic(name, size) {
  if (size < STATIC_MIN_BYTES) return false;
  const lower = name.toLowerCase();
  if (lower.endsWith('.br') || lower.endsWith('.zst') || lower.endsWith('.gz')) return false;
  return STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A sidecar is current when it is not older than its source. Equal mtimes
 *  count as current: a fresh checkout or an rsync can land both in the same
 *  second. */
export function sidecarIsCurrent(srcMtimeMs, sidecarMtimeMs) {
  return sidecarMtimeMs >= srcMtimeMs;
}

export function worthKeeping(srcSize, outSize) {
  return outSize <= srcSize * MIN_GAIN_RATIO;
}

/**
 * Decide which of several paths to the SAME bytes gets the real sidecar.
 *
 * A maintainer tree keeps the weights in a nested folder and symlinks them into
 * the root, because the root is the flat layout Caddy serves; a symlinked
 * directory (`sharded`) makes its files show up twice as well. Compressing
 * every view would spend hundreds of MB and several seconds per duplicate, and
 * compressing only the real file would leave the SERVED path without a sidecar,
 * because Caddy looks for `<requested path>.zst`, not the target's.
 *
 * So: compress each set of bytes once next to the real file, and give every
 * other view a symlink to that sidecar. Duplicates that resolve into the same
 * directory need nothing at all, since `<alias>.zst` and `<canonical>.zst` are
 * then the very same file.
 *
 * @param {Array<{path: string, real: string, realDir: string}>} entries
 * @returns {{canonical: string[], aliases: Array<{path: string, canonical: string}>, shared: string[]}}
 */
export function planCanonical(entries) {
  const byReal = new Map();
  const canonical = [];
  const aliases = [];
  const shared = [];
  // Pass 0 claims the genuine on-disk paths, so a sidecar is never written
  // through a symlink while a real path for the same bytes exists.
  for (let pass = 0; pass < 2; pass++) {
    for (const e of entries) {
      const isReal = e.path === e.real;
      if (pass === 0 && !isReal) continue;
      const claimed = byReal.get(e.real);
      if (!claimed) {
        byReal.set(e.real, e);
        canonical.push(e.path);
      } else if (claimed.path !== e.path) {
        if (e.realDir === claimed.realDir) shared.push(e.path);
        else aliases.push({ path: e.path, canonical: claimed.path });
      }
    }
  }
  return { canonical, aliases, shared };
}

/** Link target for an alias sidecar, relative so a deploy rsync carries it
 *  intact. Lexical on purpose: resolving symlinks here would point the link at
 *  itself when the alias lives in a symlinked directory. */
export function relativeSidecarLink(aliasPath, canonicalPath, suffix) {
  return relative(dirname(aliasPath), canonicalPath + suffix);
}

/** What the alias's sidecar link looks like on disk right now. Shared by the
 *  report and the write path so `--check` cannot call healthy something the
 *  write path would go on to fix. */
function aliasLinkState(alias, suffix) {
  const link = alias.path + suffix;
  const want = relativeSidecarLink(alias.path, alias.canonical, suffix);
  let current = null;
  try {
    if (lstatSync(link).isSymbolicLink()) current = readlinkSync(link);
  } catch { /* absent */ }
  return {
    link,
    want,
    hasTarget: existsSync(alias.canonical + suffix),
    ok: current === want && existsSync(link),
  };
}

// ---------------------------------------------------------------------------
// Compressors
// ---------------------------------------------------------------------------

let zstdBinary; // undefined = not probed yet, null = absent

function haveZstdBinary() {
  if (zstdBinary === undefined) {
    try {
      execFileSync('zstd', ['--version'], { stdio: 'ignore' });
      zstdBinary = 'zstd';
    } catch {
      zstdBinary = null;
    }
  }
  return zstdBinary !== null;
}

async function compressZstd(src, tmp, level) {
  if (haveZstdBinary()) {
    // -T0 is one thread per core, which is ~3x Node's own zstd on a large
    // encoder (11 s vs 32 s on 841 MB).
    await execFileAsync('zstd', ['-q', `-${level}`, '-T0', '-f', '-o', tmp, src]);
    return statSync(tmp).size;
  }
  const buf = await readFile(src);
  // NOTE: never pass ZSTD_c_nbWorkers here. The one-shot API returns an EMPTY
  // buffer with it set (measured), which would write a zero-byte sidecar that
  // Caddy would happily serve in place of the model.
  const out = await nodeZstd()(buf, {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: level },
  });
  writeFileSync(tmp, out);
  return out.length;
}

async function compressBrotli(src, tmp, quality) {
  const buf = await readFile(src);
  const out = await brotliCompress(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  writeFileSync(tmp, out);
  return out.length;
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------

/** Recursive walk that follows symlinked directories (a maintainer tree links
 *  whole folders in), guarding against a link loop by resolved path.
 *
 *  `dangling` opts broken symlinks in. Sources must never include them (there
 *  are no bytes to compress), but the orphan sweep must, because a sidecar link
 *  left pointing at nothing is exactly what it is there to clean up. */
function walk(dir, keep, { dangling = false } = {}, out = [], seen = new Set()) {
  let real;
  try {
    real = realpathSync(dir);
  } catch {
    return out;
  }
  if (seen.has(real)) return out;
  seen.add(real);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    let st;
    let broken = false;
    try {
      st = statSync(full); // follows, so a symlinked file is seen as a file
    } catch {
      if (!dangling) continue;
      try { st = lstatSync(full); broken = true; } catch { continue; }
    }
    if (!broken && st.isDirectory()) walk(full, keep, { dangling }, out, seen);
    else if ((broken || st.isFile()) && keep(entry.name, st.size)) {
      out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs, broken });
    }
  }
  return out;
}

function mtimeOf(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u += 1; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}${units[u]}`;
}

export async function run({ mode, dir, level = 9, quality = 11, check = false, concurrency = 4 }) {
  const suffix = mode === 'models' ? '.zst' : '.br';
  const counts = { made: 0, kept: 0, linked: 0, pruned: 0, stale: 0, failed: 0 };

  if (!existsSync(dir)) {
    console.error(`[precompress] no ${mode} dir at ${dir}, nothing to do`);
    return counts;
  }

  const keep = mode === 'models'
    ? (name) => isModelWeight(name)
    : (name, size) => isCompressibleStatic(name, size);
  const files = walk(dir, keep).sort((a, b) => a.path.localeCompare(b.path));

  if (files.length === 0) {
    console.error(`[precompress] no ${mode} files under ${dir}`);
    return counts;
  }

  // Which path owns the sidecar for each set of bytes.
  const entries = files.map((f) => {
    let real = f.path;
    try {
      real = realpathSync(f.path);
    } catch { /* keep the literal path */ }
    // The resolved directory CONTAINING this path, which is not the same thing
    // as the directory of the resolved file: a symlinked FILE in the flat root
    // resolves into the nested repo but still needs its own sidecar there,
    // while a file reached through a symlinked DIRECTORY lands in the very same
    // directory as the canonical one and needs nothing.
    let realDir = dirname(f.path);
    try {
      realDir = realpathSync(realDir);
    } catch { /* keep the literal dir */ }
    return { path: f.path, real, realDir, size: f.size, mtimeMs: f.mtimeMs };
  });
  const { canonical, aliases, shared } = planCanonical(entries);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  counts.kept += shared.length;

  // Sources whose sidecar is missing or out of date.
  const work = [];
  for (const path of canonical) {
    const src = byPath.get(path);
    const sidecar = path + suffix;
    const side = mtimeOf(sidecar);
    if (side !== null && sidecarIsCurrent(src.mtimeMs, side)) {
      counts.kept += 1;
      continue;
    }
    if (side !== null) counts.stale += 1;
    work.push({ src, sidecar, hadSidecar: side !== null });
  }

  if (check) {
    for (const w of work) {
      const why = w.hadSidecar ? 'STALE' : 'missing';
      console.error(`[precompress] ${why} sidecar: ${basename(w.sidecar)}`);
    }
    // A missing alias LINK matters as much as a missing sidecar: the flat path
    // it sits on is the one Caddy resolves, so without it the compressed bytes
    // exist on disk and are served to nobody.
    let brokenLinks = 0;
    for (const alias of aliases) {
      const state = aliasLinkState(alias, suffix);
      if (state.ok) { counts.kept += 1; continue; }
      if (!state.hasTarget) continue; // its source sidecar is already reported
      brokenLinks += 1;
      console.error(`[precompress] missing sidecar link: ${relative(dir, state.link)}`);
    }
    console.error(`[precompress] ${mode}: ${counts.kept} sidecar(s) current, `
      + `${counts.stale} stale, ${work.length - counts.stale + brokenLinks} missing`);
    if (work.length || brokenLinks) {
      console.error(`[precompress] A stale sidecar is served INSTEAD of the file it shadows, so`);
      console.error(`[precompress] visitors whose browser accepts the encoding get outdated bytes.`);
      console.error(`[precompress] Fix: node scripts/precompress.mjs --${mode} ${dir}`);
    }
    return counts;
  }

  if (mode === 'models' && !haveZstdBinary()) {
    if (!nodeZstd()) {
      console.error('[precompress] no zstd available: install the `zstd` binary or run this on'
        + ' Node >= 22.15. Caddy will serve the plain files.');
      return counts;
    }
    console.error('[precompress] zstd binary not found, using Node\'s built-in zstd (~3x slower)');
  }

  // Stale or missing: either way the old sidecar must not survive as it is.
  for (const w of work) {
    if (!w.hadSidecar) continue;
    try {
      rmSync(w.sidecar, { force: true });
      counts.pruned += 1;
    } catch {
      console.error(`[precompress] STALE sidecar cannot be removed: ${w.sidecar}`);
      console.error(`[precompress]   it is older than ${w.src.path} and would be served instead of it`);
      w.blocked = true;
      counts.failed += 1;
    }
  }

  // The zstd binary is already multithreaded, so overlapping files there only
  // adds memory pressure; brotli and Node's zstd are single-threaded per call
  // and want the parallelism.
  const lanes = mode === 'models' && haveZstdBinary() ? 1 : concurrency;

  await mapLimit(work.filter((w) => !w.blocked), lanes, async (w) => {
    // Write to a temp name and move into place, so an interrupted run can never
    // leave a truncated sidecar that Caddy would serve as a whole file.
    const tmp = `${w.sidecar}.tmp${process.pid}`;
    try {
      const outSize = mode === 'models'
        ? await compressZstd(w.src.path, tmp, level)
        : await compressBrotli(w.src.path, tmp, quality);
      if (!worthKeeping(w.src.size, outSize)) {
        rmSync(tmp, { force: true });
        counts.kept += 1;
        return;
      }
      renameSync(tmp, w.sidecar);
      counts.made += 1;
      console.log(`[precompress] ${relative(dir, w.src.path)}: ${human(w.src.size)} -> ${human(outSize)}`);
    } catch (err) {
      rmSync(tmp, { force: true });
      console.error(`[precompress] failed to compress ${w.src.path}: ${err.message}`);
      counts.failed += 1;
    }
  });

  // Every other path to the same bytes gets a symlink to the sidecar generated
  // (or kept) above, so the flat layout is served compressed without a second
  // copy on disk. A sidecar that does not exist is never linked to: a dangling
  // `.zst` would make Caddy fall back to the plain file (harmless) but would
  // also trip the tier-3 dangling-symlink check (test/e2e/dangling-links.mjs),
  // and it would be right to.
  for (const alias of aliases) {
    const { link, want, ok, hasTarget } = aliasLinkState(alias, suffix);
    if (!hasTarget) continue;
    if (ok) {
      counts.kept += 1;
      continue;
    }
    try {
      // An older run wrote a full second copy here; replacing it with the link
      // is what reclaims that space.
      rmSync(link, { force: true });
      symlinkSync(want, link);
      if (!existsSync(link)) throw new Error('link does not resolve');
      counts.linked += 1;
    } catch (err) {
      // Never leave a dangling sidecar behind.
      rmSync(link, { force: true });
      console.error(`[precompress] failed to link ${link} -> ${want}: ${err.message}`);
      counts.failed += 1;
    }
  }

  // A sidecar whose source is gone is served to nobody but wastes the disk and
  // confuses the staleness report, so drop it. A sidecar LINK that no longer
  // resolves has to go too: Caddy would just serve the plain file, but the
  // tier-3 dangling-symlink check treats a broken link in the served set as a
  // hard failure.
  const orphans = walk(dir, (name) => name.endsWith(suffix), { dangling: true })
    .filter((f) => f.broken || !existsSync(f.path.slice(0, -suffix.length)));
  for (const o of orphans) {
    try {
      rmSync(o.path, { force: true });
      counts.pruned += 1;
      console.log(`[precompress] removed orphan ${relative(dir, o.path)}`);
    } catch {
      counts.failed += 1;
    }
  }

  return counts;
}

export const USAGE =
  'usage: node scripts/precompress.mjs --static|--models [DIR] [--quality N] [--level N] [--check]';

/**
 * Parse the command line. Pure so the tests can pin it: `--models=/models` was
 * silently accepted with the path DROPPED, which quietly precompressed the
 * default directory instead of the one that was named.
 *
 * @returns {{mode: string|null, dir: string|null, level: number, quality: number,
 *            check: boolean, help: boolean, error: string|null}}
 */
export function parseArgs(argv, env = {}) {
  const out = {
    mode: null,
    dir: null,
    level: 9,      // -9 measured 642 MB vs -3's 665 MB on the int8 encoder, and
                   // it is paid once, so the extra seconds are free.
    quality: 11,   // brotli's slowest and smallest; build-time only.
    check: false,
    help: false,
    error: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const [flag, inline] = arg.startsWith('--') && eq > 0
      ? [arg.slice(0, eq), arg.slice(eq + 1)]
      : [arg, null];
    const value = () => (inline !== null ? inline : argv[++i]);
    switch (flag) {
      // `--models=/path` names the directory; `--models /path` is the same
      // thing with a space, handled by the positional branch below.
      case '--static': out.mode = 'static'; if (inline !== null) out.dir = inline; break;
      case '--models': out.mode = 'models'; if (inline !== null) out.dir = inline; break;
      case '--level': out.level = parseInt(value(), 10); break;
      case '--quality': out.quality = parseInt(value(), 10); break;
      case '--check': out.check = true; break;
      case '-h': case '--help': out.help = true; break;
      default:
        if (flag.startsWith('-')) { out.error = `unknown option: ${flag}`; return out; }
        out.dir = flag;
    }
  }

  if (out.help) return out;
  if (!out.mode) { out.error = 'pick a mode: --static or --models'; return out; }
  if (!Number.isInteger(out.level) || !Number.isInteger(out.quality)) {
    out.error = 'expected an integer for --level / --quality';
    return out;
  }
  if (!out.dir) {
    out.dir = out.mode === 'models'
      ? (env.LOCAL_MODEL_PATH || 'fallback_models')
      : 'app/ui/dist';
  }
  return out;
}

async function main(argv) {
  const opts = parseArgs(argv, process.env);
  if (opts.help) { console.error(USAGE); return 0; }
  if (opts.error) { console.error(opts.error); console.error(USAGE); return 2; }
  const { mode, level, quality, check } = opts;
  const dir = resolve(opts.dir);

  const concurrency = Math.max(1, Math.min(availableParallelism(), 8));
  const started = Date.now();
  const c = await run({ mode, dir, level, quality, check, concurrency });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!check) {
    console.error(`[precompress] ${c.made} generated, ${c.linked} linked, ${c.kept} already current, `
      + `${c.pruned} removed, ${c.failed} failed (${secs}s)`);
  }
  // Never fatal: without a sidecar Caddy serves the plain file, which is what
  // it did before any of this existed.
  return 0;
}

const invokedDirectly = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  // UV_THREADPOOL_SIZE is read when the pool is first used, which no import
  // above does, so raising it here still takes effect for the brotli calls.
  process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE
    || String(Math.max(4, Math.min(availableParallelism(), 8)));
  process.exitCode = await main(process.argv.slice(2));
}
