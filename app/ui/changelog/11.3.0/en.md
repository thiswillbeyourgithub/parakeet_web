# 11.3.0 (2026-09-10)

## The fp32 encoder stops downloading itself in full every time

The full precision encoder is about 2.4 GB, shipped as two files, and until now every page load fetched all of it again. Nothing was kept, because three attempts at keeping it had each failed in a way that looked like a different problem: one large record per file, then a size limit that turned out to exclude both files, then many small records.

They were one problem. A browser will accept far more than 2.4 GB into its storage, report it as stored, and then refuse to read it back once what it holds passes about 2.1 GB. Measured here: 2.42 GB written as 72 records of 32 MB was reported as 2.42 GB against a 10.74 GB allowance, and after a reload the first 63 records read while the last 9 threw. 63 records of 32 MB is 2,147,483,648 bytes, or 2 to the 31st, and the record size makes no difference to where the line falls.

So the file cannot be kept, but part of it can. A load now keeps 1.5 GB of the set and asks the server only for the rest, resuming from the cached part exactly the way a download interrupted halfway already did. Against the two files the model repo ships that means the first (1.48 GB) comes out of storage and the second (952 MB) comes over the network. Measured end to end in a browser: 2454 MB transferred on the first load, 952 MB on every load after it.

Reading 1.5 GB back out of browser storage was measured at 344 MB/s, about 4.4 seconds. That is a little slower than re-fetching the same bytes from a server on the same machine, and far faster than any real connection, which is the case this is for.

fp16 (1.2 GB) was never affected and is unchanged: it fits under the ceiling and has always been cached whole.

Written with Claude Code.

## The status line says whether it is downloading or loading

"Loading model" was shown for all three phases of a model load: looking in the cache, pulling whatever is missing over the network, and building the inference sessions. That is fine for a warm start measured in seconds and useless for the case it actually matters in. At the time, the fp32 encoder was re-downloaded in full on every load (the entry above explains why, and stops it), and a status line reading "Loading model" for nine minutes gives no way to tell a slow connection from a slow machine.

There is now a separate "Downloading model" phase. It appears on the first byte that actually crosses the network, not at the start of the load, so a start answered entirely from cache never claims a download it did not make.

Every load also writes one line to the browser console accounting for itself, for example `[Load] ready in 9m12s: fetch 9m04s (2331 MB), sessions 8.1s`. Only the total existed before, as the benchmark's Load column, which meant a report of a very long load could not be attributed without running it again, even though a connection and a graphics driver compiling shaders have nothing to do with each other. A load that pulled nothing says `cached`, and one whose byte count is unknown says so rather than borrowing the word.

Written with Claude Code.

## The encoder precision list says less, and says it right

The five entries in the sidebar's encoder precision picker still described themselves in the vocabulary of the two-option era, when the choice was int8 or fp32 and smaller really did mean faster. With five precisions on the list that reading is now wrong, and the labels had drifted besides: fp32 announced itself as "2x slower" where the measurement on the reference machine is about 35 % on the CPU path.

Each label is now the same short shape, a size and one distinguishing note, and the ordering is stated once above them rather than re-argued in every row: smallest download first, and size does not predict speed. That last clause is the point of the line. The smallest entry, w4a8, is also the slowest to run and the weakest on long audio, because a speech encoder reuses each weight across a thousand frames and is limited by arithmetic rather than by moving weights from memory. Read the column as a download ladder, not a speed one. int8 stays the recommendation and now says so in bold.

Written with Claude Code.

## Keeping the audio a transcription was made from

Every entry in the history already holds the audio it was transcribed from: that is what the inline player plays and what "Transcribe again" re-runs. There was simply no way to get it back out of the browser. The entry's ⋮ menu now offers it, alongside the other actions that need that audio, and disappears on entries restored after a reload for the same reason those do: the audio only ever lives in the tab, never on disk.

What you get is the 16 kHz mono WAV the model actually heard, not the file you uploaded, so `notes.mp3` saves as `notes.wav`. That is the useful copy when you want to hear what the model heard, or feed the same audio somewhere else, and the menu says so before you click.

Written with [Claude Code](https://claude.com/claude-code).

---

## A dictation link stops freezing the page while it opens

Opening the app with the medical dictation link put the whole page to sleep for a moment, and the first thing anyone clicks (the settings panel) did nothing until it woke up. On a phone it lasted long enough to look broken.

The medical lexicon is 77,000 phrases, and deployments that pre-encode it ship a 37 MB companion file so no visitor's browser has to do that work. Reading that file was the freeze: it was being unpacked on the same thread that draws the page and answers clicks. It now happens on a background thread, which is where the rest of the phrase-list work already ran.

Measured on the real lexicon, on a machine slowed six-fold to stand in for a phone: the single frozen stretch went from 2.7 seconds to 0.2, and total time the page spent unable to answer a click during the first twenty seconds went from 3.3 seconds to 0.8.

Written with [Claude Code](https://claude.com/claude-code).

---

## The upload button fits on one line in French

"Envoyer un fichier audio" was wider than the space the three capture buttons share, so in French it alone wrapped onto a second line and made the row taller than it needed to be. The folder icon already says "file", so the label is now just "Fichier audio", and the verb it dropped moved to the tooltip.

Written with [Claude Code](https://claude.com/claude-code).
