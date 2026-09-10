# Changelog

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Notable changes to Parakeet Web. This file starts at 10.0.0; earlier releases are recorded only in the git history.

Written with the help of [Claude Code](https://claude.com/claude-code).

---

## 11.2.0 (2026-09-10)

### One click sets up French medical dictation

A new **Mode Dictée Médical** button sits at the top of the settings panel, above everything else. One click configures the whole station: the UltiMed model, the French medical phrase list at its default settings, 30-second chunks instead of 60, the dictation view, a French interface, and the encoder precision that suits each backend (int8 on the processor, fp16 on the GPU, so the choice is already right whichever one this machine ends up on).

The same preset is available as a link: `?mode=med` works, and so do `medecin`, `médecin`, `doc`, `doctor` and `ultimed`, in any capitalisation and with or without the accent, because the parameter exists for addresses people type from memory or read out to each other. A `?mode=` value that is none of those means "no opinion" and changes nothing, which matters because this preset, unlike `?model=`, is saved: a link named "medical mode" is a setup instruction, so the machine stays configured after a plain reload. Every setting it touches remains an ordinary control you can change afterwards.

In this mode the processor-vs-GPU measurement also runs when the page loads, rather than waiting for the Load Model click, so the backend is settled before you touch anything. It follows the rules it already had: it never overrides a backend you picked by hand, never re-measures a machine it has already measured, and does nothing at all on a machine with no GPU.

The preset degrades rather than fails. An instance that does not offer the UltiMed model, or does not serve the French medical list, applies everything else and says in the console which piece it skipped, because a medical lexicon over the generic model is far closer to what was asked than refusing the whole thing.

Written with [Claude Code](https://claude.com/claude-code).

---

## 11.1.0 (2026-09-09)

### Numbers dictated as words now come out as digits

Say "twenty-five milligrams" and the transcript reads "25 milligrams". The conversion covers cardinal numbers in English and French, including the compounds French builds by juxtaposition ("quatre-vingt-dix-sept"), whether the model spells them with hyphens or without. It is on by default, with a switch in the settings, and it applies to the word timestamps as well as the text, so the speaker view and the plain view always show the same digits.

Decimals are included, with a dot in both languages: "one point five" becomes "1.5", "un virgule trente" becomes "1.30", and the part after the separator is read group by group so "deux virgule zéro cinq" comes out as 2.05 rather than 2.5. The separator only counts as one between two numbers, so "the point is" and a "virgule" dictated as punctuation are left alone.

It is deliberately literal rather than clever, because guessing at meaning is how this kind of feature ruins a transcript. A run of number words only converts if it spells one grammatical number, so "two two" stays "2 2" instead of quietly becoming 4. Words that are numbers only some of the time never convert on their own: English "one" and French "un" and "une" stay as they are unless they are part of a number, which is why "one of them" survives while "twenty-one" and "un virgule trente" do not. Ordinals are left alone entirely.

The one case worth knowing about is years. "Nineteen eighty-four" is two numbers that cannot be combined into one, so it comes out as "19 84". Reading that as a year needs an understanding of the sentence that this does not have, and dictating years is a good reason to turn the setting off.

### Copy is where you are reading

The per-entry Copy button used to live in the ⋮ menu, one click away from the text it copies. It now sits with the view buttons (Raw, Dictation, Speakers) and copies the entry exactly as those buttons render it, speaker labels and dictation cleanup included. The menu keeps "Copy dictation", which copies something the buttons cannot show: the cleaned text while the entry is displayed raw.

### Phones and tablets are told this is a desktop app

The app downloads several hundred megabytes of weights and runs the model on the device itself. A phone rarely has the memory headroom or the sustained speed for that, and a mobile browser suspends a tab that goes to the background, which interrupts a transcription in progress. Visitors on a phone or tablet now get that warning before anything is downloaded, rather than discovering it partway through.

The same devices get a second explanation on Phone Mic, because there the feature makes no sense: it exists to give a computer with no microphone one, by pairing it with a second device. Someone already holding a phone should use the Record button, and the popup says so before it pairs anything.

### Fixed: keyboard shortcuts no longer swallow the browser's own

The optional single-key shortcuts ignored modifiers, so with them enabled Ctrl+R, Ctrl+S, Ctrl+F and Cmd+R were intercepted: reload, save and find stopped working and pressed record or opened settings instead. Any Ctrl, Cmd or Alt combination is now left to the browser. A focused dropdown also keeps its own keys, where typing a letter used to close the settings panel instead of jumping to a matching option.

The shortcut list in the settings was wrong in the other direction: it advertised an "L" for loading the model, which had been replaced by Space and Enter some time ago, and never mentioned "P" for pausing a recording. It now lists exactly what the app does.

---

## 11.0.0 (2026-09-08)

### A choice of models, and a link that picks one

An instance can now offer more than one model. Where the configuration used to name a single HuggingFace repo it accepts a comma-separated list, and the sidebar's *Model and performance* section grows a picker listing them; the first one is what a visitor who has never chosen gets. An instance that names a single repo, which is every instance until its operator changes that, looks and behaves exactly as before: a one-option picker would be noise, so none is drawn.

Switching model is treated like switching backend or precision: the loaded model is disposed and the new one loaded in its place, and the control is locked while a transcription is running. Because the browser keeps one model on disk at a time, switching downloads the new weights and drops the old ones, so switching back downloads again.

A link can also pin a model, with `?model=` and a loose match against the offered list: `?model=ultimed` is enough to select `Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx`. This one deliberately overrides the visitor's saved choice, unlike the phrase-boost link parameter, because a link that landed on whatever the recipient last used would not be worth sending. It is just as deliberately not saved over that choice: their own pick is back on their next ordinary visit. A value matching nothing, or matching two models equally well, is ignored rather than guessed, since a wrong guess here still produces a perfectly fluent transcript from the wrong model and nothing would reveal it.

For self-hosters serving weights from their own instance, several models are served by mounting the parent folder with one subfolder per repo. A listed model with no local copy is only a warning at startup; it is fetched from HuggingFace exactly as it would be with no local mirror at all.

### A self-hosted mirror now tells the app what it holds

An instance serving its own copy of the weights had a blind spot. A folder behind a web server cannot be listed, so the app checked the handful of layouts it knows and hoped one of them matched. That covers every documented layout and nothing else, so a model repository that keeps a build somewhere unusual would download fine from HuggingFace and read as unavailable from a local mirror, with nothing to explain the difference.

The container now writes a small listing of what the mounted folder actually contains, at every start, and serves it next to the weights. There is nothing to configure and nothing to keep up to date: it is generated from the folder itself, so it cannot claim a file that is not there, and it is rewritten each boot, so it cannot go stale. It goes to a temporary folder inside the container rather than into the mount, so mounting the models read-only still works. If it cannot be written the app falls back to the previous behaviour, which is why an instance that upgrades and changes nothing sees no difference at all.

### Fixed: a repo with a second model inside it could break the fp32 download

The optimized model repository carries a complete second model in a subfolder, and the fp32 encoder is not one file but a set of numbered shards. Because both copies use the same shard names, the loader was seeing each shard twice and downloading it twice: about 4.8 GB fetched instead of 2.4, assembled into an encoder that could not load. It now picks one folder and takes only its shards.

The same reorganisation had moved the lighter int8 encoder into that subfolder. The app itself was unaffected, because it asks the repository where its files are rather than assuming, but the script that prepares the test models did assume, so it was fetching a path that no longer exists. It now asks too. Nothing about which models are offered changes; the point is that a repository can rearrange itself without the app losing track of the weights, which is also what keeps the upstream layout usable.

### Fixed: a local mirror could serve one model's weights under another's name

The loader checked a locally-served mirror for a flat set of model files before checking for the requested repo by name. With one model configured that is harmless and is the documented layout. With a choice of models it was not: on a mirror holding one model flat and others in subfolders, every model resolved to the flat one, so selecting the second model loaded the first model's weights under the second model's name. Nothing about that failure was visible, since the wrong model still transcribes fluently. The mirror is now asked for the repo by name first, and the flat layout only answers for a repo it has no subfolder for.


### A smaller ONNX Runtime, about 11 MB off every load

The app now loads ONNX Runtime's newer runtime build, the one whose WebGPU support is written in C++ and suspends the WebAssembly stack through JavaScript Promise Integration, instead of the older build that implements WebGPU in JavaScript and crosses back into it at every step of a model run.

The reason is size, not speed. The new runtime is 16 MB against the old one's 27 MB, and its loader 112 KB against 404 KB, so roughly 11 MB less is fetched on every visit of an app whose main complaint has always been how long it takes to start. On speed the two are a tie: measured on the reference machine with three interleaved runs per side and the runtime verified on every run, the GPU path came out at 13.0 seconds against 13.8, and a three-minute clip on the processor path at 125 seconds against 114. Both differences sit inside the run-to-run spread, so neither is a win to quote.

Browsers that do not implement Promise Integration, which today means everything that is not Chromium-based, keep the old runtime automatically and see no change at all. `?ortep=jsep` in the address bar forces it everywhere for one page load, for support and for measurement.

Nothing about the models, the precisions or the transcripts changes: the full browser test suite passes on the new runtime, and the two runtimes produce the same transcript on the same clip.


### Parallel encoding now asks for twice the cores before it runs

The optional parallel-encoding path runs two extra copies of the encoder in background workers, which is a good deal on a machine with idle cores and a bad one on a machine without them: measured on the reference box it is about 4 % faster when the machine is quiet and about 15 % slower when it is busy, and it costs roughly 1.7 GB of extra memory either way. The gate that decides whether to take that bet was reading the number the browser reports for processor cores, which counts hyperthreads: a report of 8 is either a four-core laptop (no headroom at all, and exactly the case the slowdown describes) or a genuine eight-core desktop, and nothing distinguishes them. The bar is now 12, the first count that cannot be a four-core machine and what the reference box itself reports, and a machine that reports no core count at all is declined rather than assumed adequate. Machines that no longer qualify simply use the ordinary path, which was always the fallback anyway.

### fp16 is back on WebGPU, on the GPUs that can run it

The fp16 encoder was withdrawn in August on the belief that no reachable GPU exposes the `shader-f16` feature its kernels need. A benchmark report sent in from a visitor's laptop (an Intel UHD 630) lists that feature as present, so the belief was wrong: our own development GPU does not expose it, which made the absence look universal.

fp16 is therefore offered again, as a choice rather than as the silent default it used to be. The app asks the GPU whether it supports the feature and only then enables the option; on a GPU that does not, the radio is greyed out with the reason, and a preference brought over from another machine loads fp32 instead of transcribing nothing. That last part is why the gating is strict: without the feature ONNX Runtime builds the fp16 model, runs it, and returns an empty transcript with no error anywhere.

Why bother: on the laptop that produced the report, loading the model cost 74 seconds against 20.6 seconds of actual transcription, and fp16 halves the GPU download (about 1.2 GB instead of the 2.35 GB of sharded fp32) at essentially the same quality. The model source has to host the fp16 file for the option to do anything; a source that does not now says so instead of quietly serving a heavier precision.

### GPU model weights are cached again, when they are small enough to survive it

The sharded fp32 encoder streamed straight into memory and was never written to the browser's cache, so every page load re-downloaded it in full: the 74-second load above was paid on every visit. Caching those shards was tried once before and reverted, because Chromium spills a large stored file to disk and then fails to read it back. That failure depends on the size, so the cache is now size-gated: a streamed file small enough to survive a cache round trip is kept, a larger one behaves exactly as before. Until the model repo ships smaller shards this changes nothing in production, which is what makes it safe to land first.

### The benchmark warms up before timing, and says whether the load was cached

Two things made benchmark numbers harder to compare than they looked. The first timed run of any combination paid for one-off work (memory allocation, kernel setup) that no later run pays, so the first row of a machine's report was systematically pessimistic; there is now an untimed warm-up run per profile whose result is discarded. And a model load time meant nothing on its own, because a load served from cache and a 2.3 GB download are the same measurement with a hundredfold difference. Each row now records how many megabytes it actually pulled and whether the weights were already cached.

### Reports say exactly which build produced them, and no longer carry the minute

A report used to carry only the version number, which several different builds share, so a measurement could not be tied to the code that produced it: the report discussed above came from the last pushed build, not from what was deployed. Reports now carry the exact commit. In the other direction, the timestamp on a report is rounded down to the hour, both in the file and in its name, since the precise minute a visitor pressed Run identifies them a little and answers no question anyone asks of the data.

### A GPU with no memory headroom no longer batches encoder chunks

On the GPU path the app groups several audio chunks into one encoder call when the graphics card reports room for them. The calculation could report no room at all and still be overruled by a floor of two, which is exactly the machine that cannot afford it: an integrated GPU whose whole reported buffer limit is smaller than the encoder itself. A measured zero now means one chunk at a time. Machines where the measurement fails or is unavailable keep the conservative floor, since an unanswered question is not the same as a no.

### The benchmark keeps the machine awake for its whole run

The sidebar benchmark takes minutes, and most of that time is spent loading models between rows rather than transcribing (a 2.3 GB fp32 download easily dominates). The screen wake lock the app already holds while recording or transcribing was only held during the transcriptions, so a laptop left alone to benchmark could dim, then sleep, halfway through a load and hand back a run that never finished. The wake lock is now held from the moment Run is pressed until the run ends, which on every desktop OS also blocks the idle suspend that follows a dark screen. A lid close or a manual sleep still wins, as it should. The end-to-end benchmark test now records the wake lock calls and fails if the lock is requested any later than the first model load or dropped before the report exists.

### The report receiver checks what it stores, and how fast

The endpoint that collects benchmark reports only checked the format string, so any JSON object of the right size was stored and later pulled onto the operator's machine, where tooling reads it and trusts it. It now refuses unknown top-level fields, wrong section types, `__proto__`/`constructor`/`prototype` keys at any depth (prototype pollution the moment a report is merged into another object), nesting deeper than 12, strings over 4 KB and control characters other than tab and newline (an escape sequence in a report becomes a terminal injection once it is printed). A report captured from the real app passes unchanged. On the rate side, the per-IP limit of 3 a minute was the only one, and a caller rotating source addresses could reach the 20000 file cap in minutes and silence the feature for everyone. An instance-wide quota of 30 accepted reports a minute (`BENCHMARK_REPORTS_MAX_PER_MINUTE`) now sits behind it, so the same flood takes eleven hours and is logged on every refusal. Real visitors post one report per several minutes each and never come near either limit. Built and tested with Claude Code.

### A 4-bit encoder, for when the download is the problem

There is a new entry in the encoder precision list: **w4a8**, an encoder whose weights are stored on 4 bits instead of 32. 217 of the encoder's 289 matrix multiplications carry it; the remaining 72 multiply two activations together and have no stored weight to shrink, and the convolutions and normalisations stay in full precision. Activations are quantised to 8 bits inside the kernel at run time, which is where the name comes from.

The point of it is size. The encoder goes from about 2,436 MB to about 638 MB, which is roughly 457 MB once compressed for transfer against 1.55 GB for fp32, and it loads in about 7 to 9 seconds instead of 13 to 16. Accuracy is essentially unchanged: on the French-medical validation sets it measures 4.7 % word error against the fp32 build's 4.6 %, and no calibration data was needed to build it.

What it does not buy is speed, and this is worth stating plainly because the intuition points the other way. Measured against the same model's fp32 encoder on the reference machine, medians of three timed runs on a 90 s profile: about 2.6x real time on the CPU path against fp32's 3.6x, and about 28x on WebGPU against fp32's 42x. The stock model's SmoothQuant int8 is faster still on the CPU path, though this model's own int8 encoder is not, for the reason given in the entry below. A speech encoder consumes roughly a thousand frames in one pass, so each weight is reused across a large matrix multiplication and the work is limited by arithmetic rather than by moving weights from memory. Shrinking the weights therefore shortens the download and the load, and then costs a little throughput to unpack them again in the kernel. That is the opposite of what 4-bit quantisation does for a chatbot generating one token at a time, where memory traffic is the whole bottleneck.

So pick it when download size, storage, or startup time matter more than transcription speed, and leave int8 selected otherwise. Unlike the two int8 builds, it runs on **both** backends: WebGPU has a kernel for these 4-bit multiplications (it unpacks the weights to fp16 in the shader), so it is the first precision other than fp32 the GPU path will actually load. As with int8 lite and fp32, choosing it against a mirror that does not host the file stops the load with a clear message rather than quietly serving a different precision; on WebGPU specifically, a mirror without it falls back to fp32.

Built and measured with Claude Code; the quantiser is `scripts/quantize-nbits.py` and its acceptance gates are in `scripts/check-nbits.py`.

### An int8 encoder for the fine-tuned model, built without a calibration campaign

The fine-tuned French-medical ONNX repo now ships an `int8` encoder alongside its fp32 and `w4a8` ones, so the app's default precision resolves against it instead of falling back. It is built by the same quantiser as the `w4a8` encoder, just at 8 bits instead of 4: the same 217 matrix multiplications, the same 32-wide blocks, the same `accuracy_level=4` that has the kernel quantise activations to 8 bits at run time. The encoder is about 905 MB, between the 4-bit build and fp32.

This is a different recipe from the SmoothQuant int8 the stock model ships, and the difference is where the activation ranges come from. SmoothQuant freezes them ahead of time from a calibration campaign, which is what makes a stock int8 cast degrade on long audio when the real ranges drift away from the calibrated ones. Here the kernel recomputes the range on each run, so there is no calibration set to collect, none to go stale, and the build takes seconds rather than an afternoon.

Accuracy is indistinguishable from fp32 rather than merely close. On the French-medical validation sets it measures 4.60 % word error against the fp32 build's 4.6 % (the `w4a8` encoder measures 4.7 %), and per set the two agree to a tenth of a point or better: 3.6 / 4.5 / 5.0 / 4.1 / 12.8 against fp32's 3.6 / 4.5 / 4.9 / 4.1 / 12.8. The long-audio check that motivates SmoothQuant in the first place comes back clean too: over a single uninterrupted 6.5 minute pass scored in one-minute windows, the int8 encoder's per-section word error matches fp32's in every window, with the worst window falling in the same place at the same value. There is no drift down the table.

As with the 4-bit encoder, what this buys is size and not speed, and that is worth stating because the name suggests otherwise. The stock model's SmoothQuant int8 really is faster than its fp32, because it runs genuinely cheaper int8 matrix-multiply kernels. This one does not: it stores 8-bit weights that the kernel unpacks on the way in, so on the CPU path it measures about 2.5x real time on a 90 second profile against the same model's fp32 at about 2.8x, with the 4-bit encoder last at about 2.4x. Read the three encoders as a download-size ladder (2,435 MB, 905 MB, 638 MB) whose accuracy is flat and whose CPU throughput slowly declines, rather than as a speed ladder. Like the two other quantised encoders, and unlike fp32, it does not run on WebGPU.

Built and measured with Claude Code. The quantiser is `scripts/quantize-nbits.py`, which now takes a `--bits` flag and builds both widths from one code path rather than two near-identical scripts, and its acceptance gates are in `scripts/check-nbits.py`.

### ONNX Runtime engine updated to 1.29

The vendored ONNX Runtime Web engine (the runtime every transcription goes through, on both the CPU/WASM and WebGPU paths) moved from 1.27.0 to 1.29.0, the newest stable npm release. This is a maintenance bump: an interleaved in-browser A/B of the two versions on this project's benchmark clip had already measured them within noise of each other on the WASM path, and the full unit and browser test suites pass unchanged on 1.29. The artifact layout and the pinned-integrity loading path are identical, so nothing changes in what a visitor downloads.

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

### Fixed: nothing could be downloaded after HuggingFace moved its file host

Model files stopped loading on self-hosted instances. HuggingFace now serves the weights of migrated repositories from a different address than the one it used before, and an instance's security policy lists the addresses the browser is allowed to reach: the new one was not on that list, so the browser refused every download before it left the page.

It failed in the most confusing way it could. The app never learns why a blocked request failed, so it did what it does for any failed download and turned to the local copy of the weights, then reported whatever that copy was missing. Every visible symptom pointed at the local mirror, and nothing anywhere named the security policy.

The new addresses are allowed now. There is also a check (`node scripts/check-hf-cdn-hosts.mjs`) that resolves a real download and names any address the list no longer covers, since HuggingFace will move again.

### An instance says at startup when a configured model has no weights behind it

An instance can list several models, and one of them having nothing on the local mirror was invisible: the app simply fetches that model from HuggingFace, so the instance looks healthy and is only slower for whoever picks it. A deploy can therefore ship half the models it was configured with and nothing says a word. Startup now names any configured model the mounted folder cannot serve. It stays a warning, because falling back to HuggingFace is a legitimate way to run.

### Smaller adjustments to the sidebar

The encoder-precision list is now ordered by download size, smallest first, so it reads as a single ramp instead of asking you to compare each line. The recommended choice is still marked as such.

In the benchmark section, a precision you already have was marked as downloaded only for the backend you are running it on, even though a precision is one file that both backends read: choosing the same precision on the other backend looked like a fresh download of several hundred megabytes and is free. The estimate below the list also counted such a precision twice.

The model line no longer carries the `(nemo128)` suffix, which named an internal component and was the same for every model offered.

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
