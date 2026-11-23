# 11.3.1 (2026-09-11)

## A newly published model precision now actually shows up

An operator who adds an encoder to their model server (fp16, say) publishes the file and expects it to appear. It did not, for up to a day, and the way it failed was worse than not appearing at all: the precision was listed as "not hosted by this model source", and a load that asked for it on the GPU reported that this deployment could not serve it and moved the browser to the processor, permanently, remembering the decision.

The cause was a caching rule. The server described its own model directory in a small file next to the weights, and that file was being cached for a day alongside the weights themselves, which do not change. So a returning visitor kept a description written before the new encoder existed and never asked for a fresh one. Opening the same site in a private window, with nothing cached, showed it working, which is a good way to lose an afternoon.

That file is now revalidated on every load, from both ends: the server stops asking browsers to hold it, and the app stops accepting a held copy. Anyone whose browser has already moved them to the processor over this is moved back on their next visit, because the app now drops that decision as soon as the server offers the precision again.

The same freshness rule now covers the file listing read from Hugging Face, for the same reason: it decides which precisions the app believes exist.

Written with Claude Code.

## The precision list describes your deployment, not the app

The encoder precision list used to show every precision the app knows about, greying out the ones that could not be used with a short reason. Two of those reasons were not worth a line. A precision the selected engine has no support for was never a choice, and showing fp16 greyed out under the processor engine read as a missing file rather than as an engine that has no use for it. A precision the model server does not host belongs to somebody else's deployment.

Both are now simply absent. What remains is the case where the file is there, the engine supports it, and your own graphics adapter cannot run it: that row stays, greyed, and says so, because your hardware is the only thing that decided it and hiding it would leave two machines showing different lists with no explanation.

The practical effect is that the list follows whatever a model repository actually ships, so serving a different set of ONNX files is a matter of publishing them.

Written with Claude Code.

## Measuring your machine is remembered, unless the model set changed

The one-off measurement that picks between the processor and the graphics card is stored so it does not run again on every visit, and it was already keyed to the app version and the adapter it was measured on. It was not keyed to what the model server could serve, which is the thing the answer is used for. A machine measured against a deployment that could offer its graphics card nothing was moved to the processor and stayed there for the full ninety days, even after the missing encoder was published.

The stored answer now records what was on offer at the time, and a change re-measures once. A deployment that publishes no description of itself is unchanged: with nothing to compare, the stored answer is kept rather than re-measured on every load.

Written with Claude Code.
