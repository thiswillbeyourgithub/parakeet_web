# parakeet OpenAI-like transcription API

An HTTP server that speaks the **OpenAI audio-transcription API** (and the whisper.cpp / whisper-asr-webservice dialects of it) in front of this repo's Parakeet TDT ONNX pipeline.

Anything that already talks to `POST /v1/audio/transcriptions` (the OpenAI SDKs, Open WebUI, Obsidian/Logseq plugins, `whisper.cpp`'s client, home-grown curl scripts) can point at it and get transcripts from a locally hosted Parakeet model instead of sending audio to a third party.

It reuses the very same code the CLI (`scripts/transcribe.mjs`) and the browser app run: the model loader, the chunker, the MAES beam decoder, the phrase-boost trie and the speaker-assignment helper are imported, not reimplemented. A transcript from this server is byte-identical to the CLI's for the same options.

Default port: **8002**.

Built with Claude Code.

---

## Table of contents

- [Quick start (docker compose)](#quick-start-docker-compose)
- [Quick start (no docker)](#quick-start-no-docker)
- [Getting the weights](#getting-the-weights)
- [Endpoints](#endpoints)
- [Request fields](#request-fields)
- [Response formats](#response-formats)
- [Phrase boosting and wordlists](#phrase-boosting-and-wordlists)
- [Speaker diarization](#speaker-diarization)
- [Backends and precision](#backends-and-precision)
- [Auth and exposure](#auth-and-exposure)
- [Concurrency, limits and timeouts](#concurrency-limits-and-timeouts)
- [Configuration reference](#configuration-reference)
- [Client examples](#client-examples)
- [Troubleshooting](#troubleshooting)
- [Tests](#tests)
- [Files](#files)

---

## Quick start (docker compose)

```bash
cd scripts/openai-like-server
cp env.example .env
# edit .env: MODEL_DIR is the only mandatory value
hf download Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx --local-dir ./models
sudo docker compose up -d --build

curl -sS -F file=@../../test/fixtures/jfk.mp3 \
     http://127.0.0.1:8002/v1/audio/transcriptions
# {"text":"And so my fellow Americans, ask not what your country can do for you..."}
```

The compose file builds from the **repo root** (it needs `app/src`, the vendored ONNX Runtime and the tokenizer), publishes the port on `127.0.0.1` only, and mounts your weights read-only.

## Quick start (no docker)

The default backend needs **no npm install at all**: it uses the ONNX Runtime already vendored in this repo, so Node 20+ and `ffmpeg` on `PATH` are the whole dependency list.

```bash
node scripts/openai-like-server/server.mjs --model-dir ./fallback_models
node scripts/openai-like-server/server.mjs --help     # every flag, env var and default
```

`--ort node` and `--ort cuda` (see [Backends and precision](#backends-and-precision)) additionally need `npm ci` inside `scripts/openai-like-server/`, which installs `onnxruntime-node`.

## Getting the weights

There is **no runtime download**. A missing or incomplete model directory is a fatal boot error that names the missing file, because a server that silently downloads 600 MB on its first request is a worse surprise than one that refuses to start.

```bash
hf download Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx --local-dir ./models
```

The directory must contain, for the precision you asked for:

| File | Selected by |
| --- | --- |
| `encoder-model.int8.onnx` / `.fp16.onnx` / `encoder-model.onnx` | `--quant int8\|fp16\|fp32` |
| `decoder_joint-model.int8.onnx` / … | `--decoder-quant` |
| `vocab.txt` | always |
| `model.onnx` (pyannote segmentation) | only with `--diarize` |
| `*campplus*.onnx` (CAM++ embeddings) | only with `--diarize` |

`--model-dir` also accepts a path to one of the `.onnx` files and uses its directory, so `-m /models/encoder-model.int8.onnx` works the way whisper.cpp's `-m` does.

---

## Endpoints

All routes sit under `--request-path` (empty by default).

| Method + path | Purpose |
| --- | --- |
| `POST /v1/audio/transcriptions` | The endpoint. `multipart/form-data`. |
| `POST /inference` | whisper.cpp-style alias of the above (`--inference-path`, `""` disables it). |
| `POST /v1/audio/translations` | Always **501**. Parakeet has no translation head; nothing is silently transcribed instead. |
| `POST /load` | Always **501**. The model is fixed at launch (`--model-dir`/`--quant`/`--ort`); restart to change it. |
| `GET /v1/models` | The one served model, OpenAI-shaped, plus a `parakeet` block (quant, backend, wordlists, diarization availability). |
| `GET /health` | Liveness, uptime and queue depth. **Not authenticated**, so an orchestrator probe needs no secret; model details are added only for an authenticated caller. |

The audio part may be named `file` (OpenAI, whisper.cpp), `audio_file` (whisper-asr-webservice) or `audio`.

Errors use the OpenAI envelope, always:

```json
{"error":{"message":"unknown wordlist \"nope\". Available: french_medical, lorn","type":"invalid_request_error","param":"phrase_boost","code":null}}
```

| Status | When |
| --- | --- |
| 400 | Malformed request, unknown field, bad value, unknown wordlist, undecodable audio. |
| 401 | `--api-key` is set and the request has no/wrong key. |
| 404 / 405 | Unknown path / wrong method on a real path (the 404 lists the real routes). |
| 413 | Body over `--max-upload-mb`. |
| 429 | Queue full (`--max-queue`), with `Retry-After`. |
| 501 | Translation, `/load`, `stream=true`, or a rejected whisper flag (see below). |
| 504 | `--request-timeout` elapsed, queue wait included. |

## Request fields

**Honoured** (OpenAI): `file`, `model` (echoed, never enforced, so a client hard-coding `whisper-1` works), `language`, `prompt`, `temperature`, `response_format`, `timestamp_granularities[]`.

**Honoured** (this pipeline's knobs, all optional): `beam_size`, `chunking`, `chunk_duration`, `overlap`, `snap_to_silence`, `phrase_boost`, `boost_strength`, `diarize`, `num_speakers`, `diarize_threshold`, `min_duration_on`, `min_duration_off`, `max_segment_chars`, `segment_gap`. Every one of them is also a launch flag; `--help` marks the overridable ones with `[field]`, and `--lock-params` turns all per-request overrides into 400s so one instance provably produces one kind of transcript.

**Aliases** for other servers' spellings: `initial_prompt` and `hotwords` → `prompt`, `beam_width` → `beam_size`, `output` → `response_format`, `word_timestamps=true` → `timestamp_granularities=word`, `task=transcribe` (accepted; `translate` is a 501), `min_speakers`/`max_speakers` (only an exact `min == max` becomes `num_speakers`).

**Accepted and ignored** with a warning in the log, because they cannot change our output: `temperature_inc`, `encode`, `vad_filter`, `suppress_tokens`, `condition_on_previous_text`, `compression_ratio_threshold`, `logprob_threshold`, `no_speech_threshold`.

**Rejected** with a 501 that says why and what to use instead, because honouring them is impossible and ignoring them would return a transcript that is not what was asked for: `stream=true`, `best_of`, `max_len`, `offset_t`, `duration`, `split_on_word`, `max_context`, `tinydiarize`, `suppress_nst`, `dtw`. `--ignore-unsupported` downgrades the whole group to warnings for drop-in use with a client that always sends them.

Anything else is a 400 listing the accepted fields: an unknown field is a typo (`beam_wdith`) far more often than it is forward compatibility.

The equivalent whisper.cpp **CLI flags** are handled the same way at launch (`--convert`, `-p`, `-fa`, `-ng`, `-nt`, `-debug` are accepted no-ops; `-tr`, `-ot`, `-d`, `-ml`, `-sow`, `-bo`, `-mc`, `-tdrz`, `--dtw`, `--public` are rejected). See the bottom of `--help`.

## Response formats

`response_format` = `json` (default) | `text` | `srt` | `vtt` | `verbose_json`.

Words come out of the TDT decoder with per-word times; segments are built from them by breaking on a pause longer than `--segment-gap`, on sentence-final punctuation, on a speaker change, and softly at `--max-segment-chars`.

`verbose_json` mirrors whisper's shape. Three fields are honest constants rather than invented numbers:

| Field | Value here |
| --- | --- |
| `text`, `duration`, `segments[]`, `words[]` | Real. |
| `language` | Whatever `--language`/`language` says, else `"unknown"`. Parakeet-tdt v3 detects the language itself and cannot be *forced*, so this field is an echo, not a control. |
| `segments[].avg_logprob` | `log(mean word confidence)`, or `null` if confidences were not computed. **At `--temperature 0` (the default) every confidence is exactly 1.0, so this is 0.** Set `--temperature 0.3`-`0.5` for meaningful numbers; it does not change the transcript (greedy argmax is scale-invariant), only the reported confidences. |
| `segments[].compression_ratio` | The real gzip ratio of the segment text. |
| `segments[].tokens` | Always `[]`. Parakeet's BPE ids are not whisper token ids, and emitting them under a whisper field name would be worse than empty. |
| `segments[].seek`, `no_speech_prob` | Always `0`. There is no seek cursor and no no-speech head. |
| `words[].confidence`, `speaker` | Extensions (OpenAI emits only `word`/`start`/`end`). |
| `speakers` | Extension: speaker count, present only when diarization ran. |

`srt`/`vtt` always use segment timestamps. `text` returns the plain transcript, or one line per speaker turn when diarizing.

## Phrase boosting and wordlists

Parakeet has no text conditioning, so an OpenAI `prompt` cannot bias it the way whisper's does. What this pipeline has instead is **phrase boosting** (a trie over the decoder's output), and the `prompt` field is wired to it: `prompt=venlafaxine:10,duloxetine:8` boosts those phrases.

For anything bigger, put lists in `--wordlist-dir` and select them by basename:

```bash
curl -F file=@consult.ogg -F phrase_boost=french_medical \
     -F boost_strength=1.5 http://127.0.0.1:8002/v1/audio/transcriptions
```

- `.txt` (one `phrase:WEIGHT:MINP:FLAG` per line) and `.pwc` (precompiled by `scripts/compile-boost.mjs`) are both accepted; a `.pwc` wins over a same-named `.txt` and loads far faster.
- The list named by `--wordlist` applies when a request names none; `phrase_boost=` (empty) turns it off for that request.
- Tries are cached, so a repeated list costs nothing after the first request. `--boost-strength`/`boost_strength` and `--boost-minp` are applied at decode time (no rebuild); `--depth-scaling` is baked into the trie, so overriding it per request rebuilds the list.
- The directory is snapshotted at boot and requests select by basename only, so a crafted `phrase_boost` cannot escape it.

## Speaker diarization

An **extension**, not part of the OpenAI API: `diarize=true` adds a `speaker` integer to `verbose_json` words/segments, `[Speaker N]` prefixes in `srt`/`vtt`/`text`, and a `speakers` count.

It runs the same vendored sherpa-onnx engine (pyannote segmentation + CAM++ embeddings) the browser app uses, so labels match. Two extra models are needed in the model directory:

```bash
hf download csukuangfj/sherpa-onnx-pyannote-segmentation-3-0   # model.onnx
hf download csukuangfj/speaker-embedding-models                # *campplus*.onnx
```

Point `--diarize-seg-model`/`--diarize-emb-model` elsewhere if you keep them apart. With `--diarize` they are checked at boot; without it, they are checked on the first `diarize=true` request and their absence is a 400 that names them.

Diarization is the dominant cost on long audio, so it never runs unless asked. `--num-speakers` pins an exact count; the default `-1` clusters with `--diarize-threshold` (lower = more speakers).

## Backends and precision

`--ort` picks the ONNX Runtime, and it constrains which precision can load:

| `--ort` | Needs | Precisions | Notes |
| --- | --- | --- | --- |
| `wasm` (default) | nothing | **int8 only** | The ONNX Runtime vendored in this repo, byte-identical to what the browser app runs. |
| `node` | `npm ci` here | int8, fp16, fp32 | Native CPU EP, faster than WASM. |
| `cuda` | `npm ci` + host CUDA 12 + cuDNN 9 | int8, fp16, fp32 | Native CUDA EP. |

int8 here is **SmoothQuant** int8, which tracks fp16 quality on long audio (10.89% vs 10.17% WER on this repo's benchmark), so the default is not a quality compromise.

Why fp16/fp32 cannot use `wasm`: a single ArrayBuffer caps at ~2 GB in 32-bit WASM, and the CPU/WASM EP has no fp16 kernels so it upcasts fp16 to fp32 at session build, doubling memory. Asking for it is a fatal boot error, not a silent downgrade to int8.

**GPU recipe:** build with `ORT_NODE_VARIANT=cuda` (adds ~273 MB), set `RUNTIME_BASE` to an image carrying Node 22 + CUDA 12 + cuDNN 9, set `PARAKEET_ORT=cuda`, and uncomment the `deploy.resources.reservations.devices` block at the bottom of `docker-compose.yml`. Raise `MEMORY_LIMIT` before switching precision: int8 needs ~1.5-2 GB resident, fp16 ~3 GB, fp32 ~5 GB.

## Auth and exposure

`--api-key` / `PARAKEET_API_KEY` is a bearer token checked on every route except `/health`, in constant time, and accepted as either `Authorization: Bearer <key>` or `api-key: <key>`.

**An empty key disables auth entirely**, which is the sane default for a personal instance on `127.0.0.1`. To keep that from becoming an accident, the server **refuses to start keyless on a non-loopback address**:

```
refusing to listen on the non-loopback address 0.0.0.0 without an API key. Pick one:
  * set --api-key / PARAKEET_API_KEY (openssl rand -hex 32)   <- do this if the port is reachable
  * bind 127.0.0.1 and put a reverse proxy in front
  * set --allow-keyless-non-loopback / PARAKEET_ALLOW_KEYLESS_NON_LOOPBACK=true if something
    else already limits reachability
```

A container must bind `0.0.0.0` for a published port to reach it, so the shipped compose file publishes to `127.0.0.1:8002` only and you opt in with `PARAKEET_ALLOW_KEYLESS_NON_LOOPBACK=true`. The moment you publish that port on a real interface, set a key instead (and put TLS in front: this server speaks plain HTTP).

CORS is off unless `--allowed-origins` lists exact origins (or `*`): the API is normally called server-to-server, and a permissive default would let any page in a user's browser spend the server's CPU.

The access log is one line per request and **never contains the transcript or the key**: this server may run on recordings its operator is not allowed to keep copies of, and a log file is a copy.

## Concurrency, limits and timeouts

One model instance, one job at a time, strict FIFO. Parakeet saturates the CPU on its own, so a second concurrent decode would make both slower rather than serve two users faster.

- `--max-queue` (8): how many requests may *wait*. Beyond it: 429 + `Retry-After`. `0` rejects any overlap.
- `--request-timeout` (1800 s): the deadline including queue wait. A request still *waiting* is dropped cleanly; one already decoding cannot be cancelled, so the 504 says so and the work finishes server-side.
- `--max-upload-mb` (100): bodies above it get a 413 from the `Content-Length` where possible, and from a running byte counter otherwise, so a chunked upload cannot bypass the cap.
- Uploads land in a private directory under `/tmp` (a tmpfs in the container), under a random name, and are unlinked immediately.

## Configuration reference

Every knob is a CLI flag **and** an env var; a CLI flag wins over its env var.

- `node server.mjs --help` is the authoritative list.
- `env.example` documents the same set grouped by concern, with the container-specific values (`MODEL_DIR`, `TMPFS_SIZE`, `ORT_NODE_VARIANT`, …).

A unit test iterates the option table and fails if any option's env var is missing from `docker-compose.yml`, so a knob cannot exist in code but be unreachable inside the container.

## Client examples

**OpenAI Python SDK**

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8002/v1", api_key="unused")  # or your PARAKEET_API_KEY
with open("meeting.ogg", "rb") as f:
    print(client.audio.transcriptions.create(model="whisper-1", file=f).text)
```

**curl, verbose json with word times**

```bash
curl -sS -H "Authorization: Bearer $PARAKEET_API_KEY" \
     -F file=@meeting.ogg \
     -F response_format=verbose_json \
     -F 'timestamp_granularities[]=word' \
     http://127.0.0.1:8002/v1/audio/transcriptions | jq '.words[:3]'
```

**Subtitles with speakers**

```bash
curl -sS -F file=@interview.ogg -F diarize=true -F response_format=srt \
     http://127.0.0.1:8002/v1/audio/transcriptions -o interview.srt
```

**whisper.cpp-flavoured client**

```bash
curl -sS -F audio_file=@clip.wav -F output=txt http://127.0.0.1:8002/inference
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Exit code 2 at boot | Bad configuration: the message names the flag. |
| Exit code 3 at boot | Weights missing or unreadable; the message names the file and the `hf download` command. |
| Exit code 4 at boot | The port is already in use. |
| `refusing to listen on the non-loopback address…` | See [Auth and exposure](#auth-and-exposure). |
| `fp16/fp32 cannot load on the wasm backend` | Use `--ort node`, or `--quant int8`. |
| 400 `unknown field "…"` | A typo, or a client field this server does not know. `--ignore-unsupported` only covers the *documented* rejected set, not unknown names. |
| 400 `diarization is enabled but …` | The pyannote/CAM++ models are not in the model directory. |
| Everything is slow | Check `--ort` (wasm is the portable default, not the fast one), `--beam-width` (8 costs real CPU), and whether diarization is on. `/health` shows the queue depth. |
| `ffmpeg` errors on upload | The container installs it; outside the container put it on `PATH` or set `--ffmpeg`. |

## Tests

```bash
node --test test/unit/openai-server-*.test.mjs   # tier 1: options, formats, params, queue
node --test test/http/openai-server.test.mjs     # tier 2: the real server over loopback
```

Tier 2 starts the real HTTP server on a random port and drives every route, status code, format and limit with real multipart bodies; only the inference side is a double, so the suite needs no weights and runs in seconds.

The model path itself is covered by this repo's existing unit/e2e tiers (the server imports it rather than reimplementing it). A real end-to-end smoke test is one command:

```bash
node scripts/openai-like-server/server.mjs --model-dir ./fallback_models --port 8099 &
curl -sS -F file=@test/fixtures/jfk.mp3 http://127.0.0.1:8099/v1/audio/transcriptions
```

## Files

| File | Role |
| --- | --- |
| `server.mjs` | Boot: parse options, build the engine, listen, drain on SIGTERM. |
| `lib/options.mjs` | The option table (CLI + env + defaults + per-request fields) and the whisper-compatibility tables. |
| `lib/app.mjs` | HTTP: routing, auth, CORS, limits, logging. |
| `lib/engine.mjs` | The inference side, wrapping `scripts/transcribe.mjs`'s loader/decoder. |
| `lib/params.mjs` | One request's form → the parameter set for a run. |
| `lib/formats.mjs` | Words → segments → json/text/srt/vtt/verbose_json. |
| `lib/queue.mjs` | Single-slot FIFO queue with 429/504. |
| `lib/wordlists.mjs` | Wordlist directory snapshot + trie cache. |
| `lib/multipart.mjs` | Capped body read, multipart parse, temp-file handling. |
| `lib/diarize.mjs`, `lib/diarize.worker.mjs` | sherpa-onnx diarization under Node (`worker_threads`). |
| `lib/errors.mjs`, `lib/constants.mjs` | OpenAI error envelope; shared constants. |
| `Dockerfile`, `docker-compose.yml`, `env.example` | The hardened container. |
