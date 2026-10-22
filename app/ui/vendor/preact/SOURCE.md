# Vendored Preact

- Package: `preact`
- Version: `11.0.1`
- Source: https://registry.npmjs.org/preact/-/preact-11.0.1.tgz
- Tarball SHA-256: `a48a17ebaa5ccae3975fee42f3a0ee3042ef68d97060b6fb01ace3fa9996405d`
- License: MIT (see `LICENSE`)

Vendored to keep the UI's runtime supply chain auditable: no install-time fetch,
no transitive deps, fixed bytes on disk. Aliased into the build via
`app/ui/vite.config.js` (replaces `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`).

Used (bundled) files only:
- `dist/preact.mjs`
- `hooks/dist/hooks.mjs`
- `compat/dist/compat.mjs`
- `jsx-runtime/dist/jsxRuntime.mjs`

Other directories from the upstream tarball are kept as-is for traceability but
are not referenced by any alias and therefore never reach the production bundle.

To refresh: download the new tarball, verify its SHA, replace the contents of
this directory, and update this file.

(Migration prepared with help from Claude Code.)
