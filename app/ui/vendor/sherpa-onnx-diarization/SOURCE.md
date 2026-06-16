# Vendored sherpa-onnx speaker diarization (WebAssembly)

The offline speaker-diarization engine used by the "Speakers" feature. It is a
self-contained WebAssembly build of [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
that bundles its **own** ONNX Runtime (compiled C++), separate from the app's
`onnxruntime-web`. We load it lazily (only when the user diarizes) so the
~11 MB `.wasm` never touches the critical transcription path.

- Project: `k2-fsa/sherpa-onnx`
- Version: `v1.13.3`
- Source tarball: https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-wasm-simd-v1.13.3-speaker-diarization.tar.bz2
- Tarball SHA-256: `bd9645354e5eb7d261dc5b8227e46937615a53571250f3e7ea11d2af4899e3ac`
- License: Apache-2.0 (see `LICENSE` in this folder).

Vendored (not fetched at install/build time) to keep the runtime supply chain
auditable, same policy as `onnxruntime-web/`. The model weights are **not**
vendored: they are downloaded at runtime through the app's HuggingFace hub +
local-`/models` fallback path and written into the WASM FS (see
`app/ui/src/lib/diarizer.js`). See the model licensing note at the bottom.

## Files in this folder

| File | Origin in the tarball | Modified? |
|---|---|---|
| `sherpa-onnx-speaker-diarization.js` | `sherpa-onnx-speaker-diarization.js` (the high-level JS API: `OfflineSpeakerDiarization`, `createOfflineSpeakerDiarization`) | verbatim |
| `sherpa-onnx-wasm-main-speaker-diarization.js` | `sherpa-onnx-wasm-main-speaker-diarization.js` (emscripten glue) | **patched** — see "The `.data` strip" below |
| `LICENSE` | upstream repo `LICENSE` @ `v1.13.3` | verbatim |

The `.wasm` runtime binary is mirrored to `app/ui/public/sherpa-onnx/` so it is
served same-origin (no CDN trust), the same arrangement as `public/ort/`:

- `sherpa-onnx-wasm-main-speaker-diarization.wasm`
  - SHA-256: `d3322ee667ed5fd8476cb0fb11419f648300149533e7119470ef07e24cc9b60e`

The upstream tarball's `index.html`, `app-speaker-diarization.js` (demo UI), and
`sherpa-onnx-wasm-main-speaker-diarization.data` (44 MB of baked-in default
models) are intentionally **not** vendored.

## The `.data` strip (the one patch)

Upstream's emscripten glue preloads two ONNX models baked into a 44 MB
`.data` package: `/segmentation.onnx` (pyannote-segmentation-3.0) and
`/embedding.onnx` (a 38 MB zh-cn 3D-Speaker ERes2Net). We do **not** want those:
the app downloads its own models (notably a multilingual CAM++ embedding) via
the hub and writes them into the WASM FS itself. The C++ side only reads model
paths from the diarizer config at construction time, so an empty FS at init is
fine.

The glue's data-package loader is a single self-contained IIFE near the top of
the file. Leaving it in would register an emscripten run-dependency that never
resolves (no `.data` is shipped), hanging init. So it is **removed** in the
vendored copy. Concretely, the deleted span is:

- **from** `if(!Module["expectedDataFileDownloads"])Module["expectedDataFileDownloads"]=0;...`
- **through** the trailing `...remote_package_size:45587685})})();`

i.e. the whole `(()=>{ ... loadPackage({...}) })();` block (~3981 bytes). The
runtime code immediately after it (`var arguments_=[]...`) is untouched.

### Refresh procedure (on a version bump)

1. Download the new `sherpa-onnx-wasm-simd-vX.Y.Z-speaker-diarization.tar.bz2`
   release asset and record its SHA-256 above.
2. Copy `sherpa-onnx-speaker-diarization.js` and the `.wasm` verbatim (update the
   wasm SHA-256 above and the integrity pin in `app/ui/src/lib/diarizer.js`).
3. Re-apply the `.data` strip to the new glue: delete the
   `if(!Module["expectedDataFileDownloads"])...})();` IIFE. The exact byte
   offsets drift between builds, so paren-match the `(()=>{ ... })()` wrapper
   that begins right after the `expectedDataFileDownloads` guard rather than
   trusting a fixed offset.
4. Rebuild and run the diarization path end-to-end; confirm no request for
   `*.data` is made and the FS-injected models load.

## Model licensing (downloaded at runtime, not vendored)

- pyannote **segmentation-3.0** — MIT. The canonical `pyannote/segmentation-3.0`
  HF repo is **gated**; we pull the un-gated mirror
  `csukuangfj/sherpa-onnx-pyannote-segmentation-3-0` (MIT permits this
  redistribution).
- 3D-Speaker **CAM++** embedding — Apache-2.0 (`modelscope/3D-Speaker`).

This folder was assembled with the help of Claude Code.
