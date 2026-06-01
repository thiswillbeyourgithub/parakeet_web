/**
 * Shared helper: spawn the real signaling server (signaling/server.js) on a
 * random free port and tear it down after a test file. Mirrors WebSend's
 * spawn-server helper.
 *
 * Tier-2 tests hit the real Express endpoints over loopback with `fetch`; no
 * routes or middleware are mocked. Behaviour is tuned per spawn via env vars
 * (notably TEST_DISABLE_RATE_LIMIT=1, the rate-limit escape hatch added to
 * server.js, so a file that churns rooms doesn't trip the 5/min cap).
 *
 * Usage:
 *   import { test, before, after } from 'node:test';
 *   let srv;
 *   before(async () => { srv = await startServer(); });
 *   after(async () => { await stopServer(srv); });
 *   // srv.baseUrl, srv.origin
 *
 * Built with Claude Code.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = resolve(here, '../../signaling/server.js');

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start the signaling server. Returns { proc, port, baseUrl, origin }.
 * `origin` is the single allowed origin; pass it as the `Origin` header on
 * requests that need to pass validateOrigin.
 */
export async function startServer(env = {}) {
  const port = await getFreePort();
  const origin = `http://localhost:${port}`;

  const proc = spawn('node', [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(port),
      DOMAIN: 'localhost',
      // server.js throws at startup without this; tests pass it as Origin.
      ALLOWED_ORIGINS: origin,
      // Keep tier-2 close to real behaviour with surgical opt-outs.
      TEST_DISABLE_RATE_LIMIT: '1',
      STUN_GOOGLE_FALLBACK: 'false',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server start timeout. stderr:\n${stderr}`)),
      8000,
    );
    const onData = (data) => {
      if (data.toString().includes(`Listening on 0.0.0.0:${port}`)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Server exited early with ${code}. stderr:\n${stderr}`));
    };
    function cleanup() {
      clearTimeout(timeout);
      proc.stdout.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onErr);
    }
    function onErr(err) { cleanup(); reject(err); }
    proc.stdout.on('data', onData);
    proc.on('exit', onExit);
    proc.on('error', onErr);
  });

  return { proc, port, baseUrl: `http://127.0.0.1:${port}`, origin };
}

export async function stopServer(srv) {
  if (!srv?.proc || srv.proc.exitCode !== null) return;
  await new Promise((resolve) => {
    srv.proc.once('exit', () => resolve());
    srv.proc.kill('SIGTERM');
    // Hard-kill backstop if SIGTERM is ignored.
    setTimeout(() => { try { srv.proc.kill('SIGKILL'); } catch {} resolve(); }, 2000).unref?.();
  });
}

/** Create a room and return { roomId, secret } plus a header helper. */
export async function createRoom(srv) {
  const res = await fetch(`${srv.baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { Origin: srv.origin, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
  return res.json();
}
