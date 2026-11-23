// "What's new" popup: renders release notes parsed by lib/changelog.js as
// Preact elements (never innerHTML). `versions` are the releases to show,
// newest first; `onShowAll`, when given, offers the full history below them.
//
// Written with the help of Claude Code.

import { useEffect, useState } from 'preact/compat';
import Modal from './Modal.jsx';
import { loadRelease } from '../lib/changelogSource.js';

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'code': return <code key={i}>{n.text}</code>;
      case 'strong': return <strong key={i}><Inline nodes={n.children} /></strong>;
      case 'em': return <em key={i}><Inline nodes={n.children} /></em>;
      case 'link': {
        // Only absolute http(s) links: the notes are rendered inside the app,
        // where a repo-relative link would resolve against the app's origin.
        const ok = /^https?:\/\//.test(n.href);
        return ok
          ? <a key={i} href={n.href} target="_blank" rel="noopener noreferrer"><Inline nodes={n.children} /></a>
          : <span key={i}><Inline nodes={n.children} /></span>;
      }
      default: return n.text;
    }
  });
}

function Block({ b }) {
  switch (b.type) {
    // File headings start at ## under the release title, rendered as h3+.
    case 'h': { const H = `h${b.level + 1}`; return <H><Inline nodes={b.children} /></H>; }
    case 'ul': return <ul>{b.items.map((it, i) => <li key={i}><Inline nodes={it} /></li>)}</ul>;
    case 'table': return (
      <table>
        {b.header && <thead><tr>{b.header.map((c, i) => <th key={i}><Inline nodes={c} /></th>)}</tr></thead>}
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><Inline nodes={c} /></td>)}</tr>)}</tbody>
      </table>
    );
    default: return <p><Inline nodes={b.children} /></p>;
  }
}

export default function ChangelogModal({ t, lang, versions, title, onClose, onShowAll }) {
  const [releases, setReleases] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setReleases(null);
    Promise.all(versions.map((v) => loadRelease(v, lang)))
      .then((r) => { if (live) setReleases(r); })
      .catch((e) => { console.warn('[Changelog] failed to load release notes:', e); if (live) setError(e); });
    return () => { live = false; };
  }, [versions.join(','), lang]);

  return (
    <Modal onClose={onClose} className="modal-panel--changelog">
      <h3 style={{ marginTop: 0 }} data-testid="changelog-title">{title}</h3>
      {error && <p>{t('changelogLoadFailed')}</p>}
      {!error && !releases && <p>…</p>}
      {releases && releases.map((r) => (
        <article key={r.version} className="changelog-release" data-testid="changelog-release" data-version={r.version}>
          <h2>{r.version} <span className="changelog-release__date">{r.date}</span></h2>
          {r.blocks.map((b, i) => <Block key={i} b={b} />)}
        </article>
      ))}
      {onShowAll && (
        <div className="changelog-actions">
          <button type="button" className="btn" onClick={onShowAll} data-testid="changelog-show-all">
            {t('changelogShowAll')}
          </button>
        </div>
      )}
    </Modal>
  );
}
