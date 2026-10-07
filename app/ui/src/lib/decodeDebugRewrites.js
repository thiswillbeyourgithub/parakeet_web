// Which decoded tokens a text layer rewrote, for the decode-debug view: it
// rebuilds one chunk's text from its token pieces, runs the drug/term rules
// on it through traceDrugRules, and maps each rewrite back onto the tokens
// whose characters it replaced.
//
//   pieces ["▁par", "▁l", "'", "an", "anas", "▁de", "▁l", "'", "um", "ab", "."]
//   -> [{first: 1, last: 9, from: "l'ananas de l'umab", to: "lanadelumab", rules: [...]}]
//
// Per chunk rather than on the stitched transcript, because the pills are per
// chunk: a word cut by a chunk seam is fixed in the transcript but not here.
// Kept free of DOM/React (test/unit/decode-debug-rewrites.test.mjs).
//
// Built with Claude Code.

import { traceDrugRules } from './drugRules.js';

/**
 * @param {Array<{piece?: string}>} tokens One chunk's decoded tokens.
 * @param {object|null} compiled loadDrugRules output, or null when the layer is off.
 * @returns {Array<{first: number, last: number, from: string, to: string, rules: number[]}>}
 *   Token index ranges (inclusive), in token order.
 */
export function tokenRewrites(tokens, compiled) {
  if (!compiled || !tokens?.length) return [];
  // Each token's characters, without the word-start space, in the chunk text.
  const ranges = [];
  let text = '';
  for (const tok of tokens) {
    const label = String(tok.piece ?? '').replace(/▁/g, ' ');
    const lead = label.length - label.trimStart().length;
    ranges.push([text.length + lead, text.length + label.length]);
    text += label;
  }
  const out = [];
  for (const r of traceDrugRules(text, compiled).rewrites) {
    const hit = [];
    ranges.forEach(([s, e], i) => { if (s < e && s < r.end && e > r.start) hit.push(i); });
    if (hit.length) out.push({ first: hit[0], last: hit[hit.length - 1], from: r.from.trim(), to: r.to.trim(), rules: r.rules });
  }
  return out;
}
