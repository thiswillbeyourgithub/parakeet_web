# 11.4.0 (2026-09-30)

## Misheard drug names can be corrected

A new **Correct misheard drug names** setting (General section, switched on by the medical dictation mode, remembered otherwise) adds a **Drugs** view right of **Raw** on every transcript. It rewrites French drug names the model hears as ordinary words ("l'ananas de l'umab" becomes "lanadelumab") with 14,377 rules learned from the drug-name errors of the UltiMed and parakeet-ultra models on every split of the UltiMed drug subset, and it runs before the Dictation regexes. The rules change none of the 602,813 correct labels of that dataset and none of 1,662 French VoxPopuli transcripts. The rules ship with the app, so they work with any model, and they are shipped compiled: 190 KB as served, fetched only once the setting is on, each regex built the first time a transcript contains its word. Indexed by word, they cost about 0.11 ms per transcript (measured in Node on the shipped rules) instead of 19 ms applied one by one, with the same output.

Written with Claude Code.

## Ultra is now the default model

With no model configured, the app, the command-line tools and the Docker image now load [Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx) instead of [Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx). On the full 25-language FLEURS validation split (greedy, int8 encoder) that is 11.57 % macro WER against 13.14 %. Both repositories ship the same layout and the same file sizes, so the download does not change. The reference deployment no longer offers the optimized model; a visitor who had it selected falls back to the new default. The OpenAI-compatible server's default model id follows, from `parakeet-tdt-0.6b-v3-int8` to `parakeet-tdt-0.6b-v3-ultra-int8`.

Written with Claude Code.

## The "int8 lite" precision is gone

The "int8 lite" encoder precision has been removed from the settings, the loader and the tooling: none of the models the app offers ships that build any more, so the choice could only ever end on an "unavailable" banner. A browser that still has int8 lite saved from an earlier visit now loads int8 instead.

Written with Claude Code.

## Two more models: parakeet-ultra and parakeet-redux

The model picker can now offer ONNX exports of [moondream/parakeet-ultra](https://huggingface.co/moondream/parakeet-ultra) and [moondream/parakeet-redux](https://huggingface.co/moondream/parakeet-redux), published as [Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx) and [Olicorne/parakeet-tdt-0.6b-v3-redux-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-redux-onnx), and the reference deployment lists them after the default model and UltiMed (`?model=ultra`, `?model=redux`). The default model is unchanged. Both were published only in the `transformers` format, so they are converted back to NeMo and then built exactly like the default model, every precision included. On the full FLEURS validation split (25 languages, greedy decoding, int8 encoder), the macro WER is 13.14 % for the default model, 11.57 % for Ultra and 12.64 % for Redux. At beam 5 (60 clips per language) Ultra reaches 10.65 % and Redux 11.72 %. On both models int8 costs nothing measurable against fp32 (Ultra 11.55 %, Redux 12.64 %), and both hold up over a single 390 s and 607 s pass. The full tables are in each model repo's README.

Written with Claude Code.

## A 2-bit encoder for models whose weights are ternary

Redux's encoder weights are ternary: every weight in a block of 128 is -a, 0 or +a. Two bits hold that exactly, so a new **w2a8** precision packs it with no loss at all, and its encoder is 190 MB against 643 MB for int8. On the full FLEURS validation split it scores 12.64 % macro WER, the same as Redux int8 and fp32 (the per-language scores differ, the averages agree to 0.003 points), and 5.5 % against 5.4 % for int8 on the long-audio drift test. It runs on both the processor and the graphics-card path, and like every precision it is offered only where the model source actually hosts the file, so it appears for Redux and nowhere else.

Written with Claude Code.

## The transcription engine moved to ONNX Runtime 1.30

The vendored ONNX Runtime Web engine (the runtime every transcription goes through, on both the processor and the graphics-card path) moved from 1.29.0 to 1.30.0, the newest stable release on npm. This is maintenance rather than speed: an interleaved in-browser A/B of 1.30 against 1.29 on this project's benchmark clip had already measured the two within noise of each other on both paths, and 1.30's headline graphics-card work is a set of matrix kernels written in half precision, which a card has to advertise support for before they can run at all. The set of files a visitor downloads, and the integrity check they are verified against on arrival, are unchanged.

Written with Claude Code.

## A refused engine file no longer keeps the runtime in memory

The two engine files are downloaded and checksummed side by side. When one failed its check, the other could finish a moment later and hand the browser a reference to its bytes that nothing ever released, keeping the whole runtime (about 16 MB for the larger half) in memory for as long as the page stayed open. The cleanup now waits for both halves to finish before it runs.

This only ever happened on the way to a load that was being refused anyway, so nobody transcribed anything worse because of it. It is worth recording because it is exactly what the test covering that code was written to prevent, and the test agreed with the code right up until a loaded machine changed the timing.

Written with Claude Code.

## The download progress bar no longer jumps back and forth

On a machine with a graphics card, clicking Load model first runs a short speed test to pick between the processor and the graphics card. That test takes a few seconds, and during it the Load model button stayed on screen and clickable. A second click in that window started a load at once, and the speed test started another one when it finished, so the same model was downloaded twice in parallel. Both downloads reported to the one progress bar, which kept jumping between their two percentages. A second click (or the Space/Enter shortcut) is now ignored while a load request is already under way, so the model is downloaded once.

Written with Claude Code.
