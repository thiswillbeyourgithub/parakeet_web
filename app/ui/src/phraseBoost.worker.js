// Phrase-boost compile worker.
//
// Turning a boost-phrase list into token-id sequences is the CPU-heavy part of
// building the BoostingTrie, and every step of it is heavy on a large clinical
// list (75k lines): the parse ~90 ms, the conflict scan ~90 ms, the augmentation
// expansion ~1 s (it fans 75k phrases out to ~330k surface forms), and the BPE
// merge loop more still. Running any of that on the main thread freezes the UI;
// this module-worker owns the whole chain (compileBoostList) so the main thread
// only does the cheap trie insert, which is where the decoder lives.
// See App.jsx (the rebuild effect) and phraseBoost.js (compileBoostList /
// BoostingTrie.buildFromEncoded) for the two halves.
//
// Protocol: postMessage({ id, text, augmentDefault, encode, id2token, assetUrl }) ->
//   postMessage({ id, ok: true, phraseCount, expandedCount, warnings, conflicts,
//                 encoded, skipped })                on success
//   postMessage({ id, ok: false, error })            on failure
// `id` echoes the request so the caller can ignore stale (superseded) replies.
// `encode: false` asks for a parse-only pass (phraseCount/warnings/conflicts,
// with `encoded: null`): that is what the caller wants when no model is loaded
// yet, or when a server-prebuilt encoding is being reused, and it skips both the
// expansion and the BPE loop.
//
// Built with Claude Code.

import { BpeEncoder, buildVocabToId, BPE_ASSET_URL, vocabSignature } from '../../src/bpeEncoder.js';
import { compileBoostList, packEncoded, packedTransferables } from '../../src/phraseBoost.js';

// The BPE asset is identical across requests, so fetch + parse it once. The
// encoder is rebuilt only when the tokenizer vocabulary changes (model swap),
// detected via a cheap signature rather than holding a cross-thread reference.
let cachedAsset = null;
let cachedEncoder = null;
let cachedVocabSig = null;

// Surface-form -> ids memo, persisted across requests so a rebuild after a
// hand-edit only re-encodes the variants that actually changed (the whole list
// re-encode is otherwise the dominant cost, ~seconds on a large augmented list;
// see encodePhrases). The ids index the current vocab, so the cache is dropped
// whenever the encoder is rebuilt for a new vocab (below). Removed phrases leave
// stale entries behind, so it is also pruned when it grows well past the live
// working set (a fresh Map repopulates from this request's hits, no re-encode).
let encodeCache = new Map();

// Expanded-entry count of the last encode, used to size the cache prune. The
// prune has to run BEFORE the encode (pruning after would drop the entries this
// request just populated and force a full re-encode next time), and only the
// expansion knows the real working-set size, so we go by the previous request's
// count: consecutive rebuilds of the same list differ by an edit or two.
let lastExpandedCount = 0;

async function getEncoder(id2token, assetUrl) {
  if (!cachedAsset) {
    const resp = await fetch(assetUrl);
    if (!resp.ok) throw new Error(`[BoostWorker] failed to fetch ${assetUrl}: ${resp.status}`);
    cachedAsset = await resp.json();
  }
  // Vocab signature (shared helper): a false miss only costs rebuilding the
  // encoder (parsing merges into a Map), a few ms.
  const sig = vocabSignature(id2token);
  if (!cachedEncoder || cachedVocabSig !== sig) {
    cachedEncoder = new BpeEncoder(cachedAsset, buildVocabToId(id2token));
    cachedVocabSig = sig;
    encodeCache = new Map(); // ids index the old vocab; drop them
    lastExpandedCount = 0;
  }
  return cachedEncoder;
}

self.onmessage = async (e) => {
  const {
    id, text, augmentDefault = '', encode = true, id2token, assetUrl = BPE_ASSET_URL,
  } = e.data || {};
  try {
    const encoder = encode ? await getEncoder(id2token, assetUrl) : null;
    // Cap accumulated stale (removed-line) entries: once the cache is more than
    // 2x the live variant count, most of it is dead, so start fresh. This
    // request then re-encodes once and the cache tracks the live set again.
    if (encoder && lastExpandedCount && encodeCache.size > lastExpandedCount * 2) {
      encodeCache = new Map();
    }
    const result = compileBoostList(text, encoder, { augmentDefault, cache: encodeCache });
    if (encoder) lastExpandedCount = result.expandedCount;
    // Hand the ids over as packed typed arrays, TRANSFERRED (zero copy): the
    // encoding is ~330k entries for a large clinical list, and cloning that many
    // objects costs the receiving main thread ~450 ms, which would undo much of
    // what moving the work here bought. Nothing in this worker reads `encoded`
    // after the reply (the cache is keyed by surface form, not by entry), so
    // neutering the buffers is safe.
    const packed = result.encoded ? packEncoded(result.encoded) : null;
    self.postMessage(
      { ...result, id, ok: true, encoded: packed },
      packed ? packedTransferables(packed) : [],
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
