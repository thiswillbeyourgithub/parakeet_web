# Changelog

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Notable changes to Parakeet Web. This file starts at 10.0.0; earlier releases are recorded only in the git history.

Written with the help of [Claude Code](https://claude.com/claude-code).

---

## 10.0.0 (2026-08-21)

One theme runs through this whole release: **extract as much speed as possible from ordinary, commodity hardware, and stop guessing where that speed is**. Almost every change below started as a measurement that contradicted an assumption, including one assumption that had been wrong for a month and had a whole feature switched off because of it.

The app is meant to run on whatever machine a person already owns, usually a laptop with no usable GPU, so the work went into the CPU path first and into never making a machine pay for a choice that does not suit it.

### What this actually bought, measured

The numbers below come from an interleaved A/B of the shipped 9.9.0 build against the shipped 10.0.0 build, served side by side, on the same 6.5-minute English recording, on the reference machine (a 6-core / 12-thread desktop; an RTX 3090 Ti where a GPU is involved). Your machine will differ, which is exactly why the app now measures yours instead of trusting these.

| Path | 9.9.0 | 10.0.0 | Change |
|---|---|---|---|
| GPU (WebGPU) | 1078 s | 30 s | **36x faster** |
| CPU (WASM) | 103 s | 103 s | no measurable change (95 % CI 0.95 to 1.10, n=13 per arm) |

**This is a GPU release.** In 9.9.0 the GPU path was switched off because it measured about 10x slower than the CPU path. In 10.0.0 it is about 3.5x faster than the CPU path on the same machine, which is the difference between a path nobody could use and the fastest one available.

The CPU path is the honest disappointment. Several changes that measured well on their own (the relaxed-SIMD engine, top-K decoder outputs, the optimized encoder graph, the 60-second window) do not compose into a gain this machine can tell apart from noise. Its resident load produces a 5 to 8 % run-to-run spread, so resolving a real 4 % improvement would need roughly 41 repetitions per arm, and 13 were run. The result is bounded rather than zero: any end-to-end CPU change larger than about 10 %, in either direction, is ruled out.

Per change, where a number exists:

| Change | Measured effect |
|---|---|
| Pausing page animations during a GPU run | essentially the entire GPU gain; a 3-minute clip went from 12 min 39 s to 8.5 s |
| 60-second chunk window (was 20 s) | 1.41x on the GPU path; no measurable change on the CPU path |
| Relaxed-SIMD CPU engine | 2.7 % faster on the shipped build, not distinguishable from noise (95 % CI 0.90 to 1.05, n=11 per arm, forced on against forced off). The 18.6 % measured in August was against a different encoder than 10.0.0 ships, and is decisively excluded here |
| Parallel encode pool | +4.2 % on an idle machine, 14.6 % worse on a busy one, which is why its hardware gate was raised |

### What it costs

First model load on the CPU path went from 11.5 s to 15.5 s, and peak memory from 10.5 GB to 11.3 GB. The GPU path is unaffected on both counts. The app also ships about 19 MB more static assets (13 MB for the relaxed-SIMD runtime, 6 MB for the probe graphs).

The slower first load is a deliberate trade: after writing the model to IndexedDB the app now re-reads it from there instead of reusing the in-memory copy, which costs a full extra read of an 833 MB file but avoids a class of corrupted-blob load failures. Loads after the first one read from the cache either way and are unchanged.

### Added

- **Autoconfigure: the app measures your machine instead of guessing.** Two roughly 5 MB ONNX graphs are timed through both the CPU and the GPU path on your own hardware, and the faster one wins. It runs once per machine, in throwaway workers so it costs the real pipeline nothing, and it never overrides a backend you picked by hand. There is also an "Autoconfigure optimal performance" button in the sidebar to re-run it on demand. On the reference GPU it reads a 3.06x to 4.64x advantage, against an end-to-end gap of about 3.5x measured on a 6.5-minute clip, so its number is an approximation rather than a promise. What protects you is not its accuracy but its threshold: the GPU path costs a 1.2 to 2.4 GB download, recommending that wrongly is the one expensive mistake, so it only moves you when it reads at least 2x.
- **WebGPU is available again**, and is now chosen per machine by the probe rather than by a global switch. See below for why it was off.
- **Faster CPU engine (Relaxed-SIMD).** The app ships a second ONNX Runtime WASM build using relaxed-SIMD instructions, picked by a micro-benchmark at startup when it is at least 1.5x faster on your browser (that margin is calibrated so Firefox, where the instructions are much slower, is never moved onto it by accident). Built reproducibly from a pinned toolchain in Docker, with `VITE_ORT_RELAXED_ENABLE` as an operator kill switch.
- **In-graph top-K and log-sum-exp decoders.** When the model source ships them, the app prefers decoder graphs that return only the top-K logits and compute the log-sum-exp inside the graph, so each decode step stops copying a full vocabulary row out of the model.
- **Optimized encoder graphs.** When the source ships a pre-optimized encoder, it is preferred, including for the sharded fp32 build.
- **One-click benchmark.** A sidebar section measures every backend and precision your device can actually run, on a clip that ships with the app, and builds a single anonymised report you can read, copy, or send if the instance collects them.
- **Composed encode pool and decode worker** on the CPU path, so encoding and decoding overlap (operator opt-in via `VITE_WASM_DECODE_PIPELINE`).
- **Non-Chromium warning.** Firefox runs the same WASM kernels roughly 9x slower for reasons outside this app, so it now says so once, dismissably, instead of just feeling broken.
- **Fallback when a deployment has no GPU weights.** If the model source ships no encoder the GPU can run, the app loads the CPU version and tells you, instead of failing. This matters because the probe can select the GPU for a visitor who never chose it.

### Changed

- **The chunk window default went from 20 s to 60 s**, and the cap from 25 s to 90 s, both from measurement. A persisted 20 s window is migrated automatically.
- **The parallel encode pool now requires 8 logical cores**, up from 4. Its honest envelope is a small win on an idle machine and a real loss on a busy one, so only machines with genuine headroom take the bet.
- **Seams are always de-duplicated**, not only when word timestamps were requested.
- The "folded" encoder variant is now called "optimized" throughout.

### Fixed

- **The WebGPU slowdown, which was never the model.** WebGPU had been pinned off since July on a verdict of "about 15x slower than the CPU", blamed on the encoder's dynamic-shape operators. That diagnosis was wrong. The runtime yields to the event loop about 2000 times per encoder run, and Chromium delivers those callbacks no faster than the page produces compositor frames, process-wide. The transcribing spinner alone was therefore taxing every one of those 2000 yields, with the GPU sitting at 0 % utilisation. Pausing page animations for the duration of a GPU run removed the entire tax. Moving the encoder into a worker, tried first, measured about 3x **worse**.
- The live listening dots are now a static rising-opacity ellipsis, since a continuous animation is exactly what the previous entry describes.
- A worker script that fails to load now falls back to the in-thread path instead of hanging transcription forever, and a hung worker init can no longer block a run.
- A settings database left without its object store no longer breaks boot.
- Download resume state is stored by value, so a resumed download serves the cache correctly.

### Breaking / behaviour changes

- **A capable machine may now download the GPU model by itself.** When the probe finds the GPU clearly faster, the app fetches the fp16 encoder (about 1.2 GB) or, without `shader-f16`, the sharded fp32 encoder (about 2.4 GB), instead of the roughly 600 MB int8 build. Self-hosters must keep serving those files, or visitors get the CPU fallback described above.
- **The WebGPU escape hatch inverted**: `?webgpu=0` now forces the CPU path. `?webgpu=1` is still accepted and harmless.
- A persisted 20-second chunk window is rewritten to the 60-second default on first boot.
