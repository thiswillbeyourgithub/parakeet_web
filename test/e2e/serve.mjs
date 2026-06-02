// Static server for the tier-3 full-transcription E2E. Serves the built UI
// (app/ui/dist) plus the model weights at /models/<file> (flat layout, matching
// hub.js getLocalModelFile), with the COOP/COEP/CORP headers ORT needs for
// cross-origin-isolated WASM threading. Boots from playwright.config.js.
//
// The weights are read from PARAKEET_E2E_MODEL_DIR (default ./fallback_models).
// CI populates that dir with the three int8 files via `npm run e2e:models`.
// No external deps so the E2E webServer has nothing to install.
//
// Built with Claude Code.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(here, '../..');
const DIST = resolve(ROOT, 'app/ui/dist');
const MODEL_DIR = resolve(process.env.PARAKEET_E2E_MODEL_DIR || join(ROOT, 'fallback_models'));
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

function sendFile(res, filePath, status = 200) {
  setHeaders(res, filePath);
  res.statusCode = status;
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
  if (pathname.startsWith('/models/')) {
    const filePath = safeJoin(MODEL_DIR, pathname.slice('/models'.length));
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(res, filePath);
    res.statusCode = 404;
    setHeaders(res, '.txt');
    return res.end(`model file not found: ${pathname} (looked in ${MODEL_DIR})`);
  }

  // Static app, with SPA fallback to index.html.
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = safeJoin(DIST, rel);
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) return sendFile(res, filePath);
  return sendFile(res, join(DIST, 'index.html'));
});

server.listen(PORT, '127.0.0.1', () => {
  if (!existsSync(DIST)) console.warn(`[e2e:serve] WARNING: ${DIST} missing — run \`npm run build\` in app/ui first.`);
  if (!existsSync(join(MODEL_DIR, 'vocab.txt'))) {
    console.warn(`[e2e:serve] WARNING: ${MODEL_DIR}/vocab.txt missing — run \`npm run e2e:models\` or point PARAKEET_E2E_MODEL_DIR at the weights.`);
  }
  console.log(`[e2e:serve] Listening on http://127.0.0.1:${PORT} (app=${DIST}, models=${MODEL_DIR})`);
});
