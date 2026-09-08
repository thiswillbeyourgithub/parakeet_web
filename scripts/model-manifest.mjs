// Write the file list a local model mirror uses to describe itself.
//
// The reader is hub.js listLocalRepoFiles. A mirror is a folder behind a static
// file server, which cannot be listed, so without a manifest the app HEAD-probes
// the paths app/src/modelLayout.js predicts. That works for every layout anyone
// wrote down and for none that they did not: the optimized repo keeps a complete
// second model under istupakov_smoothquant/ and moved the lite int8 encoder into
// it, and no candidate path names that. Over HuggingFace the app resolves it from
// the repo listing; locally the quant simply reads as unavailable.
//
// So the mirror declares itself. The manifest is a JSON array of repo-relative
// paths, the same shape the HF listing has, written at each repo root:
//
//   <mirror>/model-manifest.json                 flat, single-repo mirror
//   <mirror>/<repoId>/model-manifest.json        one per repo on a shared mount
//
// It is derived from the filesystem every time it is written, never edited by
// hand, and cheap to regenerate, which is what keeps it from going stale: the CI
// fetch writes it after downloading and the container entrypoint writes it at
// every boot.
//
// Two consumers, one implementation: scripts/fetch-e2e-models.mjs and
// docker/entrypoint.sh (which runs this file directly, hence the CLI at the
// bottom and the ban on importing anything outside node builtins).
//
// Built with Claude Code.

import { readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_FILE = 'model-manifest.json';

// Skipped wholesale rather than filtered path by path, because these carry
// thousands of entries that are never model files and would drown the listing.
// `.git` in particular: a mirror is very often a git checkout of the model repo.
const SKIP_DIRS = new Set(['.git', '.cache', '.huggingface', 'node_modules']);

// Mirrors hub.js isSafeRepoPath: a segment is a plain token, never empty and
// never a traversal. An entry the reader would drop is not worth writing.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const isSafeRelPath = (rel) => rel.split('/').every(
  (seg) => SAFE_SEGMENT.test(seg) && seg !== '.' && seg !== '..');

/**
 * Every file under `dir`, as repo-relative POSIX paths, sorted.
 *
 * Symlinks are followed (`withFileTypes` reports the link, so a maintainer's
 * mirror of symlinked precision folders would otherwise list nothing), and a
 * link that dangles is simply absent rather than fatal: the manifest describes
 * what can be served, and a broken link cannot be.
 *
 * @param {string} dir Directory to walk.
 * @param {string} [prefix=''] Repo-relative prefix of `dir`, for recursion.
 * @returns {Promise<string[]>} Sorted repo-relative paths.
 */
export async function listFiles(dir, prefix = '') {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isSafeRelPath(rel)) continue;
    // A symlink reports as neither file nor directory here, so ask the target.
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const st = await stat(join(dir, entry.name));
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch { continue; }
    }
    if (isDir) out.push(...await listFiles(join(dir, entry.name), rel));
    else if (isFile && entry.name !== MANIFEST_FILE) out.push(rel);
  }
  return out.sort();
}

/**
 * Write `dir`'s manifest, or remove nothing and return null when there is
 * nothing to describe.
 *
 * Returns the entry count so a caller can report it; never throws on a
 * read-only or unwritable destination, because a missing manifest costs a
 * mirror only the probing it did before.
 *
 * @param {string} dir Repo root to describe.
 * @param {string} [outDir=dir] Where to write it, when the repo root itself is
 *   read-only (the container mounts models `:ro` and serves the manifest from a
 *   writable folder instead).
 * @returns {Promise<number|null>} Entries written, or null if nothing was.
 */
export async function writeManifest(dir, outDir = dir) {
  const files = await listFiles(dir);
  if (files.length === 0) return null;
  try {
    await writeFile(join(outDir, MANIFEST_FILE), `${JSON.stringify(files, null, 1)}\n`);
    return files.length;
  } catch (e) {
    console.warn(`[model-manifest] could not write ${join(outDir, MANIFEST_FILE)}: ${e.message}`);
    return null;
  }
}

