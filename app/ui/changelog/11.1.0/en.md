# 11.1.0 (2026-09-09)

## Numbers dictated as words now come out as digits

Say "twenty-five milligrams" and the transcript reads "25 milligrams". The conversion covers cardinal numbers in English and French, including the compounds French builds by juxtaposition ("quatre-vingt-dix-sept"), whether the model spells them with hyphens or without. It is on by default, with a switch in the settings, and it applies to the word timestamps as well as the text, so the speaker view and the plain view always show the same digits.

Decimals are included, with a dot in both languages: "one point five" becomes "1.5", "un virgule trente" becomes "1.30", and the part after the separator is read group by group so "deux virgule zéro cinq" comes out as 2.05 rather than 2.5. The separator only counts as one between two numbers, so "the point is" and a "virgule" dictated as punctuation are left alone.

It is deliberately literal rather than clever, because guessing at meaning is how this kind of feature ruins a transcript. A run of number words only converts if it spells one grammatical number, so "two two" stays "2 2" instead of quietly becoming 4. Words that are numbers only some of the time never convert on their own: English "one" and French "un" and "une" stay as they are unless they are part of a number, which is why "one of them" survives while "twenty-one" and "un virgule trente" do not. Ordinals are left alone entirely.

The one case worth knowing about is years. "Nineteen eighty-four" is two numbers that cannot be combined into one, so it comes out as "19 84". Reading that as a year needs an understanding of the sentence that this does not have, and dictating years is a good reason to turn the setting off.

## Copy is where you are reading

The per-entry Copy button used to live in the ⋮ menu, one click away from the text it copies. It now sits with the view buttons (Raw, Dictation, Speakers) and copies the entry exactly as those buttons render it, speaker labels and dictation cleanup included. The menu keeps "Copy dictation", which copies something the buttons cannot show: the cleaned text while the entry is displayed raw.

## Phones and tablets are told this is a desktop app

The app downloads several hundred megabytes of weights and runs the model on the device itself. A phone rarely has the memory headroom or the sustained speed for that, and a mobile browser suspends a tab that goes to the background, which interrupts a transcription in progress. Visitors on a phone or tablet now get that warning before anything is downloaded, rather than discovering it partway through.

The same devices get a second explanation on Phone Mic, because there the feature makes no sense: it exists to give a computer with no microphone one, by pairing it with a second device. Someone already holding a phone should use the Record button, and the popup says so before it pairs anything.

## Fixed: keyboard shortcuts no longer swallow the browser's own

The optional single-key shortcuts ignored modifiers, so with them enabled Ctrl+R, Ctrl+S, Ctrl+F and Cmd+R were intercepted: reload, save and find stopped working and pressed record or opened settings instead. Any Ctrl, Cmd or Alt combination is now left to the browser. A focused dropdown also keeps its own keys, where typing a letter used to close the settings panel instead of jumping to a matching option.

The shortcut list in the settings was wrong in the other direction: it advertised an "L" for loading the model, which had been replaced by Space and Enter some time ago, and never mentioned "P" for pausing a recording. It now lists exactly what the app does.
