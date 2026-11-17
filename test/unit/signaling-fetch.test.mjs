// Unit coverage for app/ui/src/lib/signaling-fetch.js. Regression guard: the
// remote-mic clients used plain fetch(), which follows a 307 and re-sends the
// X-Room-Secret header and the body to wherever Location points.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { signalingFetch } from '../../app/ui/src/lib/signaling-fetch.js';

let server;
let base;
let collected = 0;

before(async () => {
    server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
            res.writeHead(307, { Location: `${base}/collect` });
            return res.end();
        }
        if (req.url === '/collect') collected += 1;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

describe('signalingFetch', () => {
    test('a plain response goes through', async () => {
        const res = await signalingFetch(`${base}/ok`);
        assert.equal(await res.text(), 'ok');
    });

    test('a redirect is refused and the secret never reaches the target', async () => {
        await assert.rejects(() => signalingFetch(`${base}/redirect`, {
            method: 'POST', headers: { 'X-Room-Secret': 's3cret' }, body: 'sdp',
        }));
        assert.equal(collected, 0);
    });

    test('a caller cannot opt back into following redirects', async () => {
        await assert.rejects(() => signalingFetch(`${base}/redirect`, { redirect: 'follow' }));
        assert.equal(collected, 0);
    });
});
