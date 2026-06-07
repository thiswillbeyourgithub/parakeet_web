// Shared phrase-boost "compile" pipeline.
//
// Turns a boost-phrase .txt blob into the serialized artifact (token-id
// encoding) that the browser reuses to build the BoostingTrie WITHOUT re-running
// the per-phrase BPE encode (the only expensive part for a 10k-100k clinical
// list). This is the single source of truth for both:
//   - the container-boot prebuild (docker/prebuild-boost.mjs), and
//   - the operator-run compiler (scripts/compile-boost.mjs, which writes .pwc),
// so the on-disk format, the vocab-signature pinning and the augment-default can
// never drift between them. Reuses the exact browser code paths (parseVocabText
// + BpeEncoder + parseBoostPhrases + expandAugmentations + encodePhrases), so
// the ids it emits are byte-for-byte what the UI would have produced.
//
// The artifact (the .pwc the operator ships, and the .json the container serves
// and the browser fetches) is:
//   { version, vocabSig, augmentDefault, encoded, skipped }
// The .pwc is written gzip-compressed (writePwc/readPwc) since it is only read
// back by Node (the boot prebuild + scripts/transcribe.mjs), never fetched by a
// browser; the served .json stays plain JSON (the browser parses it directly,
// and Caddy gzip/zstd-compresses it on the wire anyway).
// `vocabSig` pins it to the exact tokenizer vocab it was built against; on a
// mismatch the boot reuse check (and the browser) re-encode from the .txt, so a
// stale artifact is never wrong, only ignored. `version` lets a future format
// change reject an old artifact rather than misread it.
//
// Node-only: imports node:fs to read the vocab + merges. MUST NOT be imported
// from the browser bundle (App.jsx). Built with Claude Code.

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseVocabText } from './tokenizer.js';
import { BpeEncoder, buildVocabToId, vocabSignature } from './bpeEncoder.js';
import { parseBoostPhrases, parseBoostDirectives, expandAugmentations, encodePhrases } from './phraseBoost.js';

/**
 * Augmentation-default baked into the compiled artifact. The browser leaves the
 * global "Augment" toggle OFF by default (no augmentation), so compiling at the
 * same default lets it reuse these ids without a re-encode; it falls back to
 * encoding the .txt itself when the user has flipped the toggle ON
 * (augmentDefault mismatch). Per-phrase `:AUG` flags are honoured here
 * regardless, exactly as in the UI.
 */
export const AUGMENT_DEFAULT = '';

/**
 * On-disk artifact format version. Bump when the shape of `encoded` (or any
 * other field a consumer relies on) changes incompatibly, so an old .pwc / .json
 * is rejected by {@link isReusableArtifact} and re-encoded instead of misread.
 * v2: per-phrase flags switched from casing (`:s`/`:i`) to augmentation
 * (`:f`/`:a`/`:p`), changing the expanded surface forms an `:i` phrase yields.
 */
export const BOOST_ARTIFACT_VERSION = 2;

/**
 * Build the BPE encoder and its vocab signature from a model's vocab.txt plus
 * the bundled bpe-merges.json. The signature pins any artifact compiled with
 * this encoder to this exact vocab.
 * @param {string} vocabPath Path to the model's vocab.txt.
 * @param {string} mergesPath Path to bpe-merges.json.
 * @returns {{ encoder: BpeEncoder, vocabSig: string, tokenCount: number }}
 */
export function loadBoostEncoder(vocabPath, mergesPath) {
  const id2token = parseVocabText(readFileSync(vocabPath, 'utf-8'));
  if (!id2token.length) throw new Error(`vocab at ${vocabPath} parsed to 0 tokens.`);
  const asset = JSON.parse(readFileSync(mergesPath, 'utf-8'));
  const encoder = new BpeEncoder(asset, buildVocabToId(id2token));
  return { encoder, vocabSig: vocabSignature(id2token), tokenCount: id2token.length };
}

