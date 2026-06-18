// Pure logic for cross-recording speaker matching (session-only feature).
//
// Each diarized recording gets one CAM++ voice embedding per local speaker
// (computed in speakerEmbedding.js). When the user names a speaker, that name +
// embedding becomes a "profile". A new recording's speakers are matched against
// the profiles built from the OTHER recordings, so the same voice can be
// auto-labelled with the same name within the session.
//
// Profiles are DERIVED from the current embeddings + the user's names rather
// than accumulated, so a rename is always consistent: a name's profile is the
// centroid (mean) of every embedding currently carrying that name, and undoing
// or changing a name simply changes what the next buildProfiles() produces. No
// voiceprint is persisted; this all lives in memory for the session.
//
// Built with Claude Code.

/** Cosine similarity of two equal-length numeric vectors (0 when either is 0). */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Build the named speaker profiles from per-entry embeddings + user names.
 *
 * @param {Object<string,Object<number,Float32Array|number[]>>} embeddingsByEntry
 *   entryId -> { speakerIndex -> embedding }
 * @param {Object<string,Object<number,string>>} namesByEntry
 *   entryId -> { speakerIndex -> name }
 * @param {string} [excludeEntryId] skip this entry (match a recording against
 *   the OTHERS, never its own labels)
 * @returns {Array<{name:string, centroid:Float32Array, count:number}>}
 *   one profile per distinct name, centroid = mean of its embeddings
 */
export function buildProfiles(embeddingsByEntry, namesByEntry, excludeEntryId = null) {
  const acc = new Map(); // name -> { sum: Float64Array, count }
  for (const entryId of Object.keys(embeddingsByEntry || {})) {
    if (entryId === excludeEntryId) continue;
    const embs = embeddingsByEntry[entryId] || {};
    const names = (namesByEntry && namesByEntry[entryId]) || {};
    for (const spk of Object.keys(embs)) {
      const name = names[spk];
      const emb = embs[spk];
      if (!name || !name.trim() || !emb || !emb.length) continue;
      const key = name.trim();
      let slot = acc.get(key);
      if (!slot) {
        slot = { sum: new Float64Array(emb.length), count: 0 };
        acc.set(key, slot);
      }
      if (slot.sum.length !== emb.length) continue; // guard mismatched dims
      for (let i = 0; i < emb.length; i++) slot.sum[i] += emb[i];
      slot.count += 1;
    }
  }
  const profiles = [];
  for (const [name, { sum, count }] of acc) {
    const centroid = new Float32Array(sum.length);
    for (let i = 0; i < sum.length; i++) centroid[i] = sum[i] / count;
    profiles.push({ name, centroid, count });
  }
  return profiles;
}

/**
 * Best-matching profile for an embedding, or null when none clears the
 * threshold. Ties break toward the higher score.
 *
 * @param {Float32Array|number[]} embedding
 * @param {Array<{name:string, centroid:Float32Array}>} profiles
 * @param {number} [threshold=0.5] minimum cosine similarity to accept a match
 * @returns {{name:string, score:number}|null}
 */
export function matchProfile(embedding, profiles, threshold = 0.5) {
  if (!embedding || !embedding.length || !profiles || profiles.length === 0) return null;
  let best = null;
  for (const p of profiles) {
    const score = cosineSimilarity(embedding, p.centroid);
    if (score >= threshold && (!best || score > best.score)) {
      best = { name: p.name, score };
    }
  }
  return best;
}

/**
 * Auto-assign names to a recording's speakers by matching each one's embedding
 * against profiles from the OTHER recordings. Only fills speakers that have no
 * name yet, so it never overwrites a name the user set on this entry.
 *
 * @returns {Object<number,string>} speakerIndex -> matched name (only matches)
 */
export function autoNameSpeakers(entryId, embeddingsByEntry, namesByEntry, threshold = 0.5) {
  const profiles = buildProfiles(embeddingsByEntry, namesByEntry, entryId);
  if (profiles.length === 0) return {};
  const embs = (embeddingsByEntry && embeddingsByEntry[entryId]) || {};
  const existing = (namesByEntry && namesByEntry[entryId]) || {};
  const assigned = {};
  for (const spk of Object.keys(embs)) {
    if (existing[spk]) continue; // don't clobber a user-set name
    const m = matchProfile(embs[spk], profiles, threshold);
    if (m) assigned[spk] = m.name;
  }
  return assigned;
}

/** Default cosine threshold for accepting a cross-recording voice match. */
export const DEFAULT_MATCH_THRESHOLD = 0.5;
