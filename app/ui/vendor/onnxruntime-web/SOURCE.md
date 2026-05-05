# Vendored onnxruntime-web

- Package: `onnxruntime-web`
- Version: `1.25.1`
- Source: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.25.1.tgz
- Tarball SHA-256: `731e568a1471c6969f6c1bfb7349eff6f88f33fa5d4b46f43104ea35e34aef51`
- License: MIT (see upstream `package.json`; LICENSE not shipped in tarball)

Vendored to keep the UI's runtime supply chain auditable: no install-time fetch,
no transitive deps. Aliased into the build via `app/ui/vite.config.js`. The
bundled ESM entry (`dist/ort.bundle.min.mjs`, resolved through the upstream
`exports` map) inlines all transitive deps (onnxruntime-common, flatbuffers,
guid-typescript, long, platform, protobufjs).

Used (bundled) files only:
- `dist/ort.bundle.min.mjs` (default browser ESM entry)

Other files from the upstream tarball are kept as-is for traceability but are
not referenced by any alias and therefore never reach the production bundle.
WASM artifacts are loaded at runtime from a CDN (see `app/src/backend.js`,
which sets `ort.env.wasm.wasmPaths` based on `ort.env.versions.web`).

To refresh: download the new tarball, verify its SHA, replace the contents of
this directory, and update this file.

(Migration prepared with help from Claude Code.)
