// Bundler side of the release notes: Vite's import.meta.glob turns every
// app/ui/changelog/<version>/<lang>.md into its own lazily loaded chunk, so
// the main bundle only carries the list of versions and the popup fetches
// just the releases it shows. Kept apart from changelog.js because
// import.meta.glob only exists under Vite, and the parser is unit-tested in
// plain Node.
//
// Written with the help of Claude Code.

import { parseChangelogMd, sortVersionsDesc } from './changelog.js';

const files = import.meta.glob('../../changelog/*/*.md', { query: '?raw', import: 'default' });

const loaders = {};
for (const [path, load] of Object.entries(files)) {
  const m = /\/changelog\/([^/]+)\/(en|fr)\.md$/.exec(path);
  if (m) (loaders[m[1]] ||= {})[m[2]] = load;
}

export const CHANGELOG_VERSIONS = sortVersionsDesc(Object.keys(loaders));

// Parsed notes of one release in `lang`, falling back to English when a
// translation is missing (the unit test forbids that in the repo, but a
// partial self-hosted edit should still show something).
export async function loadRelease(version, lang) {
  const l = loaders[version];
  if (!l) throw new Error(`no release notes for ${version}`);
  const load = l[lang] || l.en;
  return parseChangelogMd(await load(), version);
}
