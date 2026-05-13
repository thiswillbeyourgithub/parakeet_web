import { useEffect, useRef, useState } from 'react';
import { useRegisterModalOpen } from './Modal.jsx';

const CONFIRM_DELAY_MS = 3000;

/**
 * Blocking modal asking the user to compare a short hex fingerprint with the
 * peer's screen, then confirm or deny. Mitigates a malicious signaling
 * server or network-level MITM that has swapped ECDH public keys to attack
 * the data channel: without the verbal compare, key swaps are invisible to
 * both peers.
 *
 * UX:
 *  - The fingerprint is non-selectable (userSelect: 'none') so a malicious
 *    extension or programmatic copy cannot scrape the code into the
 *    clipboard for an attacker to forge a matching display on the peer side.
 *  - dir="ltr" + unicode-bidi: isolate on the fingerprint so RTL settings
 *    cannot bidi-reorder the hex into a visually-matching but semantically
 *    different string.
 *  - Buttons stack vertically with deny on top so it is the closer target
 *    while the user is reading the code; confirm unlocks after a 3-second
 *    delay and Enter/Esc both work once unlocked.
 *
 * Self-contained inline styling so it works on both the main app (which loads
 * App.css) and the remote-mic phone page (which does not).
 */
export default function VerificationModal({ fingerprint, prompt, warning, confirmLabel, denyLabel, onConfirm, onDeny }) {
    // F-134: register with the shared modal-open counter so useAnyModalOpen()
    // returns true and F-127's per-history Copy-button disable applies during
    // the fingerprint compare (otherwise the highest-stakes modal would be
    // the only one without the F-127 defence).
    useRegisterModalOpen();
    // Confirm is gated on the 3-second mount delay so the user actually
    // reads the code rather than dismissing the modal reflexively.
    const [remainingMs, setRemainingMs] = useState(CONFIRM_DELAY_MS);
    const denyRef = useRef(null);
    const confirmRef = useRef(null);
    const confirmReady = remainingMs <= 0;

    useEffect(() => {
        const start = Date.now();
        const id = setInterval(() => {
            const left = Math.max(0, CONFIRM_DELAY_MS - (Date.now() - start));
            setRemainingMs(left);
            if (left <= 0) clearInterval(id);
        }, 100);
        return () => clearInterval(id);
    }, []);

    // Focus Deny on mount so a stray Enter/Space hits the fail-closed
    // branch. Once the delay elapses, move focus to Confirm so the user
    // can simply press Enter to accept.
    useEffect(() => {
        denyRef.current?.focus();
    }, []);
    useEffect(() => {
        if (confirmReady) confirmRef.current?.focus();
    }, [confirmReady]);

    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                onDeny();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onDeny]);

    const overlay = {
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
    };
    const panel = {
        background: '#1f2937', color: '#f3f4f6',
        borderRadius: '12px', padding: '1.5rem',
        maxWidth: '420px', width: '100%',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        textAlign: 'center',
    };
    const btnBase = {
        padding: '1.1rem 1.5rem', borderRadius: '10px',
        border: 0, fontSize: '1.15rem', fontWeight: 700,
        cursor: 'pointer', width: '100%',
    };
    return (
        <div style={overlay} role="dialog" aria-modal="true">
            <div style={panel}>
                <p style={{ marginBottom: '0.75rem' }}>{prompt}</p>
                {warning && (
                    <p style={{
                        marginBottom: '0.75rem',
                        fontSize: '0.85rem',
                        color: '#fbbf24',
                        background: 'rgba(251,191,36,0.1)',
                        border: '1px solid rgba(251,191,36,0.3)',
                        borderRadius: '6px',
                        padding: '0.5rem 0.75rem',
                    }}>{warning}</p>
                )}
                <div
                    dir="ltr"
                    lang="en"
                    style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '2rem', fontWeight: 700, letterSpacing: '0.1em',
                        margin: '1.25rem 0',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        MozUserSelect: 'none',
                        msUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                        unicodeBidi: 'isolate',
                        color: '#fbbf24',
                    }}
                    onCopy={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {fingerprint}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1.5rem' }}>
                    {/* Deny stays first in DOM order so it is the
                        fail-closed default while the user is still
                        comparing the code. */}
                    <button
                        ref={denyRef}
                        style={{ ...btnBase, background: '#b91c1c', color: '#fff' }}
                        onClick={onDeny}
                    >
                        {denyLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        style={{
                            ...btnBase,
                            background: confirmReady ? '#16a34a' : '#374151',
                            color: '#fff',
                            cursor: confirmReady ? 'pointer' : 'not-allowed',
                            opacity: confirmReady ? 1 : 0.7,
                        }}
                        onClick={confirmReady ? onConfirm : undefined}
                        disabled={!confirmReady}
                    >
                        {confirmReady ? confirmLabel : `${confirmLabel} (${Math.ceil(remainingMs / 1000)}s)`}
                    </button>
                </div>
            </div>
        </div>
    );
}
