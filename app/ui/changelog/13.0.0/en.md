# 13.0.0 (2026-11-23)

## The experimental redux model was renamed

On the hub, `Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-experimental-onnx` (which already held the UltiMed v2 redux) is now [`Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx`](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx). The old id, and the older `...-redux-UltiMed-onnx`, still resolve to it.

## The medical model is now UltiMed v2

The French medical model is now UltiMed v2, [`Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx`](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx), the model whose errors the v2 drug rules below were mined from. On the hub the previous model was renamed to `Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v1-onnx`. The old ids (`...-ultra-UltiMed-onnx` and the older `...-UltiMed-onnx`) still resolve, to v2: a saved model choice, an old `?model=` link and an operator's `VITE_MODEL_REPO` all keep working, and the entrypoint logs the substitution so the relay allowlists the right repo. `?model=ultra-ultimed` and **Mode Dictée Médical** select v2; to serve v1 on purpose, list its `-v1-onnx` id. A returning UltiMed user downloads the v2 weights once (the browser cache is keyed by repo id), and the v1 files are then dropped from the cache.

## The "Drugs" view now uses the UltiMed v2 rules

The fix rules behind the **Drugs** transcript view now come from the new [UltiMed v2 regex repo](https://github.com/UltiMed-Org/UltiMed-ASR-FR-v2-regex-fixes) (AGPL-3.0-or-later) instead of the v1 model repo: 25,099 rules in six files, mined from the errors of the UltiMed v2 model on the v2 corpus, applied in the order drug names (2,447), dictionary terms (18,261), PARHAF (2,172), PARROT (117), acronyms (43), then the 2,059 hand-written rules last (v1 ran them first). The compiled file shrinks from 23.6 MB to 11.1 MB (about 0.7 MB as served). For operators: `scripts/compile-drug-rules.mjs` now expects the regex repo checked out at `fallback_models/UltiMed-ASR-FR-v2-regex-fixes` (or takes `--repo DIR`).

## The "Drugs" view now has 45,110 rules

The **Drugs** view now ships the final UltiMed v2 rule set: 45,110 rules instead of 25,099, in the same six files and order (drug names 4,145, dictionary terms 36,177, PARHAF 2,502, PARROT 138, acronyms 47, then the 2,101 hand-written rules last). The new rules are the v1 rules respelled to the v2 spellings and the mishearings of two more models of the family, the w4a8 quantisation of UltiMed v2 and the redux fine-tune, so they help most when the app runs one of those models or meets new audio. They still change none of the 602,776 correct labels of the v2 corpus and none of the 1,662 French VoxPopuli transcripts, and rewrite 67 of 100,000 French news sentences (47 before). The compiled file grows from 11.1 MB to 29.1 MB (about 2.0 MB as served instead of 0.7 MB).

## A "Dictation commands" reference, and the dictation templates now work

A new **Dictation commands** link on the main screen (also a button in the settings sidebar) opens a table of what to say in Dictation view to get each line break, punctuation mark, or abbreviation, with the recommended phrase in bold (for example "nouveau tiret" for a list dash, since a bare "tiret" is not understood). The phrases are tried against the rules this instance actually loaded, so the table only lists what really works here.

Building it surfaced a bug: the rule loader split the CSV on newlines before parsing, so the "ajoute la commande ..." templates, whose text spans several lines, never fired, and every line of their text became a stray rule of its own (59 of them with the default Murmure rules, such as one matching " pas de toux"). The templates now load as single rules and all 20 work.
