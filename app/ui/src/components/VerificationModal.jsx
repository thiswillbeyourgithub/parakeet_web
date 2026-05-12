import { useEffect, useRef, useState } from 'react';

const CONFIRM_DELAY_MS = 3000;

/**
 * Blocking modal asking the user to compare a short hex fingerprint with the
 * peer's screen, then confirm or deny. Mitigates a malicious signaling
 * server or network-level MITM that has swapped ECDH public keys to attack
 * the data channel: without the verbal compare, key swaps are invisible to
 * both peers.
 *
 * UX hardening (Round 9):
 *  - The fingerprint is non-selectable (userSelect: 'none') so a malicious
 *    extension or programmatic copy cannot scrape the code into the
 *    clipboard for an attacker to forge a matching display on the peer
 *    side (F-64).
 *  - dir="ltr" + unicode-bidi: isolate on the fingerprint so a future
 *    Arabic/Hebrew translation or a user with RTL accessibility settings
 *    can never bidi-reorder the hex into a visually-matching but
 *    semantically-different string (F-69).
 *  - Deny is the safer default: first in DOM order, autoFocus on mount.
 *    Enter on the modal triggers Deny, not Confirm (F-67).
 *  - Confirm requires two steps: an "I read both codes aloud" checkbox
 *    AND the 3-second mount delay AND a deliberate click. Enter/Space
 *    is ignored on Confirm; only Esc/Enter on Deny is keyboard-driven
 *    (fail-closed) (F-66).
 *
 * Adapted from WebSend's verification-modal.js.
 *
 * Self-contained inline styling so it works on both the main app (which loads
 * App.css) and the remote-mic phone page (which does not).
 */
export default function VerificationModal({ fingerprint, prompt, warning, checklist, confirmLabel, denyLabel, onConfirm, onDeny }) {
    // Confirm is gated on (a) the 3-second mount delay finishing AND (b) the
    // user ticking the "I read both codes" checkbox. The two together force a
    // deliberate, attention-bearing interaction; either alone is bypassable.
    const [remainingMs, setRemainingMs] = useState(CONFIRM_DELAY_MS);
    const [checked, setChecked] = useState(false);
    const denyRef = useRef(null);
    const delayDone = remainingMs <= 0;
    const confirmReady = delayDone && checked;

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
    // branch, not Confirm.
    useEffect(() => {
        denyRef.current?.focus();
    }, []);

    useEffect(() => {
        // Esc -> deny (fail-closed). Enter/Space are intentionally NOT
        // bound to Confirm: a held key from a preceding modal would
        // otherwise auto-fire confirm the instant CONFIRM_DELAY_MS
        // expires (key autorepeat ~30ms after ~250ms hold, well within
        // the inattention window). Confirm requires an explicit mouse
        // or touch click on the button.
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
        padding: '0.75rem 1.25rem', borderRadius: '8px',
        border: 0, fontSize: '1rem', fontWeight: 600,
        cursor: 'pointer', minWidth: '8rem',
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
                {checklist && (
                    <label style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '0.5rem', margin: '0.75rem 0',
                        fontSize: '0.9rem', cursor: 'pointer',
                    }}>
                        <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <span>{checklist}</span>
                    </label>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {/* Deny is first in DOM order so tab-focus and the
                        autoFocused button are both fail-closed. */}
                    <button
                        ref={denyRef}
                        style={{ ...btnBase, background: '#b91c1c', color: '#fff' }}
                        onClick={onDeny}
                    >
                        {denyLabel}
                    </button>
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
                        {delayDone ? confirmLabel : `${confirmLabel} (${Math.ceil(remainingMs / 1000)}s)`}
                    </button>
                </div>
            </div>
        </div>
    );
}
