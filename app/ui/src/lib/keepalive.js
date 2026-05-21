// Keepalive helper: combats background-tab throttling and screen sleep.
//
// - navigator.wakeLock.request('screen'): prevents the screen from turning off
//   (mobile mainly). Auto-released by the OS when the tab becomes hidden, so
//   we re-acquire on visibilitychange.
// - Silent looping audio element: a tab playing audio is treated as
//   "user-active" by browsers and is exempted from aggressive timer/JS
//   throttling when backgrounded — important so model inference and
//   setInterval-driven UI keep running when the user switches tabs.
//
// Multiple callers can acquire(); the underlying resources stay alive until
// every caller has released().

let refCount = 0;
let wakeLock = null;
let audioEl = null;
let silentWavUrl = null;
let visibilityHandlerInstalled = false;

// Build a real silent WAV (mono, 8 kHz, 8-bit PCM, samples = 0x80) at runtime.
// Firefox rejects a zero-length data chunk with NS_ERROR_DOM_MEDIA_METADATA_ERR,
// so the clip must contain actual samples. 0.1 s is plenty when looped.
function buildSilentWavUrl() {
    if (silentWavUrl) return silentWavUrl;
    const sampleRate = 8000;
    const numSamples = 800; // 0.1 s
    const dataSize = numSamples; // 8-bit mono
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const writeAscii = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);          // PCM fmt chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);  // byte rate
    view.setUint16(32, 1, true);           // block align
    view.setUint16(34, 8, true);           // bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, dataSize, true);
    bytes.fill(0x80, 44);                  // 8-bit unsigned PCM silence = 128
    silentWavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return silentWavUrl;
}

async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
            // Cleared so visibilitychange handler can re-request.
            wakeLock = null;
        });
    } catch (e) {
        console.warn('[keepalive] wake lock failed:', e.message);
    }
}

function startSilentAudio() {
    if (audioEl) return;
    try {
        audioEl = new Audio(buildSilentWavUrl());
        audioEl.loop = true;
        audioEl.volume = 0;
        audioEl.muted = false; // muted audio doesn't count as "playing audio"
        // Play may reject without a user gesture; that's fine — wake lock still helps.
        const p = audioEl.play();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {
        console.warn('[keepalive] silent audio failed:', e.message);
    }
}

function stopSilentAudio() {
    if (!audioEl) return;
    try { audioEl.pause(); } catch (_) {}
    audioEl.src = '';
    audioEl = null;
}

function installVisibilityHandler() {
    if (visibilityHandlerInstalled) return;
    visibilityHandlerInstalled = true;
    document.addEventListener('visibilitychange', () => {
        if (refCount > 0 && document.visibilityState === 'visible' && !wakeLock) {
            acquireWakeLock();
        }
    });
}

export function acquireKeepalive() {
    refCount++;
    if (refCount === 1) {
        installVisibilityHandler();
        acquireWakeLock();
        startSilentAudio();
    }
}

export function releaseKeepalive() {
    if (refCount === 0) return;
    refCount--;
    if (refCount === 0) {
        if (wakeLock) {
            wakeLock.release().catch(() => {});
            wakeLock = null;
        }
        stopSilentAudio();
    }
}
