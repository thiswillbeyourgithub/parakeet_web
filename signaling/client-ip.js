// Per-client key used by the signaling server's rate limiters and room caps.
//
// An IPv6 client usually holds a whole /64 (often far more), so keying on the
// full address let one host rotate source addresses and get a fresh bucket for
// every request. IPv6 addresses are therefore reduced to their /64 prefix, and
// IPv4-mapped addresses (::ffff:203.0.113.7, what Node reports on a dual-stack
// socket) are reduced to the plain IPv4 so both spellings share one bucket.
//
//   clientIpKey('203.0.113.7')               -> '203.0.113.7'
//   clientIpKey('::ffff:203.0.113.7')        -> '203.0.113.7'
//   clientIpKey('2001:db8:1:2:aaaa::1')      -> '2001:db8:1:2::/64'
//   clientIpKey('2001:db8:1:2:bbbb::9')      -> '2001:db8:1:2::/64'
//
// Built with Claude Code.

const net = require('node:net');

// Expand an IPv6 address into its 8 hextets, or null when it is not one.
function ipv6Hextets(addr) {
    if (net.isIPv6(addr) === false) return null;
    let s = addr.split('%')[0];
    // A trailing dotted IPv4 (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is two hextets.
    const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted !== null) {
        const o = dotted[2].split('.').map(Number);
        s = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
    const left = head === '' ? [] : head.split(':');
    const right = tail === null || tail === '' ? [] : tail.split(':');
    const fill = tail === null ? [] : new Array(8 - left.length - right.length).fill('0');
    return [...left, ...fill, ...right].map((h) => parseInt(h, 16));
}

function clientIpKey(addr) {
    if (typeof addr !== 'string' || addr.length === 0) return 'unknown';
    if (net.isIPv4(addr)) return addr;
    const h = ipv6Hextets(addr);
    if (h === null) return addr;
    const mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
    if (mapped) return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.');
    return `${h.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

module.exports = { clientIpKey };
