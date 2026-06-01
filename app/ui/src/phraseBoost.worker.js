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

import { BpeEncoder, buildVocabToId, BPE_ASSET_URL } from '../../src/bpeEncoder.js';
import { encodePhrases } from '../../src/phraseBoost.js';

// The BPE asset is identical across requests, so fetch + parse it once. The
// encoder is rebuilt only when the tokenizer vocabulary changes (model swap),
// detected via a cheap signature rather than holding a cross-thread reference.
let cachedAsset = null;
let cachedEncoder = null;
let cachedVocabSig = null;

async function getEncoder(id2token, assetUrl) {
  if (!cachedAsset) {
    const resp = await fetch(assetUrl);
    if (!resp.ok) throw new Error(`[BoostWorker] failed to fetch ${assetUrl}: ${resp.status}`);
    cachedAsset = await resp.json();
  }
  // Vocab signature: length plus first/last piece. Two distinct model vocabs
  // never collide on all three, and rebuilding the encoder (parsing merges into
  // a Map) on a false miss would only cost a few ms.
  const sig = `${id2token.length}:${id2token[0]}:${id2token[id2token.length - 1]}`;
  if (!cachedEncoder || cachedVocabSig !== sig) {
    cachedEncoder = new BpeEncoder(cachedAsset, buildVocabToId(id2token));
    cachedVocabSig = sig;
  }
  return cachedEncoder;
}

self.onmessage = async (e) => {
  const { id, entries, id2token, assetUrl = BPE_ASSET_URL } = e.data || {};
  try {
    const encoder = await getEncoder(id2token, assetUrl);
    const { encoded, skipped } = encodePhrases(entries, encoder);
    self.postMessage({ id, ok: true, encoded, skipped });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
