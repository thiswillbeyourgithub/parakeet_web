// Byte-capped text fetch, shared by the main thread (App.jsx: the
// dictation-regex and boost-phrase loaders) and the phrase-boost worker (which
// fetches the server-prebuilt boost encoding itself, so that the multi-MB
// JSON.parse never lands on the main thread).
//
// F-102: a poisoned upstream that fed the entrypoint a multi-GB body would
// otherwise OOM the tab when we call .text() with no cap. The entrypoint
// enforces the same cap server-side (defense in depth); this re-enforces it
// client-side because a host-side write to /var/regex or /var/boost can bypass
// that.
//
// Built with Claude Code.

/**
 * Default cap for anything served out of the operator's static content
 * directory (dictation-regex CSVs, boost-phrase TXTs).
 */
export const SERVED_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetch text from `url`, streaming and aborting if the body exceeds `maxBytes`.
 *
 * @param {string} url
 * @param {number} [maxBytes]
 * @returns {Promise<{ok: true, text: string} | {ok: false, status?: number, oversize?: true, declared?: number}>}
 *   `{ok:true, text}` on success, `{ok:false, status}` for a non-2xx response,
 *   or `{ok:false, oversize:true, declared}` when the body is too large
 *   (`declared` = the byte count that tripped the cap).
 */
export async function fetchTextCapped(url, maxBytes = SERVED_FILE_MAX_BYTES) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, status: res.status };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { res.body?.cancel(); } catch (_) { /* noop */ }
    return { ok: false, oversize: true, declared };
  }
  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming body (an old engine, or a mocked Response). The cap can only
    // be applied AFTER the whole body is materialised here, so this branch is
    // about refusing to hand oversize content on, not about avoiding the
    // allocation. Measure UTF-8 BYTES: `text.length` counts UTF-16 code units,
    // so a body of multi-byte characters (any non-ASCII boost-phrase list) can
    // be well over the byte cap this module exists to enforce and still pass.
    const text = await res.text();
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > maxBytes) {
      return { ok: false, oversize: true, declared: bytes };
    }
    return { ok: true, text };
  }
  let total = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { reader.cancel(); } catch (_) { /* noop */ }
      return { ok: false, oversize: true, declared: total };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return { ok: true, text: new TextDecoder('utf-8').decode(merged) };
}
