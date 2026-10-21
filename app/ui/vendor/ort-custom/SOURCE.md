# Self-compiled ONNX Runtime CPU runtime

Not downloaded: built in this repo by `scripts/ort-custom/build.sh` from the pinned upstream ONNX Runtime tag (the same version as the vendored `onnxruntime-web`) plus `scripts/ort-custom/wasm-qnbitgemm.patch`, then installed with `--install`.

- `BUILD-INFO`: every build input (ORT version and commit, emsdk version, patch sha256, operator config, build arguments).
- `SHA256SUMS`: the installed files under `app/ui/public/ort/`, by their installed names.

The installed files:

- `ort-wasm-relaxedsimd-threaded.custom.{mjs,wasm}`: relaxed SIMD (Chromium, Firefox).
- `ort-wasm-simd-threaded.custom.{mjs,wasm}`: plain SIMD128, for engines without relaxed SIMD.

What the patch changes: stock ORT runs `MatMulNBits` on WASM by dequantizing the weights to fp32 and calling SGEMM. The patch adds an integer kernel (8, 4 and 2 bit, `accuracy_level` 4 nodes only) and fixes an upstream guard that zeroed every 4-bit output on WASM. Everything else is the stock runtime, with every operator compiled in.

`app/src/backend.js` loads these (through the vendored `ort.wasm.bundle.min.mjs`) only in JS contexts whose sessions are all WASM, picks the file by feature detection, verifies it against `/ort/manifest.json` like the npm runtimes, and falls back to the stock runtime on any failure. `?ortep=stock` opts out.

`test/unit/ort-custom-runtime.test.mjs` fails when the vendored `onnxruntime-web` version, the patch, or the installed bytes no longer match `BUILD-INFO`/`SHA256SUMS`. After `scripts/update-vendored.sh onnxruntime-web` moves to a new version, bump `ORT_VERSION`/`ORT_COMMIT` in `build.sh`, re-validate the patch (exactness tests, WER gate), and rebuild with `--install`.

Built with Claude Code.
