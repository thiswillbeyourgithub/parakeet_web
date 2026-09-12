// Collapsible settings group. The header is a button that toggles the body
// open/closed (the body unmounts when closed so the drawer stays a short list
// of section titles). Open/closed state lives in the parent so it can be
// persisted per-section; `open`/`onToggle` are controlled props.
export default function CollapsibleSection({ id, title, open, onToggle, children }) {
  return (
    <div className="settings-group">
      <button
        type="button"
        className="settings-group-toggle"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="settings-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="settings-group-title">{title}</span>
      </button>
      {open && <div className="settings-group-body">{children}</div>}
    </div>
  );
}
