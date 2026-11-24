// One direction of a verified remote-mic session: frames are stamped with a
// seq when cut, then encrypted and sent through one serial queue, so they
// leave in seq order even though each encrypt() is async.
//
// The phone uses it for audio, END and its control messages, the desktop for
// its control messages (stop, pause, audio-settings...). Example:
//   const ch = createFrameChannel(createSendRatchet(keys.master, DIRECTION_DESKTOP_TO_PHONE), rtc, onError);
//   ch.sendControl({ type: 'pause' });   // FRAME_CONTROL seq 0, encrypted
//
// Built with Claude Code.

import { createSerialQueue } from './writeQueue.js';
import { createFrameSender, packControlFrame } from './remote-mic-frames.js';

/**
 * @param {{encrypt: (frame: ArrayBuffer) => Promise<ArrayBuffer>}} ratchet this
 *   direction's createSendRatchet (lib/remote-mic-rekey.js), rekeys every 10 min
 * @param {{sendBinary: (data: ArrayBuffer) => Promise<boolean>|boolean}} rtc transport
 * @param {(err: Error) => void} onError called when encrypting or sending throws
 */
export function createFrameChannel(ratchet, rtc, onError) {
    const queue = createSerialQueue();
    const sender = createFrameSender();
    const send = (frame) => queue(async () => {
        try {
            await rtc.sendBinary(await ratchet.encrypt(frame));
        } catch (err) {
            onError(err);
        }
    });
    return {
        sender,
        send,
        sendControl(msg) {
            return send(packControlFrame(sender.nextControl(), msg));
        },
    };
}
