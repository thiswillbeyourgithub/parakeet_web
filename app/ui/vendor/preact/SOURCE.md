# Vendored Preact

- Package: `preact`
- Version: `10.29.1`
- Source: https://registry.npmjs.org/preact/-/preact-10.29.1.tgz
- Tarball SHA-256: `7a9143129486379cb8340c66c68a9cedad7762730fda7286f96befa1028cce80`
- License: MIT (see `LICENSE`)

Vendored to keep the UI's runtime supply chain auditable: no install-time fetch,
no transitive deps, fixed bytes on disk. Aliased into the build via
`app/ui/vite.config.js` (replaces `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`).

Used (bundled) files only:
- `dist/preact.module.js`
- `hooks/dist/hooks.module.js`
- `compat/dist/compat.module.js`
- `jsx-runtime/dist/jsxRuntime.module.js`

Other directories from the upstream tarball are kept as-is for traceability but
are not referenced by any alias and therefore never reach the production bundle.

To refresh: download the new tarball, verify its SHA, replace the contents of
this directory, and update this file.

(Migration prepared with help from Claude Code.)