/**
 * Describe a mirror: the repo roots under it, or the mirror itself when it is
 * the flat single-repo layout.
 *
 * A repo root is a directory holding vocab.txt, the one file every supported
 * layout keeps at the root (app/src/modelLayout.js), which is the same marker
 * docker/entrypoint.sh already uses to decide what a mount serves.
 *
 * @param {string} mirror Mirror root.
 * @param {string[]} repos Repo ids that may be nested under it.
 * @param {string} [outMirror=mirror] Mirror-shaped destination, for a read-only mount.
 * @returns {Promise<Array<{repo: string, dir: string, entries: number}>>} What was written.
 */
export async function writeMirrorManifests(mirror, repos, outMirror = mirror) {
  const written = [];
  const absent = [];
  const describe = async (repo, rel) => {
    const dir = rel ? join(mirror, rel) : mirror;
    // Distinguished from a write failure on purpose: one means the deployment
    // has no such weights, the other that it has them and could not say so.
    if (!existsSync(join(dir, 'vocab.txt'))) { absent.push(repo); return; }
    const outDir = rel ? join(outMirror, rel) : outMirror;
    try { mkdirSync(outDir, { recursive: true }); } catch { /* reported by writeManifest */ }
    const entries = await writeManifest(dir, outDir);
    if (entries !== null) written.push({ repo, dir, entries });
  };
  for (const repo of repos) await describe(repo, repo.split('/').join(sep));
  // The flat layout, which is the documented single-repo contract: only when no
  // repo subfolder answered, so a shared mount never also declares a root repo.
  if (written.length === 0) {
    absent.length = 0;
    await describe(repos[0] || '', '');
  } else if (absent.length > 0) {
    // A configured repo with nothing on the mount is not an error anywhere in
    // the stack: the app just fetches it from HuggingFace, and a visitor sees a
    // slow first load rather than a failure. Which makes it exactly the kind of
    // thing a deploy ships by accident and nobody notices, so say it out loud
    // here, where the repo list and the mount are both in hand.
    console.warn(`[model-manifest] WARNING: nothing on this mount serves ${absent.join(', ')}`
      + ' (configured, but no vocab.txt under that folder). The app will fetch it from HuggingFace instead.');
  }
  return written;
}

/**
 * Repo roots under `mirror`, as mirror-relative paths.
 *
 * The container and the CI fetch both know their repo list, but a maintainer's
 * mirror does not announce one, so the CLI can find them instead: a repo root is
 * a directory holding vocab.txt, the marker every supported layout keeps at the
 * root. Depth 2 covers the <owner>/<name> shape without walking a whole model
 * repo's working folder looking for more.
 *
 * @param {string} mirror Mirror root.
 * @param {number} [depth=2] Levels below `mirror` to look at.
 * @returns {Promise<string[]>} Mirror-relative paths ('' for the flat layout).
 */
export async function discoverRepoRoots(mirror, depth = 2) {
  const found = [];
  const walk = async (dir, rel, left) => {
    if (existsSync(join(dir, 'vocab.txt'))) { found.push(rel); return; }
    if (left === 0) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const child = join(dir, entry.name);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try { isDir = (await stat(child)).isDirectory(); } catch { continue; }
      }
      if (isDir) await walk(child, rel ? `${rel}/${entry.name}` : entry.name, left - 1);
    }
  };
  await walk(mirror, '', depth);
  return found.sort();
}

// CLI: node scripts/model-manifest.mjs <mirror> <repo,repo,...> [outMirror]
// An empty repo list means "find them", which is what a maintainer's mirror
// needs: it has no configured list to hand over.
// Used by docker/entrypoint.sh, which has no way to import this.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [mirror, repoList = '', outMirror] = process.argv.slice(2);
  if (!mirror) {
    console.error('usage: model-manifest.mjs <mirror-dir> <repo,repo,...> [out-dir]');
    process.exit(2);
  }
  let repos = repoList.split(',').map((r) => r.trim()).filter(Boolean);
  if (repos.length === 0) {
    repos = await discoverRepoRoots(mirror);
    console.log(`[model-manifest] found ${repos.length} repo root(s) under ${mirror}`);
  }
  const written = await writeMirrorManifests(mirror, repos, outMirror || mirror);
  for (const { repo, dir, entries } of written) {
    console.log(`[model-manifest] ${repo || relative(mirror, dir) || '(flat)'}: ${entries} entries from ${dir}`);
  }
  if (written.length === 0) console.log(`[model-manifest] nothing to describe under ${mirror}`);
}
