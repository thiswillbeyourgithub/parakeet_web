# Changelog

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Notable changes to Parakeet Web. This file starts at 10.0.0; earlier releases are recorded only in the git history.

Written with the help of [Claude Code](https://claude.com/claude-code).

---

## 10.0.0 (2026-08-21)

One theme runs through this whole release: **extract as much speed as possible from ordinary, commodity hardware, and stop guessing where that speed is**. Almost every change below started as a measurement that contradicted an assumption, including one assumption that had been wrong for a month and had a whole feature switched off because of it.

The app is meant to run on whatever machine a person already owns, usually a laptop with no usable GPU, so the work went into the CPU path first and into never making a machine pay for a choice that does not suit it.

### What this actually bought, measured

The numbers below come from an interleaved A/B of the shipped 9.9.0 build against the shipped 10.0.0 build, served side by side, on the same 6.5-minute English recording, on the reference machine (a 6-core / 12-thread desktop; an RTX 3090 Ti where a GPU is involved). Arm order rotates every repetition so drift in background load cannot favour whichever build runs first, figures are medians, and intervals are a percentile bootstrap over the ratio of medians with a Mann-Whitney rank test alongside. This machine carries a 5 to 10 % run-to-run spread from its own resident load, which is larger than several of the effects below and is why the CPU arms were run 20 times each. Your machine will differ, which is exactly why the app now measures yours instead of trusting these.

| Path | 9.9.0 | 10.0.0 | Change |
|---|---|---|---|
| GPU (WebGPU) | 1004 s | 20 s | **50x faster** |
| CPU (WASM) | 104 s | 111 s | **7 % slower** (p=0.03, n=20 per arm) |

**This is a GPU release, and it costs the CPU path about 7 %.** In 9.9.0 the GPU path was switched off because it measured about 10x slower than the CPU path. In 10.0.0 it is roughly 5x faster than the CPU path on the same machine, which is the difference between a path nobody could use and the fastest one available.

The CPU regression is not diffuse, and it is worth being precise about because the obvious guess is wrong. It is not the accumulation of several changes each costing a little. **Everything 10.0.0 changed about CPU work other than the chunk window measures +0.5 % (95 % CI 0.945 to 1.091, p=0.71), which is nothing at all.** The entire deficit is the chunk window default going from 20 s to 60 s: it costs 6.7 % on the new build, 8.7 % on the old one, and 7.9 % on the int8-lite encoder. Three arms, two independently built trees, two quantisations, every one of them p < 0.02. Conformer attention is quadratic in sequence length, so tripling the window triples per-chunk attention work while only thirding the number of chunks.

That same window is worth 2.3x on the GPU. So it is a real trade rather than a mistake: the right default if the GPU is the target, the wrong one for the laptop-without-a-usable-GPU case this app is built for.

Two claims from an earlier draft of these notes were withdrawn after better-powered measurement, and are recorded here because the retraction is the useful part. The CPU path was reported as showing "no measurable change" at n=13 per arm, which was a limit of that measurement rather than a property of the code, and the top-K decoder and optimized encoder graph were credited as CPU improvements that "measured well on their own". At n=20 they are jointly indistinguishable from zero. Both graphs are still preferred when the model source ships them, and both remain worthwhile on the GPU path, but neither buys anything measurable on the CPU.

Per change, where a number exists:

| Change | Measured effect |
|---|---|
| Pausing page animations during a GPU run | 22x on the GPU path on its own; a 3-minute clip went from 12 min 39 s to 8.5 s |
| 60-second chunk window (was 20 s) | 2.3x on the GPU path; 7 % slower on the CPU path |
| Parallel encode pool | +4.2 % on an idle machine, 14.6 % worse on a busy one, which is why its hardware gate was raised |
| Top-K decoder, optimized encoder graph | no measurable effect on the CPU path (see above) |

### What it costs

First model load on the CPU path went from 11.4 s to 13.8 s, and peak memory from about 10.1 GB to about 11.1 GB. On the GPU path both were measured with only two runs per arm, where the difference is not separable from the noise. The app also ships about 6 MB more static assets, 5 MB of which is the probe graphs.

The slower first load is a deliberate trade: after writing the model to IndexedDB the app now re-reads it from there instead of reusing the in-memory copy, which costs a full extra read of an 833 MB file but avoids a class of corrupted-blob load failures. Loads after the first one read from the cache either way and are unchanged.

### Added

- **Autoconfigure: the app measures your machine instead of guessing.** Two roughly 5 MB ONNX graphs are timed through both the CPU and the GPU path on your own hardware, and the faster one wins. It runs once per machine, in throwaway workers so it costs the real pipeline nothing, and it never overrides a backend you picked by hand. There is also an "Autoconfigure optimal performance" button in the sidebar to re-run it on demand. On the reference GPU it reads a 3.06x to 4.64x advantage, against a true end-to-end gap of roughly 5x measured on a 6.5-minute clip, so it under-reports, which is the safe direction to be wrong in. What protects you is not its accuracy but its threshold: the GPU path costs a 1.2 to 2.4 GB download, recommending that wrongly is the one expensive mistake, so it only moves you when it reads at least 2x.
- **WebGPU is available again**, and is now chosen per machine by the probe rather than by a global switch. See below for why it was off.
- **In-graph top-K and log-sum-exp decoders.** When the model source ships them, the app prefers decoder graphs that return only the top-K logits and compute the log-sum-exp inside the graph, so each decode step stops copying a full vocabulary row out of the model.
- **Optimized encoder graphs.** When the source ships a pre-optimized encoder, it is preferred, including for the sharded fp32 build.
- **One-click benchmark.** A sidebar section measures every backend and precision your device can actually run, on a clip that ships with the app, and builds a single anonymised report you can read, copy, or send if the instance collects them.
- **Composed encode pool and decode worker** on the CPU path, so encoding and decoding overlap (operator opt-in via `VITE_WASM_DECODE_PIPELINE`).
- **Non-Chromium warning.** Firefox runs the same WASM kernels roughly 9x slower for reasons outside this app, so it now says so once, dismissably, instead of just feeling broken.
- **Fallback when a deployment has no GPU weights.** If the model source ships no encoder the GPU can run, the app loads the CPU version and tells you, instead of failing. This matters because the probe can select the GPU for a visitor who never chose it.

### Changed

- **The chunk window default went from 20 s to 60 s**, and the cap from 25 s to 90 s, both from measurement. It is worth 2.3x on the GPU path and costs about 7 % on the CPU path, so a machine without a usable GPU pays for a setting that only the GPU benefits from. A persisted 20 s window is migrated automatically, and the setting remains adjustable.
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
