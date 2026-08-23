// Static server for the tier-3 full-transcription E2E. Serves the built UI
// (app/ui/dist) plus the model weights at /models/<file> (flat layout, matching
// hub.js getLocalModelFile), with the COOP/COEP/CORP headers ORT needs for
// cross-origin-isolated WASM threading. Boots from playwright.config.js.
//
// The weights are read from PARAKEET_E2E_MODEL_DIR (default ./fallback_models).
// CI populates that dir with the three int8 files via `npm run e2e:models`.
// The app build itself can be overridden with PARAKEET_E2E_DIST_DIR (default
// app/ui/dist): benchmark harnesses serve two builds side by side with it
// (e.g. an ORT-version A/B, or the current tip against the deployed tip).
// No external deps so the E2E webServer has nothing to install.
//
// Built with Claude Code.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDanglingLinks, danglingLinksMessage, danglingLinksWarning } from './dangling-links.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(here, '../..');
const DIST = resolve(process.env.PARAKEET_E2E_DIST_DIR || resolve(ROOT, 'app/ui/dist'));
const MODEL_DIR = resolve(process.env.PARAKEET_E2E_MODEL_DIR || join(ROOT, 'fallback_models'));
// Curated boost-phrase lists (manifest.txt + <name>.txt + optional prebuilt
// <name>.json), mirroring what Caddy serves at /boost-phrases/* in production.
// Lets a spec exercise the curated-list + prebuilt-artifact path without weights.
const BOOST_DIR = resolve(process.env.PARAKEET_E2E_BOOST_DIR || join(here, 'fixtures/boost-phrases'));
const PORT = parseInt(process.env.PORT, 10) || 4178;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
};

// Cross-origin isolation: required so SharedArrayBuffer (ORT WASM threads) is
// available. CORP same-origin keeps same-origin sub-resources loadable under COEP.
function setHeaders(res, filePath) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
}

function sendFile(req, res, filePath, status = 200) {
  setHeaders(res, filePath);
  res.statusCode = status;
  // HEAD: headers only, no body. The local-fallback model resolver (hub.js)
  // HEAD-probes candidate weights (the fp32 sidecar is ~2.4 GB) to decide
  // the quant; streaming the file would read the whole thing off disk for a
  // metadata-only request, so short-circuit with Content-Length and end.
  if (req.method === 'HEAD') {
    try { res.setHeader('Content-Length', statSync(filePath).size); } catch { /* ignore */ }
    return res.end();
  }
  createReadStream(filePath).on('error', () => { res.statusCode = 500; res.end('read error'); }).pipe(res);
}

// Resolve a request path safely under a base dir (no traversal outside it).
function safeJoin(base, reqPath) {
  const p = normalize(join(base, reqPath));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname); }
  catch { res.statusCode = 400; return res.end('bad request'); }

  // Model weights: flat layout under /models, served from MODEL_DIR.
  //
  // The sharded fp32 encoder (parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py) lives in MODEL_DIR/sharded/:
  // a rewritten encoder-model.onnx graph whose tensors point at the
  // encoder-model.onnx.data.NNN shards (each < 2 GB so the fp32 encoder can
  // ingest on WASM, exercised by transcription-fp32-wasm.spec.js). For exactly
  // those files we look in sharded/ FIRST, because the root also holds a
  // single-sidecar encoder-model.onnx (external_data -> one 2.4 GB file WASM
  // cannot load); the sharded graph must win. Every other request (int8 weights,
  // vocab) is served straight from the root. When MODEL_DIR/sharded/ is absent
  // (CI, or a checkout where scripts/shard-fp32.py was never run) the lookup falls
  // through to the root and the fp32 spec finds no shards and skips itself.
  if (pathname.startsWith('/models/')) {
    const rel = pathname.slice('/models'.length);
    const preferSharded = /^\/(encoder-model\.onnx|encoder-model\.onnx\.data\.\d+)$/.test(rel);
    const dirs = preferSharded ? [join(MODEL_DIR, 'sharded'), MODEL_DIR] : [MODEL_DIR];
    for (const dir of dirs) {
      const filePath = safeJoin(dir, rel);
      if (filePath && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(req, res, filePath);
    }
    res.statusCode = 404;
    setHeaders(res, '.txt');
    return res.end(`model file not found: ${pathname} (looked in ${MODEL_DIR})`);
  }

  // Curated boost-phrase lists, served from BOOST_DIR (no isolation headers
  // needed; these are plain fetches). A missing file is a 404 so the app's
  // soft-miss handling kicks in, exactly as in production.
  if (pathname.startsWith('/boost-phrases/')) {
    const filePath = safeJoin(BOOST_DIR, pathname.slice('/boost-phrases'.length));
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(req, res, filePath);
    res.statusCode = 404;
    setHeaders(res, '.txt');
    return res.end(`boost-phrases file not found: ${pathname}`);
  }

  // Static app, with SPA fallback to index.html.
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = safeJoin(DIST, rel);
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(req, res, filePath);
  return sendFile(req, res, join(DIST, 'index.html'));
});

// A dangling symlink in the SERVED part of the model dir is always a broken
// checkout, and it lies in the most expensive way: the harness reads it as
// "weights absent" and sends you off to re-download weights that are sitting
// right there. Die before any spec runs, with the real diagnosis. Deeper links
// (the model repo's local `candidates/` A/B farm and friends) only get a
// warning: they are never reachable over HTTP, so they are hygiene, not a
// reason to refuse a good model set. (CI has no symlinks at all, it downloads
// the files flat, so none of this can fire there.)
const dangling = findDanglingLinks(MODEL_DIR);
const danglingWarning = danglingLinksWarning(dangling, MODEL_DIR);
if (danglingWarning) console.warn(danglingWarning);
const danglingFatal = danglingLinksMessage(dangling, MODEL_DIR);
if (danglingFatal) {
  console.error(danglingFatal);
  process.exit(1);
}

server.listen(PORT, '127.0.0.1', () => {
  if (!existsSync(DIST)) console.warn(`[e2e:serve] WARNING: ${DIST} missing — run \`npm run build\` in app/ui first.`);
  if (!existsSync(join(MODEL_DIR, 'vocab.txt'))) {
    console.warn(`[e2e:serve] WARNING: ${MODEL_DIR}/vocab.txt missing — run \`npm run e2e:models\` or point PARAKEET_E2E_MODEL_DIR at the weights.`);
  }
  console.log(`[e2e:serve] Listening on http://127.0.0.1:${PORT} (app=${DIST}, models=${MODEL_DIR})`);
});
