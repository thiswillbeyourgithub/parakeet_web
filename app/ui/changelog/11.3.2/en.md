# 11.3.2 (2026-09-11)

## A graphics card now downloads half as much by default

A visitor whose machine is measured onto its graphics card used to be given the full-precision encoder, around 2.4 GB, delivered in pieces because no single file that size can be held. The half-precision encoder is around 1.2 GB, arrives as one file, and is near-lossless next to it. It exists in the model repositories precisely so it can be used, and it is now what a visitor gets before they have chosen anything.

Two things can rule it out, and neither one now reaches for the full-precision encoder instead: a graphics adapter that does not report the half-precision shader feature (most do not, including the one this project is developed on), and a model server that does not host the file. Either way the visitor is moved to the processor engine at int8, which is a 900 MB download rather than a 2.4 GB one, and which is the one substitution the app is willing to make on somebody's behalf. Neither costs a failed load, because both are known before any weight is fetched, and neither rewrites the preference: the same browser moved to a machine that can run it gets its graphics card back.

Nothing changes on the processor engine, which stays on int8: half precision has no usable engine there and is expanded back to full precision when the model is built, so it would cost memory and buy nothing.

Written with Claude Code.

## One fallback, and a plain message when it runs out

The app now substitutes exactly one thing on its own: the processor engine at int8. The full-precision encoder (around 2.4 GB) and the 4-bit one are loaded only when you ask for them by hand. Nothing reaches for them on your behalf, because one nearly triples a download nobody requested and the other is the weakest encoder on long audio, and neither is a decision to make for somebody who picked nothing.

The consequence is that changing engine is now allowed where it was not. A graphics card with nothing it can run is taken to the processor rather than left on a failed load, and it says so.

And when the processor engine at int8 cannot be loaded either, the app now stops with a popup that covers the page, the same one a phone gets, instead of the word "Failed" in a status line under a page that still looks ready to use. By then there is nothing in the settings left to change: it means the model server this instance points at did not deliver the standard encoder. So the message says that, and says who can fix it.

Written with Claude Code.

## Medical dictation mode follows the same default

The medical dictation preset pinned the full-precision encoder on a graphics card, deliberately, back when asking for the half-precision one could fail a load and move a station to its processor for good. Neither of those failures can happen any more: an adapter that cannot run it falls back before anything is downloaded, and a model server that does not host it is forgiven the moment it does. So the preset now asks for the same half-precision encoder as everywhere else, which is the setting it should have had: a dictation station reloads all day, often on a network chosen for being locked down, and this halves what it fetches.

Worth knowing if you have ever changed the precision by hand on such a machine: a medical mode link replaces it. That is the intent, not a side effect. The link sets up the whole station, and a station switched to the 2.4 GB encoder by hand months ago was still fetching it on every visit while every other part of the preset looked correctly applied.

Written with Claude Code.
