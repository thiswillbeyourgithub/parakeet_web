# Compiled drug-name and medical-term fix rules

- File: `drug_rules.json`, compiled by `scripts/compile-drug-rules.mjs` from `regex-fixes/drug_fix_rules.jsonl` then `regex-fixes/term_fix_rules.jsonl`, in that order (3,428 + 25,045 = 28,473 rules at the last refresh)
- Source: https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx/tree/main/regex-fixes. The path, commit and SHA-256 of each source file are recorded in `drug_rules.json` itself (`sources`), so they cannot drift from the bytes.
- License: CC BY 4.0, drug names from French open data (Licence Ouverte / Etalab 2.0: OPEN_MEDIC, RETROCEDAM, BDPM), medical terms drawn from public French sources (terms only, no definitions). See the "Licence and attribution" section of the model repo README.
- How the rules are built: [08_drug_asr_rules](https://github.com/thiswillbeyourgithub/UltiMed-ASR-FR-v1-scripts/tree/public/08_drug_asr_rules)

Shipped with the app on purpose rather than fetched from whichever model is loaded: the rules fix drug names and medical terms the way French speech mishears them, so they are useful whatever Parakeet model the visitor runs, and the app must not lose the feature when an operator serves a model repo that does not ship the file.

The compiled form keeps only `[pattern, replacement]` per rule plus a prebuilt anchor index (see `app/ui/src/lib/drugRules.js`): 17.4 MB of source becomes 13.5 MB, and about 1 MB as the brotli sidecar the Docker build generates.

To refresh, from the repo root, with the model repo checked out under `fallback_models/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx/`:

```bash
node scripts/compile-drug-rules.mjs          # rewrite drug_rules.json, then commit it
node scripts/compile-drug-rules.mjs --check  # what deploy.sh runs: fails when out of sync
```
