// Simple text tokenizer/decoder for Parakeet models (browser-friendly, fetch-only).

/**
 * Fetch a text file (tokens.txt or vocab.txt) and return its contents.
 * @param {string} url Remote URL or relative path served by the web app.
 * @returns {Promise<string>} Raw text content.
 */
async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.text();
}

/**
 * Tokenizer/decoder for Parakeet SentencePiece-style token vocabularies.
 */
export class ParakeetTokenizer {
  /**
   * @param {string[]} id2token Array where index=id and value=token string
   */
  constructor(id2token) {
    this.id2token = id2token;
    this.blankToken = '<blk>';
    this.unkToken = '<unk>';

    // Dynamically find blank token ID from vocabulary instead of hardcoding 1024,
    // which would break for models with different vocab sizes.
    this.blankId = id2token.findIndex(t => t === '<blk>');
    if (this.blankId === -1) {
      console.warn('[ParakeetTokenizer] Blank token <blk> not found in vocabulary, defaulting to 1024');
      this.blankId = 1024;
    }

    // Pre-compute sanitized tokens (replace SentencePiece marker ▁ with space)
    // so decode() doesn't repeat the replacement on every call.
    this.sanitizedTokens = this.id2token.map(t => t ? t.replace(/\u2581/g, ' ') : t);
  }

  /**
   * Create a tokenizer from a `vocab.txt` or `tokens.txt` URL.
   * @param {string} tokensUrl - URL to tokenizer vocabulary file.
   * @returns {Promise<ParakeetTokenizer>} Loaded tokenizer instance.
   */
  static async fromUrl(tokensUrl) {
    const text = await fetchText(tokensUrl);
    const lines = text.split(/\r?\n/).filter(Boolean);
    const id2token = [];
    for (const line of lines) {
      const [tok, idStr] = line.split(/\s+/);
      const id = parseInt(idStr, 10);
      if (isNaN(id) || !tok) {
        console.warn(`[ParakeetTokenizer] Skipping invalid vocab line: ${JSON.stringify(line)}`);
        continue;
      }
      id2token[id] = tok;
    }
    return new ParakeetTokenizer(id2token);
  }

  /**
   * Decode an array of token IDs into a human readable string.
   * Implements the SentencePiece rule where leading `▁` marks a space.
   * Matches the Python reference regex pattern: r"\A\s|\s\B|(\s)\b"
   * @param {number[]} ids - Token IDs from decoder output.
   * @returns {string} Decoded transcript text.
   */
  decode(ids) {
    // First pass: convert tokens to text using pre-sanitized lookup (▁ → space)
    const tokens = [];
    for (const id of ids) {
      if (id === this.blankId) continue;
      const token = this.sanitizedTokens[id];
      if (token === undefined) continue;
      // Skip <unk> tokens — the model emits these when it can't confidently
      // decode a frame; including them produces unreadable "<unk><unk>..." output.
      if (this.id2token[id] === this.unkToken) continue;
      tokens.push(token);
    }

    let text = tokens.join('');

    // Apply cleanup:
    // - Remove leading whitespace
    // - Remove space before sentence-ending punctuation only (. , ; : ! ?)
    //   The previous regex /\s+(?=[^\w\s])/g was too aggressive: it stripped
    //   spaces before ANY non-word character (including accented letters in JS
    //   without the /u flag, hyphens, quotes, etc.), causing words to squash.
    // - Collapse multiple consecutive punctuation (e.g. "..." → ".")
    // - Collapse multiple spaces into one
    text = text.replace(/^\s+/, '');
    text = text.replace(/\s+(?=[.,;:!?])/g, '');
    text = text.replace(/([.!?]){2,}/g, '$1');
    text = text.replace(/\s+/g, ' ');

    return text.trim();
  }
}
