# Vendored ffmpeg.wasm

In-browser audio decode for the file-upload path, so the WebUI reproduces the
CLI's `ffmpeg -i <file> -ac 1 -ar 16000 -f f32le` (scripts/transcribe.mjs
`decodePcm`) byte-for-byte, including AAC encoder-delay/priming trimming that the
browser's `decodeAudioData` does not do. Used by `app/ui/src/lib/audioDecode.js`
(`decodeToPcm16kFfmpeg`), which App.jsx's `processAudioFile` prefers and falls
back from to a Web Audio single pass on failure.

## Wrapper (`ffmpeg/dist/esm/`)

- Package: `@ffmpeg/ffmpeg`
- Version: `0.12.15`
- Source: https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz
- Tarball SHA-256: `c8a23365fb39b46d3d1d9baa2e74b522d00ce5d57e8b20471ad2665eaad38e3e`
- License: MIT (see upstream `package.json`)

Aliased in `app/ui/vite.config.js`: `@ffmpeg/ffmpeg` ->
`vendor/ffmpeg/ffmpeg/dist/esm/index.js`. The `FFmpeg` class spawns its worker
via `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`,
which Vite bundles into a same-origin worker chunk (satisfies `worker-src
'self'`). Only the ESM `dist/esm/*.js` are vendored (index, classes, const,
errors, types, utils, worker); the `.d.ts`, `.map`, and UMD builds are dropped.

`@ffmpeg/util` is intentionally NOT vendored: we pass the core as same-origin
URLs (no `toBlobURL`) and read the upload via `File.arrayBuffer()`, so none of
util's helpers are used.

## Runtime core (`app/ui/public/ffmpeg/`)

The emscripten core (glue + wasm) is served same-origin from `public/ffmpeg/`
(mirrored like `public/ort/`), so no CDN is trusted and it loads under the strict
CSP + COEP require-corp: the module worker imports the ESM core via
`import('/ffmpeg/ffmpeg-core.js')` (`script-src 'self'`) and the glue fetches
`/ffmpeg/ffmpeg-core.wasm` (`connect-src 'self'`).

- Package: `@ffmpeg/core`
- Version: `0.12.10`
- Source: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- Tarball SHA-256: `d00089ce82e1bdf637ddbe42e0c3d41a1ba8cf4c9e825e7fa4d0bb970e844bd4`
- License: GPL-2.0-or-later (ffmpeg build; compatible with this app's AGPL-3.0)

Mirrored files (the single-thread ESM build, `dist/esm/`):
- `ffmpeg-core.js`   SHA-256 `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`
- `ffmpeg-core.wasm` SHA-256 `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7` (~31 MB)

## License note

The wrapper is MIT; the core is GPL-2.0-or-later (the ffmpeg binary it wraps).
GPL-2.0-or-later can be taken under GPL-3.0, which interoperates with this
project's AGPL-3.0 license, so shipping the core wasm alongside the app is
compatible. The core's corresponding source is the upstream ffmpegwasm/ffmpeg.wasm
build at the pinned version above.

## To refresh

Download the new tarballs, verify their SHAs, then replace:

```sh
# wrapper (ESM only)
tar -xzf ffmpeg-<ver>.tgz
cp package/dist/esm/*.js app/ui/vendor/ffmpeg/ffmpeg/dist/esm/

# core (single-thread ESM js + wasm)
tar -xzf core-<ver>.tgz
cp package/dist/esm/ffmpeg-core.js package/dist/esm/ffmpeg-core.wasm \
   app/ui/public/ffmpeg/
```

Then update the versions/SHAs above, rebuild, and re-run
`test/e2e/transcription-upload-ffmpeg-parity.spec.js`.
