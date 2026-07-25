// Server-side phrase-boost wordlists: what a request selects by name, and the
// cache that makes selecting one cheap.
//
// The lists live in a read-only directory (--wordlist-dir). Two file kinds are
// accepted, both already understood by buildPhraseBoost():
//   *.txt  plain phrase lists (one per line, "phrase:WEIGHT:MINP:FLAG" honoured)
//   *.pwc  precompiled by scripts/compile-boost.mjs -- pre-encoded token ids,
//          so a 1.7 MB medical list costs no BPE encoding at all
//
// WHY A CACHE: building the trie for french_medical.txt means BPE-encoding tens
// of thousands of phrases. Doing that per request would dwarf the transcription
// itself. Tries are therefore cached by (list, inline phrases, depth-scaling) --
// exactly the inputs that are BAKED INTO the trie at build time.
//
// `strength` and `minpOverride` are deliberately NOT part of the cache key: in
// phraseBoost.js both are read at decode time (`logits[id] += this.strength *
// boost.bonus`), never baked, so one cached trie serves every strength. The
// engine assigns them right before each run, which is only safe because jobs are
// strictly serialised by queue.mjs (one decode at a time, so no other request
// can observe the mutated trie).
//
// SECURITY: a request names a list, so the name is attacker-controlled. Names
// are matched against the directory listing taken at boot rather than
// path-joined, which makes traversal ("../../etc/passwd", absolute paths,
// symlink games) structurally impossible instead of merely filtered.
//
// Built with Claude Code.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { badRequest } from './errors.mjs';
import { buildPhraseBoost } from '../../transcribe.mjs';

// Cap on distinct cached tries. Small on purpose: each one can hold hundreds of
// thousands of nodes, and real deployments use one or two lists.
const CACHE_MAX = 8;

/**
 * @param {object} opts
 * @param {string} opts.dir directory holding the lists ('' = no lists at all)
 * @param {object} opts.tokenizer loaded ParakeetTokenizer (for BPE encoding)
 * @param {boolean} [opts.verbose]
 */
export function createWordlistRegistry({ dir, tokenizer, verbose = false }) {
  // Snapshot the directory once at boot. A stable listing is what makes name
  // resolution safe (see SECURITY above); it also means adding a list needs a
  // restart, which is the right trade for a read-only-rootfs container.
  const files = new Map();   // basename (no extension) -> absolute path
  if (dir) {
    // A configured-but-absent directory is a warning, not a fatal error: the
    // container image sets PARAKEET_WORDLIST_DIR=/wordlists by default, and an
    // operator who never mounts anything there just gets no wordlists. A
    // *requested* wordlist still fails loudly, in resolve() below.
    let entries;
    try {
      entries = readdirSync(dir);
    } catch (err) {
      console.error(`[parakeet-api] warning: cannot read wordlist directory ${dir}: ${err.message} `
        + '(no wordlists will be available)');
      entries = [];
    }
    for (const entry of entries) {
      const m = /^(.+)\.(txt|pwc)$/i.exec(entry);
      if (!m) continue;
      const full = join(dir, entry);
      try {
        if (!statSync(full).isFile()) continue;
      } catch { continue; }
      // A .pwc wins over a same-named .txt: it is the precompiled form of the
      // very same list, and skipping the re-encode is the whole point of it.
      const name = m[1];
      const isPwc = m[2].toLowerCase() === 'pwc';
      if (!files.has(name) || isPwc) files.set(name, full);
    }
  }

  /** @type {Map<string, object|null>} cacheKey -> trie */
  const cache = new Map();

  /** Names a request may pass as `phrase_boost`. */
  function list() { return [...files.keys()].sort(); }

  /** Resolve a requested name to a path, or throw a 400 that lists the options. */
  function resolve(name) {
    const path = files.get(name);
    if (!path) {
      const known = list();
      throw badRequest(
        `unknown wordlist "${name}"`
        + (known.length ? `; available: ${known.join(', ')}` : '; this server has no wordlist directory configured'),
        { param: 'phrase_boost' },
      );
    }
    return path;
  }

  /**
   * Get (building once, then reusing) the boosting trie for one request.
   *
   * @param {object} a
   * @param {string} a.name    wordlist name, '' for none
   * @param {string} a.inline  inline phrases from the `prompt` field, '' for none
   * @param {number} a.strength
   * @param {number|null} a.minp
   * @param {number|null} a.depthScaling
   * @returns {Promise<object|null>} the trie, or null when nothing is boosted
   */
  async function get({ name = '', inline = '', strength = 1, minp = null, depthScaling = null }) {
    const specs = [];
    if (name) specs.push(resolve(name));
    if (inline.trim()) specs.push(inline);
    if (!specs.length) return null;

    // Only the baked-in inputs belong in the key (see the header note).
    const key = [
      name,
      inline.trim() ? `sha256:${createHash('sha256').update(inline).digest('hex')}` : '',
      depthScaling == null ? 'default' : String(depthScaling),
    ].join('|');

    if (cache.has(key)) {
      const hit = cache.get(key);
      // Refresh LRU position.
      cache.delete(key);
      cache.set(key, hit);
      return applyRuntimeKnobs(hit, strength, minp);
    }

    const trie = await buildPhraseBoost({
      boosts: specs,
      strength,
      depthScaling: depthScaling == null ? undefined : depthScaling,
      minpOverride: minp,
      tokenizer,
      // The CLI's per-phrase listing would print thousands of lines per request.
      quiet: !verbose,
      verbose,
    });
    cache.set(key, trie);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return applyRuntimeKnobs(trie, strength, minp);
  }

  return { list, resolve, get, get size() { return files.size; } };
}

// Apply the two decode-time knobs to a (possibly cached) trie. Returns the trie
// so callers can inline the call.
function applyRuntimeKnobs(trie, strength, minp) {
  if (!trie) return null;
  trie.strength = strength;
  trie.minpOverride = minp;      // null = each phrase keeps its own baked gate
  return trie;
}
