# Changelog

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

The release notes live in [`app/ui/changelog/`](./app/ui/changelog/), one folder per version, each holding `en.md` and `fr.md`. The app shows the new ones in a popup on the first start after an update, and the full history from the About dialog.

The notes start at 10.0.0; earlier releases are recorded only in the git history.

To write the notes of a release, create `app/ui/changelog/<version>/en.md` and `fr.md`, starting with `# <version> (YYYY-MM-DD)` and using `##` section headings. Both files must have the same date and the same headings, and the version in `app/package.json` must have a folder: `test/unit/changelog.test.mjs` checks all three.

Written with the help of [Claude Code](https://claude.com/claude-code).
