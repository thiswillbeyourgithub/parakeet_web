// Room lifetime policy for the signaling server.
//
// A room expires 10 minutes after its last use, and in any case 60 minutes
// after creation. "In use" means both relay slots are held by a live peer
// (a phone and a desktop exchanging frames through the HTTPS relay): long-poll
// slots are reaped after 60 s without a poll, so a held slot is a live one.
// Without this, a relay session was cut 10 minutes after the QR was shown,
// even in the middle of a dictation.
//
// Built with Claude Code.

const ROOM_IDLE_TTL = 10 * 60 * 1000;
const ROOM_MAX_LIFETIME = 60 * 60 * 1000;

function slotLive(slot) {
    if (!slot) return false;
    return slot.kind === 'lp' ? !slot.closed : slot.readyState === slot.OPEN;
}

function relayInUse(room) {
    return Boolean(room.relay) && slotLive(room.relay.a) && slotLive(room.relay.b);
}

// Called by the periodic sweep: refreshes lastActive when the relay is in use,
// then tells whether the room must be removed.
function sweepRoom(room, now) {
    if (relayInUse(room)) room.lastActive = now;
    if (now - room.created > ROOM_MAX_LIFETIME) return true;
    return now - (room.lastActive ?? room.created) > ROOM_IDLE_TTL;
}

module.exports = { ROOM_IDLE_TTL, ROOM_MAX_LIFETIME, sweepRoom };
