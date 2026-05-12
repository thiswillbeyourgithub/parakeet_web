import { useEffect, useSyncExternalStore } from 'preact/compat';

// F-127: module-level modal-open counter. Modal increments on mount and
// decrements on unmount; consumers subscribe via useAnyModalOpen() to
// disable controls (e.g. the per-history Copy buttons) while any modal
// is in the foreground. Prevents an extension keystroke-injection
// (Tab + Enter) from driving focus from inside a modal into the
// underlying page's clipboard-copy controls.
let _openCount = 0;
const _listeners = new Set();
function _emit() {
    for (const fn of _listeners) fn();
}
function _subscribe(fn) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
}
function _getSnapshot() {
    return _openCount;
}

export function useAnyModalOpen() {
    const count = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
    return count > 0;
}

// F-134: custom modals that don't render inside the base Modal wrapper
// (e.g. VerificationModal) must call this hook so they still increment
// the open-counter and keep F-127's per-history Copy-button disable in
// force during the most security-critical modal in the app.
export function useRegisterModalOpen() {
    useEffect(() => {
        _openCount++;
        _emit();
        return () => {
            _openCount--;
            _emit();
        };
    }, []);
}

export default function Modal({ onClose, children, className = '' }) {
    useRegisterModalOpen();
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className={`modal-panel ${className}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
                {onClose && (
                    <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
                )}
                {children}
            </div>
        </div>
    );
}
