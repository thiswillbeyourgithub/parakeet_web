# Vendored drug-name fix rules

- File: `drug_fix_rules.jsonl` (9,807 rules, one JSON object per line)
- Source: https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx, commit `fc495c7e17c5eabac290c9d93957ffe7f0d968dc` (2026-09-30)
- SHA-256: `4a850efeed558d5dc377ebb492d6f67c464190f72699df517b81adf648784c24`
- License: CC BY 4.0, drug names from French open data (Licence Ouverte / Etalab 2.0: OPEN_MEDIC, RETROCEDAM, BDPM). See the "Licence and attribution" section of the model repo README.
- How the rules are built: [08_drug_asr_rules](https://github.com/thiswillbeyourgithub/UltiMed-ASR-FR-v1-scripts/tree/public/08_drug_asr_rules)

Copied here on purpose rather than fetched from whichever model is loaded: the rules fix drug names the way French speech mishears them, so they are useful whatever Parakeet model the visitor runs, and the app must not lose the feature when an operator serves a model repo that does not ship the file.

Each rule is `{pattern, replacement, variant, drug, ...}`. The app compiles `pattern` with the `giu` flags and applies the rules top to bottom through an anchor index (see `app/ui/src/lib/drugRules.js`).

To refresh: copy `drug_fix_rules.jsonl` from the model repo over this one, and update the commit and SHA-256 above.
