// Request-body plumbing: size-capped reads, multipart parsing, and the temp
// file ffmpeg decodes from.
//
// NO DEPENDENCY: multipart/form-data is parsed by Node's own `Request.formData()`
// (undici), which is why this server needs no busboy/multer. The trade is that
// the whole body is buffered in memory, which is exactly why the cap below is
// enforced BEFORE buffering rather than after.
//
// Built with Claude Code.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { badRequest, tooLarge } from './errors.mjs';

// Field names clients use for the audio part. `file` is OpenAI and whisper.cpp;
// `audio_file` is whisper-asr-webservice; `audio` shows up in hand-rolled clients.
// Exported because params.mjs must skip exactly these keys when it validates the
// text fields: a second list there would drift, and a client sending `audio_file`
// would then be told the field is unknown.
export const FILE_FIELDS = ['file', 'audio_file', 'audio'];

/**
 * Read the request body, refusing to buffer more than `maxBytes`.
 *
 * Both checks matter: Content-Length rejects an honest oversized upload before a
 * single byte is read, and the running counter rejects a chunked/lying one
 * mid-stream (so `Transfer-Encoding: chunked` cannot bypass the cap).
 *
 * @returns {Promise<Buffer>}
 */
export function readBodyCapped(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(tooLarge(
      `request body is ${mib(declared)} MiB, over the ${mib(maxBytes)} MiB limit (--max-upload-mb)`,
    ));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      // Stop the client mid-upload; without this it keeps pushing a body nobody reads.
      req.destroy();
      reject(err);
    };
    req.on('data', (c) => {
      if (done) return;
      total += c.length;
      if (total > maxBytes) {
        fail(tooLarge(`request body exceeds the ${mib(maxBytes)} MiB limit (--max-upload-mb)`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(badRequest(`could not read request body: ${err.message}`)));
    req.on('aborted', () => fail(badRequest('client aborted the upload')));
  });
}

const mib = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Parse a buffered body into a FormData.
 *
 * Accepts multipart/form-data (what every OpenAI client sends) and
 * application/x-www-form-urlencoded (handy for a curl smoke test with no file,
 * though the file itself then has nowhere to go). Anything else is a 400 naming
 * what was sent, because "unsupported content type" with no detail is the single
 * most confusing failure when wiring up a client.
 *
 * @returns {Promise<FormData>}
 */
export async function parseBody({ contentType, buffer }) {
  const ct = String(contentType || '');
  const mime = ct.split(';')[0].trim().toLowerCase();
  if (mime !== 'multipart/form-data' && mime !== 'application/x-www-form-urlencoded') {
    throw badRequest(
      `expected multipart/form-data (or application/x-www-form-urlencoded), got "${mime || 'nothing'}". `
      + 'Send the audio as a file part named "file".',
    );
  }
  if (mime === 'multipart/form-data' && !/boundary=/i.test(ct)) {
    throw badRequest('multipart/form-data content-type has no boundary parameter');
  }
  try {
    // A Request is the only public API that exposes undici's multipart parser.
    return await new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': ct },
      body: buffer,
    }).formData();
  } catch (err) {
    throw badRequest(`malformed form body: ${err.message}`);
  }
}

/**
 * Pull the audio part out of a parsed form.
 *
 * @returns {Promise<{bytes:Buffer, filename:string, mime:string}>}
 */
export async function extractFile(form) {
  for (const field of FILE_FIELDS) {
    const value = form.get(field);
    if (!value) continue;
    if (typeof value === 'string') {
      throw badRequest(`field "${field}" must be a file part, not a text field`, { param: field });
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    if (!bytes.length) throw badRequest(`uploaded file "${field}" is empty`, { param: field });
    return { bytes, filename: value.name || 'upload', mime: value.type || '' };
  }
  throw badRequest(
    `no audio file in the request: expected a file part named ${FILE_FIELDS.map((f) => `"${f}"`).join(' or ')}`,
    { param: 'file' },
  );
}

/**
 * Create the server's temp directory for uploads (0700, inside os.tmpdir()).
 * The container mounts /tmp as tmpfs, so uploads never touch the read-only
 * rootfs and never outlive a restart.
 */
export function createUploadDir() {
  return mkdtempSync(join(tmpdir(), 'parakeet-api-'));
}

/** Remove the upload directory (best effort, at shutdown). */
export function removeUploadDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* shutting down anyway */ }
}

/**
 * Write an upload to disk, hand the path to `fn`, then always delete it.
 *
 * ffmpeg needs a real path (it seeks, and container formats like MP4 are not
 * streamable from a pipe), so the bytes must land on disk.
 *
 * SECURITY: the on-disk name is random and the extension fixed. The client's
 * filename is never used to build a path -- it is attacker-controlled and would
 * be a traversal ("../../etc/cron.d/x") or an extension trick otherwise. ffmpeg
 * sniffs the container from the content, so the extension buys nothing anyway.
 */
export async function withTempFile(dir, bytes, fn) {
  const path = join(dir, `${randomBytes(16).toString('hex')}.upload`);
  await writeFile(path, bytes, { mode: 0o600 });
  try {
    return await fn(path);
  } finally {
    await unlink(path).catch(() => { /* already gone, or tmpfs cleared */ });
  }
}
