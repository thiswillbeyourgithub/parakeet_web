import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

// Simple help icon component with click-based tooltip.
// The popup uses position: fixed with coordinates computed from the
// button's bounding rect, so it can overlay sibling containers (e.g.
// the settings sidebar) without being clipped by their overflow, and
// is clamped to stay inside the viewport horizontally.
// It is rendered through a PORTAL into <body> rather than inside the
// icon's own span: a dimmed ancestor (`.disabled-option`, opacity 0.5,
// used for the greyed-out WebGPU radio) would otherwise multiply into
// the popup and make the very explanation of WHY the option is greyed
// out unreadable. A portal also keeps the popup out of any ancestor
// stacking context or transform, which would break position: fixed.
export default function InfoTooltip({ text }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const popupRef = useRef(null);

  // Prevent the click from bubbling to a wrapping <label>, which would
  // otherwise toggle the associated checkbox/radio input.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const toggle = (e) => { stop(e); setIsOpen(v => !v); };
  const close = (e) => { stop(e); setIsOpen(false); };

  // Compute popup coordinates from the button's rect, clamped to viewport.
  const computePos = useCallback(() => {
    const btn = rootRef.current && rootRef.current.querySelector('.info-help-button');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupEl = popupRef.current;
    // Use a viewport-clamped target width. We deliberately do NOT read
    // offsetWidth: when the popup renders inside a narrow ancestor (e.g.
    // the settings sidebar), shrink-to-fit can give a tiny natural width
    // and pin the popup to a thin, very tall column that overflows on
    // phones. CSS sets the same min(320px, 100vw - 16px) width so the
    // hidden first frame already lays out at a sane width.
    const width = Math.min(320, vw - 2 * margin);
    const measuredH = popupEl ? popupEl.offsetHeight : 0;
    let left = rect.left + rect.width / 2 - width / 2;
    if (left + width > vw - margin) left = vw - margin - width;
    if (left < margin) left = margin;
    let top = rect.bottom + 8;
    const availH = vh - 2 * margin;
    const fitH = Math.min(measuredH, availH);
    if (fitH && top + fitH > vh - margin) {
      const above = rect.top - 8 - fitH;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - margin - fitH);
    }
    setPos({ left, top, width });
  }, []);

  // Dismiss on any outside interaction (click, touch, Escape) and
  // recompute on resize. We listen at the document level instead of
  // rendering a full-viewport overlay so the first click outside lands
  // on its real target (another tooltip, sidebar close button, scrollbar,
  // etc.) instead of being swallowed just to close the popup.
  useEffect(() => {
    if (!isOpen) return;
    computePos();
    const onOutside = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    const onScroll = () => setIsOpen(false);
    const onResize = () => computePos();
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside, { passive: true });
    document.addEventListener('keydown', onKey);
    // Capture phase so scrolls inside any container also dismiss.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, computePos]);

  // Re-measure once the popup has rendered so the initial frame already
  // shows it correctly clamped and (if needed) flipped above the button.
  useLayoutEffect(() => {
    if (isOpen) computePos();
  }, [isOpen, computePos]);

  return (
    <span ref={rootRef} className="info-help" onClick={stop}>
      <button
        type="button"
        className="info-help-button"
        onClick={toggle}
        aria-label="?"
      >
        ?
      </button>
      {isOpen && createPortal(
        <div
          ref={popupRef}
          className="info-help-text"
          onClick={stop}
          style={pos ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' } : { visibility: 'hidden' }}
        >
          {text}
          <button className="info-help-close" onClick={close}>×</button>
        </div>,
        document.body,
      )}
    </span>
  );
}
