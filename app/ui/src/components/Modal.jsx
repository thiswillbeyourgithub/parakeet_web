export default function Modal({ onClose, children, className = '' }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className={`modal-panel ${className}`} onClick={e => e.stopPropagation()}>
                {onClose && (
                    <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
                )}
                {children}
            </div>
        </div>
    );
}
