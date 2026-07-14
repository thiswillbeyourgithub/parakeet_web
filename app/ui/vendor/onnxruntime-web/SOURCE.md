# Vendored onnxruntime-web

- Package: `onnxruntime-web`
- Version: `1.27.0`
- Source: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz
- Tarball SHA-256: `b59c9819434a7519f334f77e8d4bf22b69808d531a57724cabc4bb2c0704c835`
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