/**
 * Compile a boost-phrase .txt blob into the serialized artifact. Runs the exact
 * browser parse -> augment-expand -> encode pipeline, so the token ids match
 * what the UI would produce for the same list and tokenizer. The list's own
 * `#!prefixes` directive (if any) drives the `p` augmentation, just like the UI.
 * @param {string} raw The .txt contents.
 * @param {BpeEncoder} encoder Built by {@link loadBoostEncoder}.
 * @param {string} vocabSig The encoder's vocab signature (recorded in the artifact).
 * @param {Object} [opts]
 * @param {string} [opts.augmentDefault=AUGMENT_DEFAULT] Augmentation default the expansion is baked at.
 * @returns {{ artifact: {version:number, vocabSig:string, augmentDefault:string, encoded:Array, skipped:string[]}, parsedCount:number, expandedCount:number }}
 */
export function compileBoostText(raw, encoder, vocabSig, opts = {}) {
  const augmentDefault = opts.augmentDefault ?? AUGMENT_DEFAULT;
  const { prefixes } = parseBoostDirectives(raw);
  const parsed = parseBoostPhrases(raw).filter((p) => p.phrase);
  const entries = expandAugmentations(parsed, augmentDefault, prefixes);
  const { encoded, skipped } = encodePhrases(entries, encoder);
  return {
    artifact: { version: BOOST_ARTIFACT_VERSION, vocabSig, augmentDefault, encoded, skipped },
    parsedCount: parsed.length,
    expandedCount: entries.length,
  };
}

/**
 * Serialize a compiled artifact to a .pwc file as gzip-compressed JSON. The
 * .pwc is the operator-shipped cache (scripts/compile-boost.mjs output); the
 * browser never fetches it (the container re-serializes a plain .json from it
 * at boot), so compressing it only shrinks the stored/shipped artifact and can
 * never affect what the UI parses. Token-id arrays compress well, so a clinical
 * list's .pwc drops several-fold.
 * @param {string} path Output path (conventionally .pwc).
 * @param {any} artifact The artifact object from {@link compileBoostText}.
 */
export function writePwc(path, artifact) {
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(artifact), 'utf-8')));
}

/**
 * Read and parse a .pwc artifact written by {@link writePwc}. The on-disk form
 * is gzip-compressed JSON, detected by the gzip magic bytes (0x1f 0x8b) rather
 * than the extension, so a plain-JSON .pwc compiled before compression was
 * added is still accepted unchanged.
 * @param {string} path Path to the .pwc file.
 * @returns {any} The parsed artifact object.
 */
export function readPwc(path) {
  const buf = readFileSync(path);
  const text = (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
    ? gunzipSync(buf).toString('utf-8')
    : buf.toString('utf-8');
  return JSON.parse(text);
}

/**
 * Whether a parsed artifact's token ids are valid for the given vocab: the
 * format version is current, the vocab signature matches, and `encoded` is an
 * array. This is the minimum needed before trusting the pre-encoded ids (a
 * mismatch means the ids index a different vocab and would be meaningless).
 * Augmentation is NOT considered here, since a consumer that reuses the ids
 * as-is (e.g. scripts/transcribe.mjs) accepts whatever augmentation expansion
 * the artifact was baked at; the browser-toggle reuse adds that check via
 * {@link isReusableArtifact}.
 * @param {any} artifact Parsed .pwc / .json object.
 * @param {string} vocabSig Signature of the currently loaded vocab.
 * @returns {boolean}
 */
export function artifactMatchesVocab(artifact, vocabSig) {
  return !!artifact
    && artifact.version === BOOST_ARTIFACT_VERSION
    && artifact.vocabSig === vocabSig
    && Array.isArray(artifact.encoded);
}

/**
 * Whether a parsed artifact can be reused as-is for the given vocab +
 * augmentation default, letting the boot prebuild skip the encode. Builds on
 * {@link artifactMatchesVocab} and additionally requires the augmentation
 * default to match, since the browser only reuses the ids when its global
 * "Augment" toggle still agrees with how the artifact was expanded.
 * @param {any} artifact Parsed .pwc / .json object.
 * @param {string} vocabSig Signature of the currently loaded vocab.
 * @param {string} [augmentDefault=AUGMENT_DEFAULT]
 * @returns {boolean}
 */
export function isReusableArtifact(artifact, vocabSig, augmentDefault = AUGMENT_DEFAULT) {
  return artifactMatchesVocab(artifact, vocabSig)
    && (artifact.augmentDefault ?? '') === augmentDefault;
}
