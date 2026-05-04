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
let visibilityHandlerInstalled = false;

// 1-second silent WAV (mono, 8kHz, 8-bit PCM = 128 = silence). Tiny.
const SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

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
        audioEl = new Audio(SILENT_WAV);
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
