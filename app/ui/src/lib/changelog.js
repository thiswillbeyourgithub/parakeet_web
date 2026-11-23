// Release notes: pure parsing and selection, no DOM and no bundler magic, so
// it runs unchanged under node:test. The files live one folder per release
// (app/ui/changelog/<version>/{en,fr}.md, see changelogSource.js for how the
// bundle reaches them) so a release adds two small files instead of growing
// one huge one.
//
// The markdown subset is deliberately small: it is exactly what the release
// notes use (headings, paragraphs, `- ` lists, pipe tables, and inline bold,
// italic, code and links). The output is a block tree the modal renders as
// Preact elements, so no note can ever inject HTML.
//
// Written with the help of Claude Code.

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TITLE_RE = /^# (\d+\.\d+\.\d+) \((\d{4}-\d\d-\d\d)\)\s*$/;

// Numeric semver compare on major.minor.patch. Returns <0, 0 or >0.
// Throws on anything else: a malformed version is a bug to surface, not to
// sort somewhere arbitrary.
export function compareVersions(a, b) {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) {
    throw new Error(`not a major.minor.patch version: ${JSON.stringify(VERSION_RE.test(a) ? b : a)}`);
  }
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// Releases to show in the "what's new" popup, newest first: every known
// version in (storedVersion, currentVersion]. Empty for a first visit (no
// stored version: nothing to catch up on, and a wall of notes is a poor
// welcome), for a reload on the same version, and for a downgrade. A stored
// value that is not a version (a corrupt or ancient profile) also shows
// nothing rather than throwing during boot.
export function releasesToShow(versions, storedVersion, currentVersion) {
  if (!storedVersion || !VERSION_RE.test(storedVersion)) return [];
  if (compareVersions(storedVersion, currentVersion) >= 0) return [];
  return sortVersionsDesc(versions.filter(
    (v) => compareVersions(v, storedVersion) > 0 && compareVersions(v, currentVersion) <= 0,
  ));
}

export function sortVersionsDesc(versions) {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

// Inline markdown -> [{ type: 'text'|'code'|'strong'|'em'|'link', ... }].
// strong/em/link carry `children` (parsed recursively), code carries `text`.
// An unmatched marker is kept as literal text.
export function parseInline(src) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) { flush(); out.push({ type: 'code', text: src.slice(i + 1, end) }); i = end + 1; continue; }
    } else if (c === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    } else if (c === '*' || (c === '_' && !/\w/.test(src[i - 1] || ''))) {
      const end = src.indexOf(c, i + 1);
      if (end > i + 1 && src[i + 1] !== ' ' && (c === '*' || !/\w/.test(src[end + 1] || ''))) {
        flush(); out.push({ type: 'em', children: parseInline(src.slice(i + 1, end)) }); i = end + 1; continue;
      }
    } else if (c === '[') {
      const m = /^\[((?:[^\][]|\[[^\]]*\])*)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) { flush(); out.push({ type: 'link', href: m[2], children: parseInline(m[1]) }); i += m[0].length; continue; }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()));

// Parse one release file. `where` names the file in error messages and, when
// it is a version, is checked against the title: a 12.0.0/en.md titled
// "# 12.1.0" is a copy-paste slip that would otherwise show the wrong notes.
// Returns { version, date, blocks }.
export function parseChangelogMd(text, where = '') {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const title = TITLE_RE.exec(lines[0] || '');
  if (!title) throw new Error(`${where}: first line must be "# <major.minor.patch> (YYYY-MM-DD)", got ${JSON.stringify(lines[0])}`);
  const [, version, date] = title;
  if (VERSION_RE.test(where) && where !== version) {
    throw new Error(`${where}: title says ${version}, folder says ${where}`);
  }
  const blocks = [];
  let para = null;
  let list = null;
  const close = () => {
    if (para) blocks.push({ type: 'p', children: parseInline(para.join(' ')) });
    if (list) blocks.push({ type: 'ul', items: list.map((it) => parseInline(it.join(' '))) });
    para = null; list = null;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { close(); continue; }
    const h = /^(#{2,4}) (.*)$/.exec(t);
    if (h) { close(); blocks.push({ type: 'h', level: h[1].length, children: parseInline(h[2]) }); continue; }
    if (t.startsWith('|')) {
      close();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
      i--;
      const isSep = (r) => /^\|?[\s:|-]+\|?$/.test(r);
      const body = rows.filter((r, k) => !(k === 1 && isSep(r)));
      const hasHeader = rows.length > 1 && isSep(rows[1]);
      blocks.push({
        type: 'table',
        header: hasHeader ? splitRow(body[0]) : null,
        rows: (hasHeader ? body.slice(1) : body).map(splitRow),
      });
      continue;
    }
    if (/^[-*] /.test(t)) {
      if (para) close();
      if (!list) list = [];
      list.push([t.slice(2)]);
      continue;
    }
    if (list && /^\s/.test(line)) { list[list.length - 1].push(t); continue; }
    if (list) close();
    if (!para) para = [];
    para.push(t);
  }
  close();
  return { version, date, blocks };
}
