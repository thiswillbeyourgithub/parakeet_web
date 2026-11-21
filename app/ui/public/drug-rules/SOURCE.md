# Compiled drug-name and medical-term fix rules

- File: `drug_rules.json`, compiled by `scripts/compile-drug-rules.mjs` from the six rule files of the UltiMed v2 regex repo, in this order (25,099 rules at the last refresh, regex repo commit `474d172`):
  1. `rules/drug_fix_rules.jsonl`: drug names (2,447 rules)
  2. `rules/dictionary_fix_rules.jsonl`: medical terms, dictionary subset (18,261 rules)
  3. `rules/parhaf_fix_rules.jsonl`: medical terms, PARHAF subset (2,172 rules)
  4. `rules/parrot_fix_rules.jsonl`: medical terms, PARROT subset (117 rules)
  5. `rules/acronyms_fix_rules.jsonl`: medical terms, acronyms subset (43 rules)
  6. `rules/manual_fix_rules.jsonl`: hand-written fixes and decisions, e.g. `scanner lodose` -> `scanner low-dose` (2,059 rules), LAST so they get the final word (v1 ran them first)
- Source: https://github.com/UltiMed-Org/UltiMed-ASR-FR-v2-regex-fixes (`rules/`; its `rules/confusion_groups.jsonl` is not a rule file and is not compiled). The URL, commit and SHA-256 of each source file are recorded in `drug_rules.json` itself (`sources`), so they cannot drift from the bytes.
- License: AGPL-3.0-or-later, like everything in that repo. The v1 rules this file used to ship came from the model repo under CC BY 4.0; the v2 repo is the same author's relicensed continuation.
- How the rules are built: the regex repo's [scripts/](https://github.com/UltiMed-Org/UltiMed-ASR-FR-v2-regex-fixes/tree/main/scripts), mined from the errors of the UltiMed v2 model on the v2 UltiMed corpus.

Shipped with the app on purpose rather than fetched from whichever model is loaded: the rules fix drug names and medical terms the way French speech mishears them, so they are useful whatever Parakeet model the visitor runs, and the app must not lose the feature when an operator serves a model repo that does not ship the files.

The compiled form keeps only `[pattern, replacement]` per rule plus a prebuilt anchor index (see `app/ui/src/lib/drugRules.js`): 13.2 MB of source becomes 11.1 MB, and about 0.7 MB as the brotli sidecar the Docker build generates.

To refresh, from the repo root, with the regex repo checked out under `fallback_models/UltiMed-ASR-FR-v2-regex-fixes/` (or pass `--repo DIR` to point at a checkout elsewhere):

```bash
node scripts/compile-drug-rules.mjs          # rewrite drug_rules.json, then commit it
node scripts/compile-drug-rules.mjs --check  # what deploy.sh runs: when out of sync it asks whether to deploy anyway (default no)
```

`--check` also fails (`source not found`) when the regex repo is not checked out, so deploy.sh asks in that case too.
