import { useEffect, useState } from 'react';

const CONFIRM_DELAY_MS = 3000;

/**
 * Blocking modal asking the user to compare a short hex fingerprint with the
 * peer's screen, then confirm or deny. Mitigates a malicious signaling
 * server that has swapped ECDH public keys to MITM the data channel — without
 * the verbal compare, key swaps are invisible to both peers.
 *
 * Adapted from WebSend's verification-modal.js.
 *
 * Self-contained inline styling so it works on both the main app (which loads
 * App.css) and the remote-mic phone page (which does not).
 */
export default function VerificationModal({ fingerprint, prompt, confirmLabel, denyLabel, onConfirm, onDeny }) {
    // Force the user to actually look at the fingerprint: confirm is disabled
    // for CONFIRM_DELAY_MS to defeat reflexive Enter/Space presses that would
    // otherwise auto-accept a tampered code.
    const [remainingMs, setRemainingMs] = useState(CONFIRM_DELAY_MS);
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

    useEffect(() => {
        function onKey(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (confirmReady) onConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onDeny();
            }
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onConfirm, onDeny, confirmReady]);

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
        padding: '0.75rem 1.25rem', borderRadius: '8px',
        border: 0, fontSize: '1rem', fontWeight: 600,
        cursor: 'pointer', minWidth: '8rem',
    };
    return (
        <div style={overlay} role="dialog" aria-modal="true">
            <div style={panel}>
                <p style={{ marginBottom: '0.75rem' }}>{prompt}</p>
                <div style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '2rem', fontWeight: 700, letterSpacing: '0.1em',
                    margin: '1.25rem 0', userSelect: 'all',
                    color: '#fbbf24',
                }}>
                    {fingerprint}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
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
                    <button style={{ ...btnBase, background: '#b91c1c', color: '#fff' }} onClick={onDeny}>{denyLabel}</button>
                </div>
            </div>
        </div>
    );
}
