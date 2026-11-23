# 11.2.0 (2026-09-10)

## The benchmark table fills in as it measures

A benchmark run takes minutes, and the table used to appear only once every combination had finished. Now the whole table is drawn as soon as you press Run: every row it is going to measure is there from the start, marked as waiting, then shows what it is doing while it does it (loading, transcribing), then settles into its number. The plan is visible for the whole run, and a row that has already been measured keeps its result no matter what happens to the rest.

The speed column changed direction. It used to report seconds of work per second of audio, where lower was better; it now reports seconds of audio per second of work, so 5x means five minutes of recording handled in one minute, and bigger is better. That is the way the number is quoted everywhere else, and it was the one column in the table where a smaller value was the good news.

Rows the run cannot honestly measure now say so. A benchmark load no longer accepts a substitute precision: everywhere else in the app, answering a missing file with a file that does exist is a kindness, but in a benchmark it would file another precision's timings under this row's name. Combinations this source cannot serve are dropped from the plan up front, so a run does not spend minutes discovering what the file listing already said.

Written with [Claude Code](https://claude.com/claude-code).

---

## A precision your source lacks now changes the file, not the backend

When the GPU precision you asked for turned out not to be hosted anywhere, the app moved you to the processor. That fallback exists for a good reason (the automatic measurement can put a visitor on the GPU without them ever choosing it, and stranding those visitors on a failed load would be worse), but it answered a missing file by giving up the graphics card, which is rarely what someone who picked the GPU wants.

Now it looks for another precision the GPU can run and this source does host, cheapest download first, and loads that instead. The backend you are on stays the backend you are on, and the notice says which precision was asked for, which one was loaded and roughly how large it is, so a surprise download is a stated one. Only when no GPU precision can be served at all does the old move to the processor happen, with the same notice it always had.

Written with [Claude Code](https://claude.com/claude-code).

---

## Precisions this instance cannot serve are greyed out before you pick them

The encoder precision buttons used to describe what the app knows how to run, not what your instance can actually hand it. On a deployment whose model copy carries fp32, int8 and w4a8 but no fp16, picking fp16 looked perfectly normal, started a load, and ended a minute later on a message explaining that the file was not there and a processor model had been loaded instead. Everything in that message was true and all of it arrived too late.

The app now asks the model source what it holds while the page is still loading, and greys out the precisions that source cannot serve, each one saying why. That matters because three quite different things can rule a precision out and they point at different people: this backend cannot run it at all, this GPU does not report `shader-f16`, or this model source does not host the file. The first is permanent, the second is your hardware and nobody can fix it from here, and the third is a missing file your instance's operator can copy in. Telling a visitor their GPU is at fault for a file nobody mirrored is the one answer that helps no one.

It stays a hint rather than a gate. If the listing cannot be read, or has not answered yet, every precision remains offered exactly as before: a check that is unsure must never take away a choice that would have worked.

Written with [Claude Code](https://claude.com/claude-code).

---

## The settings panel now says what is actually running

Every model control in the panel describes a request: which repository, which backend, which encoder precision the next load will ask for. What the app then loads is allowed to differ, and for good reasons. A precision your source cannot serve falls back. A visitor the performance measurement moved onto the GPU is moved back to the processor when the deployment ships no GPU-runnable encoder. Weights can arrive from the server hosting this app rather than from HuggingFace.

Every one of those was invisible. The radios kept showing the request, so a machine could sit on "WebGPU / fp32" while an int8 processor model did the work, and neither the interface nor the transcript said a word about it.

When a fallback happens, the controls themselves now move: the backend radio already did (it has to, since the retry reads it), and the encoder precision now follows, so the saved settings stop disagreeing with what the panel displays. It only ever corrects the precision of the backend that actually loaded, only while that is still the one selected, and it never touches the repository picker: a model switch you just asked for must not be cancelled behind your back.

A **Currently loaded** line now sits above those controls whenever a model is up, naming the backend, the precision that really mounted and where the weights came from. It appears only once something is loaded and disappears the moment the model is disposed, so it can never describe a model that is no longer there. When what is loaded disagrees with what is selected, the line says so and tells you a reload will apply the selection.

Two things it deliberately does not do. Weights coming from this server rather than HuggingFace are reported but not flagged as a disagreement: they disagree with nothing you chose, and a warning that fires on every load of an offline-capable install is a warning people stop reading. And a load that could not report its precision says nothing about it rather than inventing a mismatch.

Written with [Claude Code](https://claude.com/claude-code).

---

## A blocked network no longer costs you a connect timeout

On the default configuration the app asks HuggingFace for the weights first and only falls back to the copy your own instance serves once that attempt has failed. On a normal network that ordering costs nothing. On one that blackholes outbound traffic instead of refusing it (a hospital or lab firewall, typically) the failure is not a refusal but a stall: the browser waits out its own connect timeout while a perfectly good local copy sits unused, so the progress bar simply sits there for a minute or more before anything starts downloading.

The app now asks the question in the background from the moment the page loads, with a four-second budget of its own, and remembers the answer. If HuggingFace did not answer, the load starts from the copy your own instance serves and skips the doomed attempt entirely. The two speaker-diarization models follow the same answer, since they live in their own repositories with their own HuggingFace-first ordering and were otherwise still paying a connect timeout each, one after the other, on a machine that had already established the site was unreachable.

It only ever reorders two sources that were both going to be tried, and the reorder is reversible: if the local copy cannot serve the model after all, HuggingFace is tried anyway, so a probe wrongly blocked by an extension costs one instant same-origin miss rather than a failed load. An unanswered probe changes nothing at all and the usual HuggingFace-first path runs untouched.

Written with [Claude Code](https://claude.com/claude-code).

---

## No more phantom 404 for phrase lists

An instance serving its own phrase lists can also ship a pre-encoded copy of each one, so visitors' browsers skip the tokenisation work. That copy is only built when the container has the model vocabulary on hand, but the app asked for it unconditionally and every visitor's console collected a 404 for a file that was never going to exist. The list of available lists is now the single source of truth on both counts, so the request is only made when there is something to fetch. Nothing about which lists you see, or how they are applied, changes; the console is just honest again, which matters because a console full of expected errors is a console nobody reads the real errors out of.

Written with [Claude Code](https://claude.com/claude-code).

---

## One click sets up French medical dictation

A new **Mode Dictée Médical** button sits at the top of the settings panel, above everything else. One click configures the whole station: the UltiMed model, the French medical phrase list at its default settings, 30-second chunks instead of 60, the dictation view, auto-copy to the clipboard, a French interface, and the encoder precision that suits each backend (int8 on the processor, fp32 on the GPU, so the choice is already right whichever one this machine ends up on).

Auto-copy is the only setting the preset switches on rather than resetting. It ships off because the system clipboard is readable by other apps and extensions; on a station whose entire workflow is dictate-then-paste into a record, that cost buys back a click on every utterance. It stays an ordinary checkbox in the General section.

The same preset is available as a link: `?mode=med` works, and so do `medecin`, `médecin`, `medical`, `doc`, `doctor` and `ultimed`, in any capitalisation and with or without the accent, because the parameter exists for addresses people type from memory or read out to each other. A `?mode=` value that is none of those means "no opinion" and changes nothing, which matters because this preset, unlike `?model=`, is saved: a link named "medical mode" is a setup instruction, so the machine stays configured after a plain reload. Every setting it touches remains an ordinary control you can change afterwards.

In this mode the processor-vs-GPU measurement also runs when the page loads, rather than waiting for the Load Model click, so the backend is settled before you touch anything. It measures even on a machine whose backend was once picked by hand, unlike the measurement that runs on an ordinary page load: asking for medical mode is asking for the whole station, and the same preset already replaces the model, the window, the view, the interface language and both encoder precisions, every one of which you may equally have set yourself. It still does nothing on a machine with no GPU, and it still measures a given machine only once.

The preset degrades rather than fails. An instance that does not offer the UltiMed model, or does not serve the French medical list, applies everything else and says in the console which piece it skipped, because a medical lexicon over the generic model is far closer to what was asked than refusing the whole thing.

Written with [Claude Code](https://claude.com/claude-code).

---

## A self-hosted diarization model is found where it was put

The two speaker-diarization models are named in the instance's configuration by filename, and that filename is looked up inside the repository named next to it. Written as a full path (`/fallback_models/csukuangfj/.../model.onnx`) it was joined onto the repository prefix whole, so the request could only ever miss.

Nothing failed out loud. A path a mirror does not recognise is answered with the application's own page rather than a refusal, so the miss read as "this mirror does not carry the diarization models" and the download quietly went to HuggingFace instead. On a network that blocks HuggingFace, which is the reason to self-host these files at all, the speaker feature simply stopped working, and the configuration file said something that looked exactly right.

The setting now takes the filename out of whatever was written, so a path, a Windows path, or a stray space all resolve to the file that was meant, and a value naming no file falls back to the built-in default rather than requesting a directory.

Written with [Claude Code](https://claude.com/claude-code).
