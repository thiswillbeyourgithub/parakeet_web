/**
 * SDP Compression module for ParakeetWeb remote microphone.
 * Adapted from WebSend's sdp-compress.js (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Compresses WebRTC SDP offers to fit in a QR code (~2KB limit).
 */

/**
 * Extract essential data from SDP and ICE candidates.
 * @param {RTCSessionDescription} description
 * @param {RTCIceCandidate[]} candidates
 * @returns {Object} Compact representation
 */
export function extractEssentials(description, candidates) {
    const lines = description.sdp.split('\r\n');
    let fingerprint = '';
    let iceUfrag = '';
    let icePwd = '';

    for (const line of lines) {
        if (line.startsWith('a=fingerprint:')) fingerprint = line.substring(14);
        else if (line.startsWith('a=ice-ufrag:')) iceUfrag = line.substring(12);
        else if (line.startsWith('a=ice-pwd:')) icePwd = line.substring(10);
    }

    const compactCandidates = candidates
        .filter(c => c && c.candidate)
        .map(c => {
            const parts = c.candidate.split(' ');
            return {
                i: parts[4],
                o: parseInt(parts[5]),
                t: parts[7][0],
                p: parts[2][0]
            };
        })
        .sort((a, b) => {
            const order = { h: 0, s: 1, r: 2 };
            return (order[a.t] || 3) - (order[b.t] || 3);
        })
        .slice(0, 3);

    return {
        y: description.type === 'offer' ? 'o' : 'a',
        f: fingerprint.replace('sha-256 ', '').replace(/:/g, ''),
        u: iceUfrag,
        w: icePwd,
        c: compactCandidates
    };
}

/**
 * Compress essentials into a QR-code-friendly string.
 * @param {Object} essentials
 * @returns {Promise<string>} Compressed base64 string
 */
export async function compress(essentials) {
    const json = JSON.stringify(essentials);

    if (typeof CompressionStream !== 'undefined') {
        try {
            const data = new TextEncoder().encode(json);
            const cs = new CompressionStream('deflate');
            const writer = cs.writable.getWriter();
            writer.write(data);
            writer.close();

            const reader = cs.readable.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            const compressed = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
            let offset = 0;
            for (const chunk of chunks) {
                compressed.set(chunk, offset);
                offset += chunk.length;
            }

            return 'Z' + btoa(String.fromCharCode(...compressed));
        } catch (e) {
            console.warn('SDP compression failed, using uncompressed:', e.message);
        }
    }

    return 'J' + btoa(json);
}

/**
 * Decompress a QR code payload back into essentials.
 * @param {string} compressed
 * @returns {Promise<Object>}
 */
export async function decompress(compressed) {
    if (compressed.startsWith('Z')) {
        const binaryString = atob(compressed.substring(1));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(bytes);
        writer.close();

        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const decompressed = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            decompressed.set(chunk, offset);
            offset += chunk.length;
        }

        return JSON.parse(new TextDecoder().decode(decompressed));
    } else if (compressed.startsWith('J')) {
        return JSON.parse(atob(compressed.substring(1)));
    } else {
        throw new Error('Unknown compression format');
    }
}

/**
 * Reconstruct a full SDP from compressed essentials.
 * @param {Object} essentials
 * @returns {RTCSessionDescription}
 */
export function reconstructSDP(essentials) {
    const fp = essentials.f.match(/.{2}/g).join(':');

    const sdp = [
        'v=0',
        'o=- ' + Date.now() + ' 1 IN IP4 0.0.0.0',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:' + essentials.u,
        'a=ice-pwd:' + essentials.w,
        'a=ice-options:trickle',
        'a=fingerprint:sha-256 ' + fp,
        'a=setup:' + (essentials.y === 'o' ? 'actpass' : 'active'),
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144'
    ];

    const typeMap = { h: 'host', s: 'srflx', r: 'relay' };
    const protoMap = { u: 'udp', t: 'tcp' };

    for (const c of essentials.c) {
        const type = typeMap[c.t] || 'host';
        const proto = protoMap[c.p] || 'udp';
        const priority = type === 'host' ? 2130706431 : type === 'srflx' ? 1694498815 : 16777215;
        sdp.push(`a=candidate:1 1 ${proto} ${priority} ${c.i} ${c.o} typ ${type}`);
    }

    return new RTCSessionDescription({
        type: essentials.y === 'o' ? 'offer' : 'answer',
        sdp: sdp.join('\r\n') + '\r\n'
    });
}
