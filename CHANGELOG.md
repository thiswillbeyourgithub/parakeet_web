# Changelog

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Notable changes to Parakeet Web. This file starts at 10.0.0; earlier releases are recorded only in the git history.

Written with the help of [Claude Code](https://claude.com/claude-code).

---

## Unreleased

### The benchmark says what hardware it ran on, and hands the machine back when it is done

A benchmark report is only useful if the numbers can be attributed to a chip. It described the CPU (core count, memory class, architecture) and the one GPU adapter the browser handed out by default, which on a laptop with two of them says nothing about which one actually ran. Reports now list every adapter the machine offers, asked for by power preference, so an integrated and a discrete GPU both appear, plus the readable GPU names the browser reports through WebGL. Those names are also the only GPU evidence at all on a machine with no WebGPU, which is exactly the machine whose owner is asking why the GPU option is greyed out. Browsers expose no CPU model string to anyone, so that stays missing by necessity, not by choice.

The run itself behaves better around the rest of the app. The recording, file and phone buttons no longer sit there through a benchmark: it drives the same loading and transcription paths, so the app looked ready for work it could not take, and a capture would only have fought the run for the model it was timing. When the run finishes, the sidebar reopens on the results, scrolls to the report, and says the benchmark is done, instead of leaving the numbers behind a panel the user closed to watch the run. And a run started with no model loaded no longer leaves one loaded: the weights in memory are whichever combination the plan ended on, which is not necessarily the configuration the settings show, so they are released and the Load model button comes back.

### The explanation for a greyed-out option is readable again

An option your machine cannot use is greyed out, and the "?" beside it says why (WebGPU with no usable GPU adapter being the common case). The greying was applied to the whole row, help popup included, so the very text explaining the situation came out half transparent. The popup is now drawn outside the greyed row and is fully opaque again.

### The lighter int8 encoder is back, as a choice next to the default one

The model repo builds two int8 encoders from the same calibration run. They differ in how many matrix multiplications are left in full precision: 18 in the default build, 11 in the lite one. That makes the lite encoder about 88 MB smaller to download and, measured on this machine, about 164 MiB lighter in peak memory, in exchange for slightly more transcription error.

It used to exist, was withdrawn because the trade did not look worth it, and is now back where it belongs: as a third entry in the encoder precision list (int8 lite / int8 / fp32) rather than a decision made for you. int8 stays the default and nothing changes for anyone who does not touch the setting. The self-service benchmark gained a row for it too, since "is the lighter encoder good enough on my machine" is exactly the kind of question it exists to answer.

Picking it against a mirror that does not host the lite file stops the load with a clear message instead of quietly serving the heavier encoder, the same rule fp32 already followed. On WebGPU it behaves exactly like int8: the GPU has no int8 encoder kernel at all, so both resolve to fp32.

Two smaller fixes came out of wiring it in. A local mirror serving the lite encoder was never asked whether it had it, so the file could sit right there and still be reported as unavailable. And asking for an fp32 decoder alongside an encoder precision that WAS available came back marked as fully honoured, even though there is no fp32 decoder to give: the downgrade is now reported, so the banner and the mirror-upgrade probe both fire as they should.

### Beam search stops paying for decoder outputs it throws away

The decoders in the model repo now expose extra values inside the graph, so a decode step can read a few dozen floats instead of the whole ~8,200-float logit row. The greedy path asks for exactly those and gets them.

Every other decode path (beam search, phrase boosting, and any run with a temperature) asked for nothing in particular, and in ONNX Runtime that means "return every output you have". On the new decoders this silently included the three top-K outputs those paths never read, computed and copied out of the engine on every joint call. In a microbenchmark of 800 joint calls at beam width 8 it cost 27 % of the loop: 4,334 ms against 3,399 ms (onnxruntime-node, CPU, single thread). The saving over a whole transcription is smaller, since that loop is only part of it.

Those paths now name the outputs they read. Transcripts are unchanged, and a decoder that does not carry the extra outputs is unaffected: the list is built from what the loaded model actually declares, so an older or upstream decoder behaves exactly as before.

### The app stops downloading three WebAssembly runtimes it never runs

ONNX Runtime is vendored as four separate WebAssembly builds (plain, JSEP, JSPI, asyncify) and the app only ever loads one of them. It was downloading and hash-checking all four at startup anyway: 79,772,176 bytes where 26,874,157 are the ones actually used. Worse, it did that once per JavaScript context, and every transcription worker is its own context, so a machine running the parallel encode pool alongside the composed decode worker paid that bill four times over, at the exact moment the model weights were downloading too.

That was not only waste. Under the pile of concurrent transfers one of them reliably failed outright, and a worker whose runtime download fails is out for the rest of the session: its share of the work quietly moves back onto the main thread, the transcript still comes out fine, and the only trace is a line in the console. Our own end-to-end test caught it, which is why the test asserts on the console and not just on the text.

The integrity guarantee is unchanged where it counts: the bytes handed to ONNX Runtime are still pinned to the hash the build recorded for them, and a tampered runtime still refuses to load. Hashing three builds that are never executed protected nothing.

### The app itself now downloads about six times smaller

Every visitor downloads the app bundle before anything else happens, and 130 of its 138 MB are WebAssembly: the ONNX Runtime builds, ffmpeg, and the diarization engine. Caddy was compressing those bytes again for every single request. They are now compressed once, at image build time, and served as-is.

Measured on the shipped bundle: the ONNX Runtime WebGPU build goes from 26 MB to 3.5 MB, ffmpeg from 31 MB to 6.9 MB, the diarization engine from 17 MB to 2.5 MB. The server also stops spending CPU on it entirely.

Nothing changes for the app: the browser decodes the response before the app sees it, so the bytes it gets, and the integrity hashes it checks them against, are exactly the same. A browser that does not accept brotli falls back to what it got before.

The only visible cost is on the maintainer side: `docker build` takes about two and a half minutes longer, which is the point of doing it there rather than on every request.

### Self-hosted model weights can now be served compressed

A self-hosted mirror can pre-compress its model files once and let Caddy serve them with `Content-Encoding: zstd`. On the shipped int8 encoder that is 881,878,510 bytes down to 642,839,559 (27 % less to download, both measured), and the browser decompresses it natively in about 3 seconds, so any connection slower than roughly 200 MB/s comes out ahead.

This was not happening before by accident: model weights are served as `application/octet-stream`, and Caddy's `encode` directive deliberately skips that content type. Compressing on the fly would have cost 6 to 11 seconds of server CPU on every download by every visitor, so the bytes are prepared once instead, by `scripts/precompress.mjs`.

Notes for self-hosters:

- Run `node scripts/precompress.mjs --models <model-dir>` after populating (or replacing) the model folder. It is idempotent and never fails a deployment. It uses the `zstd` binary when the host has one and Node's own zstd otherwise.
- Or set `PRECOMPRESS_MODELS=1` and let the container prepare them at startup instead. That needs the model volume mounted writable (drop its `:ro`) and takes 30 to 90 seconds on the first boot after a model change; later boots find them current and do nothing.
- Without a `.zst` sidecar, or for a browser that does not accept zstd, Caddy serves the plain file exactly as before. Nothing else has to change.
- A sidecar older than its source would be served instead of the real file, so the script deletes any it cannot regenerate, and the container warns at startup if it finds a stale one.
- Downloads that resume mid-file are unaffected: browsers ask for byte ranges uncompressed.

This applies to a locally served mirror only. Weights fetched from HuggingFace are served by HuggingFace, uncompressed, and nothing here changes that.

### One build per precision: the optimised graphs are now the only graphs

The model repo used to ship a stock ONNX file next to an optimised variant of it, under a longer filename, and the app HEAD-probed for those longer names on every load. That is over: the graph work now lives inside the canonical `encoder-model*.onnx` and `decoder_joint-model*.onnx`, and there is nothing else to choose between.

Concretely, what those canonical files now contain:

- **Both encoders are graph-optimised.** Their runtime shape-computation glue is constant-folded offline, which is a rewrite of the plumbing around the maths, not of the maths: int8 goes from 3547 to 2732 nodes, fp32 from 4491 to 2041. Outputs are verified bit-identical to the unoptimised build (a strict tolerance of 0.0 across several sequence lengths), so transcripts do not move. On wall time the honest answer is that it did not resolve: the fp32 A/B came out 4.7 % in the optimised build's favour with a confidence interval that still spans "no difference".
- **Both decoders carry extra in-graph outputs** that a decode step can read instead of doing the same work in JavaScript: the log-partitions the beam search needs, and the top few token logits the greedy path needs instead of reading a whole 8193-float row back out of ONNX Runtime per step. Measured on the GPU backend, decode is about 5 % faster with them; total wall time is a wash, because decode is not what dominates there.

What this changes for you:

- Everybody gets the optimised graphs, instead of only the visitors whose model mirror happened to serve the extra files.
- Against a locally served mirror, six fewer HEAD requests before each model load, plus a redundant scan for a second set of fp32 shards: the app no longer goes looking for filenames that no longer exist.
- Nothing to select, and nothing to configure: there is one file per precision.
- Self-hosters should mirror the canonical names and can delete any `.optimized`, `.lse` or `.topk` file from their mirror. The app ignores them now.

An older mirror is still perfectly usable, including the upstream `istupakov` repo: its decoders simply do not declare the extra outputs, the engine notices at load time and keeps computing those values in JavaScript exactly as before.

### Two encoder builds withdrawn: `int8 lite` and `fp16`

The model repo shipped four encoder precisions. Two of them are gone, from the model repo and from the app, along with the code that selected them.

**`int8 lite`** (about 757 MB against the default build's 841 MB) kept more layers in fp32 to buy back a little accuracy the aggressive int8 quantisation gave up. Measured over the 25-language FLEURS validation split it came out at 14.82 % WER against the default build's 14.27 %, and on the eight-speech long-audio set at 9.9 % against 8.6 %. So it was slightly worse on both, for 84 MB less download. Nothing recommended it, and every extra precision in the picker is another combination to test and another thing to explain.

**`fp16`** (about 1.2 GB) was the WebGPU default. It could never be exercised end to end here: its WGSL kernels need the WebGPU adapter to expose `shader-f16`, and the GPU this project develops against does not, whatever the driver reports. ONNX Runtime would build the session happily and then return an empty transcript. The one thing that could be measured, its accuracy under native onnxruntime with fp16 compute, was good, but "good on a path we cannot run" is not a shipping precision, and it was sitting in front of every visitor the performance probe moved onto the GPU.

What this changes for you:

- The encoder-precision picker now offers **int8** and **fp32**, nothing else.
- On the WebGPU backend the encoder is now always **fp32** (about 2.4 GB, loaded as shards). This is not a downgrade from what actually ran: it is what a GPU without `shader-f16` already fell back to.
- If you had `int8 lite` or `fp16` selected, you are moved to the working precision for your backend on the next load.
- Self-hosters can drop `encoder-model.int8.lite.onnx`, `encoder-model.fp16.onnx` and `decoder_joint-model.fp16.onnx` from their mirror. **The fp32 shards are now mandatory for any deployment that wants to serve WebGPU visitors at all**, since fp16 is no longer there to cover for a mirror that lacks them. A mirror serving neither still degrades safely: those visitors fall back to the CPU path with a warning, as before.

The fp16 build script is kept in the model repo so the build can be regenerated if a machine with `shader-f16` ever makes it testable.

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

**This is a GPU release, and it spends about 7 % of the CPU path's speed on accuracy.** In 9.9.0 the GPU path was switched off because it measured about 10x slower than the CPU path. In 10.0.0 it is roughly 5x faster than the CPU path on the same machine, which is the difference between a path nobody could use and the fastest one available.

The CPU regression is not diffuse, and it is worth being precise about because the obvious guess is wrong. It is not the accumulation of several changes each costing a little. **Everything 10.0.0 changed about CPU work other than the chunk window measures +0.5 % (95 % CI 0.945 to 1.091, p=0.71), which is nothing at all.** The entire deficit is the chunk window default going from 20 s to 60 s: it costs 6.7 % on the new build, 8.7 % on the old one, and 7.9 % on the int8-lite encoder. Three arms, two independently built trees, two quantisations, every one of them p < 0.02. Conformer attention is quadratic in sequence length, so tripling the window triples per-chunk attention work while only thirding the number of chunks.

That 7 % is not a regression to be fixed, though, because speed is not what the longer window was bought for. **It transcribes more accurately.** A grid over 200 long French-medical clips (2.7 h of audio) put 60 s chunks within +0.14 WER of decoding each clip whole, against +0.66 at 20 s and +1.28 at 25 s: every seam costs a little, mostly deletions at the splice, so fewer seams come out better. The same window is also worth 2.3x on the GPU. So the CPU path pays about 7 % for roughly half a point of WER, and that is the intended trade rather than an oversight.

One claim from that grid does not survive this measurement: it reported throughput as flat across window sizes. It is not, at least on this machine, by 7 to 9 % across three arms. The accuracy result is unaffected.

Two claims from an earlier draft of these notes were withdrawn after better-powered measurement, and are recorded here because the retraction is the useful part. The CPU path was reported as showing "no measurable change" at n=13 per arm, which was a limit of that measurement rather than a property of the code, and the top-K decoder and optimized encoder graph were credited as CPU improvements that "measured well on their own". At n=20 they are jointly indistinguishable from zero. Both graphs are still preferred when the model source ships them, and both remain worthwhile on the GPU path, but neither buys anything measurable on the CPU.

Per change, where a number exists:

| Change | Measured effect |
|---|---|
| Pausing page animations during a GPU run | 22x on the GPU path on its own; a 3-minute clip went from 12 min 39 s to 8.5 s |
| 60-second chunk window (was 20 s) | about 0.5 WER better than 20 s; 2.3x on the GPU path; 7 % slower on the CPU path |
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
- **Non-Chromium warning.** Firefox runs the same WASM kernels about 11x slower for reasons outside this app (measured here at 1153 s against 104 s on Chromium for the same 6.5-minute clip), so it now says so, dismissably, instead of just feeling broken. Note that the notice reappears on each page load rather than only once.
- **Fallback when a deployment has no GPU weights.** If the model source ships no encoder the GPU can run, the app loads the CPU version and tells you, instead of failing. This matters because the probe can select the GPU for a visitor who never chose it.

### Changed

- **The chunk window default went from 20 s to 60 s**, and the cap from 25 s to 90 s, both from measurement. Fewer stitch seams transcribe better, by about half a point of WER over a 200-clip grid, and the longer window is worth 2.3x on the GPU. It costs about 7 % on the CPU path, which is the price of that accuracy. A persisted 20 s window is migrated automatically, and the setting remains adjustable for anyone who would rather have the 7 % back.
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
