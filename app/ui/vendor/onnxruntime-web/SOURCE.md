# Vendored onnxruntime-web

- Package: `onnxruntime-web`
- Version: `1.29.0`
- Source: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.29.0.tgz
- Tarball SHA-256: `7a934b7811c3b050ecfb7619722e2b4de771ce6da20520e17a2018a440316ef3`
- License: MIT (see upstream `package.json`; LICENSE not shipped in tarball)

Vendored to keep the UI's runtime supply chain auditable: no install-time fetch,
no transitive deps. Aliased into the build via `app/ui/vite.config.js`. The
bundled ESM entry (`dist/ort.bundle.min.mjs`, resolved through the upstream
`exports` map) inlines all transitive deps (onnxruntime-common, flatbuffers,
guid-typescript, long, platform, protobufjs).

Used (bundled) files only:
- `dist/ort.bundle.min.mjs` (default browser ESM entry)
- `dist/ort.jspi.bundle.min.mjs` (the JSPI entry, i.e. ORT's native C++ WebGPU
  execution provider). Loaded only behind the experimental `?ortep=jspi` URL
  flag, as a lazily imported chunk, so a normal visitor never fetches it. It is
  aliased explicitly in `app/ui/vite.config.js` because the exact-match alias
  for the bare package name does not cover subpaths, and an unaliased
  `onnxruntime-web/jspi` would resolve outside this audited tree.

Other files from the upstream tarball are kept as-is for traceability but are
not referenced by any alias and therefore never reach the production bundle.

## Runtime WASM artifacts

The WASM binaries that ORT loads at runtime are mirrored into
`app/ui/public/ort/` so Caddy/Vite serve them from same-origin — no public
CDN trust. `app/src/backend.js` sets `ort.env.wasm.wasmPaths = '/ort/'`.

Mirrored files (kept in sync with this vendor folder):
- `ort-wasm-simd-threaded.{wasm,mjs}`
- `ort-wasm-simd-threaded.jsep.{wasm,mjs}` (WebGPU EP)
- `ort-wasm-simd-threaded.asyncify.{wasm,mjs}`
- `ort-wasm-simd-threaded.jspi.{wasm,mjs}`

To refresh: download the new tarball, verify its SHA, replace the contents of
this directory, update this file, then re-mirror:

```sh
cp app/ui/vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs} \
   app/ui/vendor/onnxruntime-web/dist/ort-wasm-simd-threaded.{jsep,asyncify,jspi}.{wasm,mjs} \
   app/ui/public/ort/
```

(Migration prepared with help from Claude Code.)
