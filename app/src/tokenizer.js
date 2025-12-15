// Simple text tokenizer/decoder for Parakeet models (browser-friendly, fetch-only).

/**
 * Fetch a text file (tokens.txt or vocab.txt) and return its contents.
 * @param {string} url Remote URL or relative path served by the web app.
 */
async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.text();
}

export class ParakeetTokenizer {
  /**
   * @param {string[]} id2token Array where index=id and value=token string
   */
  constructor(id2token) {
    this.id2token = id2token;
    this.blankToken = '<blk>';
  }

  static async fromUrl(tokensUrl) {
    const text = await fetchText(tokensUrl);
    const lines = text.split(/\r?\n/).filter(Boolean);
    const id2token = [];
    for (const line of lines) {
      const [tok, idStr] = line.split(/\s+/);
      const id = parseInt(idStr, 10);
      id2token[id] = tok;
    }
    return new ParakeetTokenizer(id2token);
  }

  /**
   * Decode an array of token IDs into a human readable string.
   * Implements the SentencePiece rule where leading `▁` marks a space.
   * @param {number[]} ids
   * @returns {string}
   */
  decode(ids) {
    let text = '';
    for (const id of ids) {
      const token = this.id2token[id];
      if (token === undefined) continue;
      if (token === this.blankToken) continue;
      if (token.startsWith('▁')) {
        text += ' ' + token.slice(1);
      } else {
        text += token;
      }
    }
    return text.trim();
  }
} 