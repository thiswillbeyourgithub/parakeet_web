// Periodic rekeying of a remote-mic session, without pausing the audio.
//
// Each direction owns a hash chain rooted at the session master key:
//   chain_0     = master
//   chain_{n+1} = HKDF(chain_n, info = 'ParakeetWeb-RemoteMic-v4|<direction>|chain|<n>')
//   key_n       = deriveDirectionKey(chain_n, direction, n)
// so key_0 is exactly the key deriveSessionKeys hands out, and once a side has
// moved to epoch n+1 it drops chain_n and key_n. Since HKDF only runs forward,
// someone who later steals the CURRENT chain cannot decrypt traffic of earlier
// epochs (forward secrecy within a session, every REKEY_INTERVAL_MS).
//
// No message announces a rekey, so there is nothing to lose or to race:
//   - the SENDER advances when its epoch is older than REKEY_INTERVAL_MS, at
//     most ONE epoch per frame, inside the channel's serial queue, so every
//     frame before the switch is under key_n and every frame after under key_n+1;
//   - the RECEIVER tries key_n and, only when that fails, key_n+1; a frame that
//     authenticates under key_n+1 moves it forward for good.
// The transport is ordered (WebRTC reliable channel or the relay), so an old
// epoch frame never arrives after a newer one, and one look-ahead always
// suffices. Example over 25 min of streaming: frames 0..k under key_0, the
// first frame cut after 10:00 under key_1, after 20:00 under key_2. The
// receiver pays one extra failed decrypt per switch, nothing else.
//
// Built with Claude Code.

import { deriveDirectionKey, encrypt, decrypt, KDF_LABEL } from './remote-crypto.js';

export const REKEY_INTERVAL_MS = 10 * 60 * 1000;

async function nextChain(chain, direction, epoch) {
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(`${KDF_LABEL}|${direction}|chain|${epoch}`) },
        chain, 256,
    );
    return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

async function epochState(chain, direction, epoch) {
    return { epoch, chain, key: await deriveDirectionKey(chain, direction, epoch) };
}

async function advanceState(state, direction) {
    return epochState(await nextChain(state.chain, direction, state.epoch), direction, state.epoch + 1);
}

/**
 * Sending half: encrypt(frame) under the current epoch, advancing first when
 * the epoch is older than intervalMs. Call it from ONE serial queue.
 * @param {CryptoKey} master
 * @param {string} direction
 * @param {{intervalMs?: number, now?: () => number}} [opts]
 */
export function createSendRatchet(master, direction, { intervalMs = REKEY_INTERVAL_MS, now = Date.now } = {}) {
    let state = epochState(master, direction, 0);
    let startedAt = now();
    return {
        async encrypt(frame) {
            if (now() - startedAt >= intervalMs) {
                state = advanceState(await state, direction);
                startedAt = now();
            }
            return encrypt(frame, (await state).key);
        },
        async epoch() { return (await state).epoch; },
    };
}

/**
 * Receiving half: decrypt(data) under the current epoch or the next one.
 * Throws when neither authenticates (the state is left untouched then, so a
 * forged frame cannot push the receiver forward). Call it from ONE serial queue.
 * @param {CryptoKey} master
 * @param {string} direction
 */
export function createRecvRatchet(master, direction) {
    let state = epochState(master, direction, 0);
    let next = null; // lazily derived epoch+1, reused across failed attempts
    return {
        async decrypt(data) {
            const cur = await state;
            try {
                return await decrypt(data, cur.key);
            } catch (err) {
                next ??= advanceState(cur, direction);
                const ahead = await next;
                const plain = await decrypt(data, ahead.key); // throws: not ours
                state = next;
                next = null;
                return plain;
            }
        },
        async epoch() { return (await state).epoch; },
    };
}
