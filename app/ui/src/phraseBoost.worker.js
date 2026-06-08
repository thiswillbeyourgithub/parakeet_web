// Phrase-boost encode worker.
//
// Encoding a boost-phrase list to token-id sequences is the CPU-heavy part of
// building the BoostingTrie (the BPE merge loop in BpeEncoder runs once per
// phrase, and large clinical lists can be 10k-100k phrases). Running it on the
// main thread freezes the UI for the duration; this module-worker moves it off
// the main thread. It only encodes: the cheap trie insert (and the tiny
// per-decode-step boost) stays on the main thread, which is where the decoder
// lives. See App.jsx (the build effect) and phraseBoost.js (encodePhrases /
// BoostingTrie.buildFromEncoded) for the two halves.
//
// Protocol: postMessage({ id, entries, id2token, assetUrl }) ->
//   postMessage({ id, ok: true, encoded, skipped })  on success
//   postMessage({ id, ok: false, error })            on failure
// `id` echoes the request so the caller can ignore stale (superseded) replies.

import { BpeEncoder, buildVocabToId, BPE_ASSET_URL, vocabSignature } from '../../src/bpeEncoder.js';
import { encodePhrases } from '../../src/phraseBoost.js';

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
  }
  return cachedEncoder;
}

self.onmessage = async (e) => {
  const { id, entries, id2token, assetUrl = BPE_ASSET_URL } = e.data || {};
  try {
    const encoder = await getEncoder(id2token, assetUrl);
    // Cap accumulated stale (removed-line) entries: once the cache is more than
    // 2x the current variant count, most of it is dead, so start fresh. This
    // request then re-encodes once and the cache tracks the live set again.
    if (encodeCache.size > (entries?.length || 0) * 2) encodeCache = new Map();
    const { encoded, skipped } = encodePhrases(entries, encoder, { cache: encodeCache });
    self.postMessage({ id, ok: true, encoded, skipped });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
