// Dangling-symlink detector for the tier-3 model directory.
//
// Why this exists. `fallback_models/` is served FLAT (see serve.mjs): the ONNX
// files and vocab.txt sit at its root, which is both the documented
// LOCAL_MODEL_PATH contract and the shape `scripts/fetch-e2e-models.mjs` builds
// in CI, where files from THREE different repos land side by side. A
// maintainer's checkout cannot be flat, though: the ASR weights live in a
// nested folder that is its own git repo (LFS, its own remote). Symlinks at the
// root bridge the two without a second multi-GB copy.
//
// Those symlinks break silently. Rename or move the nested model repo and every
// link dangles, which the harness reads as "weights absent": strict-weights.mjs
// then fails the specs locally, but with the wrong diagnosis (it tells you to
// download weights you already have), and any spec whose weights are genuinely
// optional just skips. This walk turns that into one accurate message at
// startup, before a single spec runs.
//
// Kept in its own module, rather than inside serve.mjs, because importing
// serve.mjs starts a server. Pure and unit-tested (test/unit/dangling-links.test.mjs).
//
// Built with Claude Code.

import { lstatSync, existsSync, readdirSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

// Directories that are never part of the served model set and can be large.
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/**
 * Walk `dir` and collect every symlink whose target does not resolve.
 *
 * Only real directories are descended (checked with lstat, so a symlinked
 * directory is tested as a link but never followed): that keeps the walk
 * finite even if two links point at each other, and costs nothing here since
 * a link's target lives inside the tree anyway and gets walked on its own.
 *
 * @param {string} dir Directory to walk. A missing dir yields [] (CI runs
 *   before `npm run e2e:models` have nothing to check).
 * @returns {Array<{path: string, target: string}>} `path` relative to `dir`.
 */
export function findDanglingLinks(dir) {
  const out = [];
  if (!dir || !existsSync(dir)) return out;

  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // unreadable dir is not this check's business
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        // existsSync follows the link, so false means the target is gone.
        if (!existsSync(full)) {
          let target = '?';
          try { target = readlinkSync(full); } catch { /* keep '?' */ }
          out.push({ path: relative(dir, full), target });
        }
        continue;
      }
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) stack.push(full);
    }
  }
  // Deterministic order so the message reads the same on every machine.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * Split findings by whether they break SERVING.
 *
 * serve.mjs resolves `/models/<file>` in exactly two places: MODEL_DIR itself,
 * and MODEL_DIR/sharded for the two fp32 filenames. A dangling link there means
 * a request 404s, so it must stop the run. Anything deeper is not reachable
 * over HTTP: the model repo also holds local scratch (the `candidates/` A/B
 * symlink farm, run logs), and a stale link in there is worth saying out loud
 * but is no reason to refuse to serve a perfectly good model set.
 *
 * @param {Array<{path: string, target: string}>} dangling
 * @returns {{served: Array, other: Array}}
 */
export function partitionDangling(dangling) {
  const served = [];
  const other = [];
  for (const d of dangling) {
    const parts = d.path.split(/[\\/]/);
    if (parts.length === 1 || (parts.length === 2 && parts[0] === 'sharded')) served.push(d);
    else other.push(d);
  }
  return { served, other };
}

const CAUSE =
  'The model repo folder was probably renamed, moved, or deleted. Repoint them ' +
  'at the current folder (use RELATIVE targets, so a deploy rsync carries them ' +
  'and they still resolve on the server), or delete any that point at a file you ' +
  'removed on purpose.';

function list(dangling) {
  return dangling.map((d) => `  ${d.path} -> ${d.target}`).join('\n');
}

/**
 * Fatal message: links in the served set. Returns '' when there are none, so
 * callers can `if (msg) { print; exit(1) }`.
 */
export function danglingLinksMessage(dangling, dir) {
  const { served } = partitionDangling(dangling);
  if (!served.length) return '';
  return (
    `[e2e:serve] ${served.length} dangling symlink(s) in the served model dir ${dir}:\n` +
    `${list(served)}\n` +
    `[e2e:serve] ${CAUSE} These links are what makes a nested checkout look like ` +
    `the flat layout the harness serves, so leaving them broken surfaces as ` +
    `"weights missing" and sends you looking for the wrong problem.`
  );
}

/**
 * Warning message: links deeper in the tree, which serving never touches.
 * Returns '' when there are none.
 */
export function danglingLinksWarning(dangling, dir) {
  const { other } = partitionDangling(dangling);
  if (!other.length) return '';
  return (
    `[e2e:serve] WARNING: ${other.length} dangling symlink(s) under ${dir} that ` +
    `serving does not touch:\n${list(other)}\n` +
    `[e2e:serve] ${CAUSE} Not fatal, since none of these are reachable over HTTP.`
  );
}
