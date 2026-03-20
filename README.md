# Parakeet Web

Browser-based speech-to-text transcription using NVIDIA's Parakeet TDT model running entirely client-side via ONNX Runtime (WebAssembly / WebGPU).

## Dictation Mode

Parakeet Web includes a **dictation mode** that post-processes transcriptions using regex rules to clean up spoken punctuation, medical vocabulary, and unit abbreviations. This is especially useful for French medical dictation.

The regex rules are sourced from the [Murmure project](https://framagit.org/interhop/murmure) (see the `regex/` folder). All CSV files in that folder are automatically downloaded — when new rule files are added upstream, they are picked up on the next container restart.

Rule categories include:
- **ponctuation** — spoken punctuation to symbols ("virgule" → `,`, "retour à la ligne" → newline, "ouvrez les guillemets" → `"`, etc.)
- **constante** — unit abbreviations ("milligrammes" → `mg`, vital signs formatting)
- **controle** — clinical exam template expansions
- **medicament** — medication name corrections from common speech-to-text errors
- **vocabulaire_medical** — medical vocabulary corrections ("disney" → "dyspnée", "avait ces" → "AVC", etc.)

### How it works

- **Docker**: The entrypoint script queries the [Murmure GitLab API](https://framagit.org/interhop/murmure) to discover all `.csv` files in the `regex/` folder and downloads them on first startup. Falls back to a known file list if the API is unreachable.
- **Local development**: Run `./scripts/download-dictation-regex.sh` to fetch the rules into `app/ui/public/dictation-regex/`.
- **Frontend**: The app loads the CSV rules at startup via a manifest file and applies them as JavaScript `RegExp` replacements. Three display modes are available per transcription: **Raw**, **Confidence** (heatmap), and **Dictation** (regex-cleaned).

---

*This project uses [Claude Code](https://claude.com/claude-code) for development assistance.*
