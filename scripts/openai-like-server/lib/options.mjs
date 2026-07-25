// Single source of truth for every knob this server has: CLI flag, env var,
// default, validation range, and (when the knob is safe to vary per call) the
// multipart form field a client may override it with.
//
// WHY A TABLE AND NOT ad-hoc parsing: the same knob has to appear in four
// places -- the CLI parser, the env fallback, `--help`, and the per-request
// override validator -- and a fifth (docker-compose `environment:` + env.example)
// that a test asserts against this table. Hand-written parsing drifts between
// those five the moment a knob is added; a table cannot. The compose/env.example
// plumbing check in test/unit/openai-server-options.test.mjs iterates OPTIONS,
// so a new row here FAILS the suite until it is documented and passed through
// the container (the env-var plumbing rule this repo keeps tripping over).
//
// Precedence is CLI arg > env var > default, resolved in {@link resolveOptions}.
//
// Whisper-server compatibility is deliberate: clients written against
// whisper.cpp's server or the OpenAI audio API pass flags/fields this pipeline
// has no equivalent for. Rather than silently ignoring them (which produces a
// transcript that quietly does not match what was asked for), they are split
// into two explicit tables: ACCEPTED_NOOP (genuinely cannot change our output,
// warn and move on) and UNSUPPORTED (would change output; fatal at launch /
// 400 per request, unless --ignore-unsupported downgrades them to warnings).
//
// Built with Claude Code.

import {
  DEFAULT_MODEL, DEFAULT_CHUNK_DURATION_SEC, MIN_CHUNK_DURATION_SEC,
  MAX_CHUNK_DURATION_SEC, listModels, getModelConfig,
} from '../../../app/src/models.js';
import { DEFAULT_SNAP_TO_SILENCE_SEC } from '../../../app/src/parakeet.js';

export const DEFAULT_PORT = 8002;

// Response formats we can emit. `verbose_json` is the only one carrying
// timestamps/segments, matching the OpenAI API.
export const RESPONSE_FORMATS = ['json', 'text', 'srt', 'vtt', 'verbose_json'];

// OpenAI's timestamp_granularities[] values.
export const GRANULARITIES = ['segment', 'word'];

/**
 * Every option, in `--help` order.
 *
 * Row fields:
 *   key        camelCase name on the resolved options object.
 *   cli        accepted CLI spellings (long form first; it is what --help shows).
 *   env        env var consulted when no CLI flag is given.
 *   type       'string' | 'int' | 'float' | 'bool' | 'enum' | 'list'.
 *   def        default value (or a function of the already-resolved options).
 *   min/max    inclusive numeric bounds, enforced for int/float.
 *   choices    allowed values for 'enum'.
 *   req        multipart field name a client may override this with, when the
 *              knob is per-call safe. Absent = launch-time only.
 *   negCli     CLI spellings that set a bool to false (e.g. --no-chunking).
 *   help       one-line help text.
 *   section    grouping for --help.
 */
export const OPTIONS = [
  // ── server ──────────────────────────────────────────────────────────────
  {
    key: 'host', cli: ['--host'], env: 'PARAKEET_HOST', type: 'string', def: '127.0.0.1',
    section: 'Server',
    help: 'Address to bind. Defaults to loopback; a non-loopback bind REQUIRES --api-key.',
  },
  {
    key: 'port', cli: ['--port'], env: 'PARAKEET_PORT', type: 'int', def: DEFAULT_PORT,
    min: 1, max: 65535, section: 'Server',
    help: 'TCP port to listen on.',
  },
  {
    key: 'apiKey', cli: ['--api-key'], env: 'PARAKEET_API_KEY', type: 'string', def: '',
    secret: true, section: 'Server',
    help: 'Bearer token required on every request. Empty (the default) disables auth, '
        + 'which is only allowed on a loopback bind.',
  },
  {
    key: 'allowKeylessNonLoopback', cli: ['--allow-keyless-non-loopback'],
    env: 'PARAKEET_ALLOW_KEYLESS_NON_LOOPBACK', type: 'bool', def: false, section: 'Server',
    help: 'Permit an authless bind to a non-loopback address. It exists for ONE case: inside a '
        + 'container, the server must bind 0.0.0.0 for a published port to reach it, and docker '
        + 'compose publishes that port to 127.0.0.1 only -- so the effective exposure is still '
        + 'loopback. Set it only when something outside the process restricts reachability; if you '
        + 'publish the port on a real interface, set --api-key instead.',
  },
  {
    key: 'requestPath', cli: ['--request-path'], env: 'PARAKEET_REQUEST_PATH', type: 'string', def: '',
    section: 'Server',
    help: 'Path prefix for every route (whisper.cpp compatible), e.g. /asr -> /asr/v1/audio/transcriptions.',
  },
  {
    key: 'inferencePath', cli: ['--inference-path'], env: 'PARAKEET_INFERENCE_PATH', type: 'string', def: '/inference',
    section: 'Server',
    help: 'Path of the whisper.cpp-style alias route (set to "" to disable it).',
  },
  {
    key: 'allowedOrigins', cli: ['--allowed-origins'], env: 'PARAKEET_ALLOWED_ORIGINS', type: 'list', def: [],
    section: 'Server',
    help: 'Comma-separated Origins allowed to call the API from a browser. Empty = no CORS headers '
        + 'at all (server-to-server use); "*" allows any origin.',
  },
  {
    key: 'maxUploadMb', cli: ['--max-upload-mb'], env: 'PARAKEET_MAX_UPLOAD_MB', type: 'float', def: 100,
    min: 0.001, max: 8192, section: 'Server',
    help: 'Reject request bodies larger than this with 413.',
  },
  {
    key: 'maxQueue', cli: ['--max-queue'], env: 'PARAKEET_MAX_QUEUE', type: 'int', def: 8,
    min: 0, max: 1024, section: 'Server',
    help: 'Requests allowed to WAIT while one transcribes (the model is single-instance and '
        + 'strictly FIFO). Beyond this: 429 + Retry-After. 0 = reject any overlap.',
  },
  {
    key: 'requestTimeoutSec', cli: ['--request-timeout'], env: 'PARAKEET_REQUEST_TIMEOUT_SEC', type: 'int',
    def: 1800, min: 1, max: 86400, section: 'Server',
    help: 'Give up on a request (504) after this long, queue wait included.',
  },

  // ── model ───────────────────────────────────────────────────────────────
  {
    key: 'modelDir', cli: ['--model-dir', '-m', '--model-path'], env: 'PARAKEET_MODEL_DIR', type: 'string', def: '',
    section: 'Model',
    help: 'REQUIRED. Directory holding the ONNX weights + vocab.txt (encoder-model.*.onnx, '
        + 'decoder_joint-model.*.onnx). Also accepts a path to one of those .onnx files, '
        + 'whose directory is then used (so `-m /models/encoder-model.int8.onnx` works like whisper.cpp).',
  },
  {
    key: 'model', cli: ['--model-key'], env: 'PARAKEET_MODEL', type: 'enum', def: DEFAULT_MODEL,
    choices: listModels(), section: 'Model',
    help: `Model architecture key (${listModels().join(', ')}); selects mel bins + subsampling, not the files.`,
  },
  {
    key: 'modelId', cli: ['--model-id'], env: 'PARAKEET_MODEL_ID', type: 'string', def: '',
    section: 'Model',
    help: 'Model id reported by GET /v1/models and echoed in responses. Defaults to '
        + '"<model-key>-<encoder-quant>".',
  },
  {
    key: 'quant', cli: ['--quant'], env: 'PARAKEET_QUANT', type: 'enum', def: 'int8',
    choices: ['int8', 'fp16', 'fp32'], section: 'Model',
    help: 'ENCODER precision. int8 is the only one the WASM backend can load (fp16/fp32 '
        + 'need --ort node or cuda; see README).',
  },
  {
    key: 'decoderQuant', cli: ['--decoder-quant'], env: 'PARAKEET_DECODER_QUANT', type: 'enum', def: 'int8',
    choices: ['int8', 'fp16', 'fp32'], section: 'Model',
    help: 'DECODER/joiner precision, chosen independently of --quant. int8 is as accurate as '
        + 'fp32 on this model while ~4x smaller.',
  },
  {
    key: 'ort', cli: ['--ort'], env: 'PARAKEET_ORT', type: 'enum', def: 'wasm',
    choices: ['wasm', 'node', 'cuda'], section: 'Model',
    help: 'ONNX Runtime backend. wasm = the vendored onnxruntime-web build (no native dep, '
        + 'byte-identical to the browser app, int8 only). node = native CPU EP (unlocks '
        + 'fp16/fp32, faster). cuda = native CUDA EP, needs an NVIDIA GPU with CUDA 12 + cuDNN 9 '
        + 'reachable via LD_LIBRARY_PATH.',
  },
  {
    key: 'threads', cli: ['--threads', '-t'], env: 'PARAKEET_THREADS', type: 'int', def: 0,
    min: 0, max: 256, section: 'Model',
    help: 'Inference thread count (0 = let ORT decide). Sets the WASM thread count, or the '
        + 'native EP\'s intra-op threads with --ort node|cuda. SET IT in a container: ORT sizes '
        + 'its pool from the HOST core count, which a CPU quota does not change, so an unset '
        + 'value oversubscribes (12 threads sharing 4 CPUs is slower than 4).',
  },
  {
    key: 'ffmpeg', cli: ['--ffmpeg'], env: 'PARAKEET_FFMPEG', type: 'string', def: '',
    section: 'Model',
    help: 'ffmpeg binary used to decode uploads to 16 kHz mono. Auto-detected when unset.',
  },

  // ── decoding ────────────────────────────────────────────────────────────
  {
    key: 'beamWidth', cli: ['--beam-width', '-bs', '--beam-size'], env: 'PARAKEET_BEAM_WIDTH', type: 'int',
    def: 1, min: 1, max: 25, req: 'beam_size', section: 'Decoding',
    help: 'Beam search width. 1 = greedy (fastest). >1 runs MAES; beam 8 measurably beats '
        + 'greedy on real audio but costs CPU.',
  },
  {
    key: 'maesNumSteps', cli: ['--maes-num-steps'], env: 'PARAKEET_MAES_NUM_STEPS', type: 'int',
    def: 2, min: 1, max: 10, req: 'maes_num_steps', section: 'Decoding',
    help: 'MAES: max symbols per encoder frame. Values below 2 cost accuracy.',
  },
  {
    key: 'maesExpansionBeta', cli: ['--maes-expansion-beta'], env: 'PARAKEET_MAES_EXPANSION_BETA', type: 'int',
    def: 2, min: 0, max: 10, req: 'maes_expansion_beta', section: 'Decoding',
    help: 'MAES: over-generation budget (expand top beamWidth+N tokens per hypothesis).',
  },
  {
    key: 'maesExpansionGamma', cli: ['--maes-expansion-gamma'], env: 'PARAKEET_MAES_EXPANSION_GAMMA', type: 'float',
    def: 2.3, min: 0.01, max: 20, req: 'maes_expansion_gamma', section: 'Decoding',
    help: 'MAES: log-prob prune threshold. Smaller = more aggressive pruning / faster.',
  },
  {
    key: 'maesPrefixAlpha', cli: ['--maes-prefix-alpha'], env: 'PARAKEET_MAES_PREFIX_ALPHA', type: 'int',
    def: 0, min: 0, max: 10, req: 'maes_prefix_alpha', section: 'Decoding',
    help: 'MAES: prefix-search recombination length gap. 0 disables it.',
  },
  {
    key: 'beamPrefetch', cli: ['--beam-prefetch'], negCli: ['--no-beam-prefetch'],
    env: 'PARAKEET_BEAM_PREFETCH', type: 'bool', def: true, req: 'beam_prefetch', section: 'Decoding',
    help: 'Speculative cross-frame joiner prefetch in the beam decoder (a pure speed knob).',
  },
  {
    key: 'frameStride', cli: ['--frame-stride'], env: 'PARAKEET_FRAME_STRIDE', type: 'int',
    def: 1, min: 1, max: 4, req: 'frame_stride', section: 'Decoding',
    help: 'Decimate encoder frames before decoding. 1 = every frame (lossless); >1 trades accuracy for speed.',
  },
  {
    key: 'temperature', cli: ['--temperature'], env: 'PARAKEET_TEMPERATURE', type: 'float',
    def: 0, min: 0, max: 1, req: 'temperature', section: 'Decoding',
    help: 'Softmax temperature. It does NOT change the transcript (greedy argmax is '
        + 'scale-invariant and MAES ranks at temperature 1 regardless); it only rescales '
        + 'reported confidences, which is why the web UI pins it at 0.',
  },
  {
    key: 'chunking', cli: ['--chunking'], negCli: ['--no-chunking'], env: 'PARAKEET_CHUNKING',
    type: 'bool', def: true, req: 'chunking', section: 'Decoding',
    help: 'Split long audio into overlapping chunks (quality degrades badly without it).',
  },
  {
    key: 'chunkDuration', cli: ['--chunk-duration'], env: 'PARAKEET_CHUNK_DURATION', type: 'float',
    def: DEFAULT_CHUNK_DURATION_SEC, min: MIN_CHUNK_DURATION_SEC, max: MAX_CHUNK_DURATION_SEC,
    req: 'chunk_duration', section: 'Decoding',
    help: `Chunk length in seconds (${MIN_CHUNK_DURATION_SEC}-${MAX_CHUNK_DURATION_SEC}; parakeet degrades past the max).`,
  },
  {
    key: 'overlap', cli: ['--overlap'], env: 'PARAKEET_OVERLAP', type: 'float', def: 2,
    min: 0, max: 10, req: 'overlap', section: 'Decoding',
    help: 'Overlap between chunks in seconds (the stitcher dedups the repeated words).',
  },
  {
    key: 'snapToSilence', cli: ['--snap-to-silence'], env: 'PARAKEET_SNAP_TO_SILENCE', type: 'float',
    def: DEFAULT_SNAP_TO_SILENCE_SEC, min: 0, max: 10, req: 'snap_to_silence', section: 'Decoding',
    help: 'Pull each chunk seam back to the quietest point within N seconds so seams land in '
        + 'pauses, not mid-word. 0 disables.',
  },

  // ── phrase boosting ─────────────────────────────────────────────────────
  {
    key: 'wordlistDir', cli: ['--wordlist-dir'], env: 'PARAKEET_WORDLIST_DIR', type: 'string', def: '',
    section: 'Phrase boosting',
    help: 'Directory of phrase-boost wordlists (.txt, or .pwc precompiled by '
        + 'scripts/compile-boost.mjs). Each file is selectable by basename.',
  },
  {
    key: 'wordlist', cli: ['--wordlist'], env: 'PARAKEET_WORDLIST', type: 'string', def: '',
    req: 'phrase_boost', section: 'Phrase boosting',
    help: 'Wordlist applied when a request does not name one. A request may pass '
        + 'phrase_boost=<name> to pick another, or phrase_boost="" for none.',
  },
  {
    key: 'prompt', cli: ['--prompt'], env: 'PARAKEET_PROMPT', type: 'string', def: '',
    req: 'prompt', section: 'Phrase boosting',
    help: 'Inline boost phrases ("phrase:WEIGHT:MINP:FLAG", comma/newline separated) used as '
        + 'the default. This is where OpenAI\'s `prompt` field lands: parakeet has no text '
        + 'conditioning, so a prompt is interpreted as phrases to boost.',
  },
  {
    key: 'boostStrength', cli: ['--boost-strength', '-s'], env: 'PARAKEET_BOOST_STRENGTH', type: 'float',
    def: 1, min: 0, max: 10, req: 'boost_strength', section: 'Phrase boosting',
    help: 'Global multiplier over every phrase weight (the web UI slider). 0 disables boosting.',
  },
  {
    key: 'boostMinp', cli: ['--boost-minp'], env: 'PARAKEET_BOOST_MINP', type: 'float',
    def: null, min: 0, max: 1, req: 'boost_minp', section: 'Phrase boosting',
    help: 'Override the min-p gate of EVERY phrase (a boosted token must still reach this '
        + 'fraction of the top token probability). Unset = each phrase keeps its own.',
  },
  {
    key: 'depthScaling', cli: ['--depth-scaling'], env: 'PARAKEET_DEPTH_SCALING', type: 'float',
    def: null, min: 0, max: 10, req: 'depth_scaling', section: 'Phrase boosting',
    help: 'Trie depth-scaling factor (bonus at depth d = weight*(1+N*(d-1))). Unset = built-in default. '
        + 'Baked in at build time, so a per-request value rebuilds the trie (slow on big lists).',
  },

  // ── diarization ─────────────────────────────────────────────────────────
  {
    key: 'diarize', cli: ['--diarize', '-di'], negCli: ['--no-diarize'], env: 'PARAKEET_DIARIZE',
    type: 'bool', def: false, req: 'diarize', section: 'Diarization',
    help: 'Label speakers (sherpa-onnx pyannote segmentation + CAM++ embeddings). Adds a '
        + '`speaker` field to verbose_json segments and "[Speaker N]" prefixes to srt/vtt/text. '
        + 'A documented extension: not part of the OpenAI API.',
  },
  {
    key: 'diarizeSegModel', cli: ['--diarize-seg-model'], env: 'PARAKEET_DIARIZE_SEG_MODEL', type: 'string',
    def: '', section: 'Diarization',
    help: 'Pyannote segmentation ONNX. Defaults to <model-dir>/model.onnx.',
  },
  {
    key: 'diarizeEmbModel', cli: ['--diarize-emb-model'], env: 'PARAKEET_DIARIZE_EMB_MODEL', type: 'string',
    def: '', section: 'Diarization',
    help: 'CAM++ speaker-embedding ONNX. Defaults to the 3dspeaker_*campplus*.onnx found in <model-dir>.',
  },
  {
    key: 'diarizeThreads', cli: ['--diarize-threads'], env: 'PARAKEET_DIARIZE_THREADS', type: 'int',
    def: 1, min: 1, max: 256, section: 'Diarization',
    help: 'Threads for the diarization engine (it is the dominant cost on long audio).',
  },
  {
    key: 'numSpeakers', cli: ['--num-speakers'], env: 'PARAKEET_NUM_SPEAKERS', type: 'int',
    def: -1, min: -1, max: 100, req: 'num_speakers', section: 'Diarization',
    help: 'Exact speaker count. -1 (default) clusters automatically using --diarize-threshold.',
  },
  {
    key: 'diarizeThreshold', cli: ['--diarize-threshold'], env: 'PARAKEET_DIARIZE_THRESHOLD', type: 'float',
    def: 0.5, min: 0.01, max: 2, req: 'diarize_threshold', section: 'Diarization',
    help: 'Clustering distance threshold used when the speaker count is automatic. Lower = more speakers.',
  },
  {
    key: 'minDurationOn', cli: ['--min-duration-on'], env: 'PARAKEET_MIN_DURATION_ON', type: 'float',
    def: 0.3, min: 0, max: 10, req: 'min_duration_on', section: 'Diarization',
    help: 'Drop speech runs shorter than this (seconds).',
  },
  {
    key: 'minDurationOff', cli: ['--min-duration-off'], env: 'PARAKEET_MIN_DURATION_OFF', type: 'float',
    def: 0.5, min: 0, max: 10, req: 'min_duration_off', section: 'Diarization',
    help: 'Bridge silences shorter than this (seconds) inside one speaker turn.',
  },

  // ── output ──────────────────────────────────────────────────────────────
  {
    key: 'responseFormat', cli: ['--response-format'], env: 'PARAKEET_RESPONSE_FORMAT', type: 'enum',
    def: 'json', choices: RESPONSE_FORMATS, req: 'response_format', section: 'Output',
    help: 'Default response format when the request does not ask for one.',
  },
  {
    key: 'language', cli: ['--language', '-l'], env: 'PARAKEET_LANGUAGE', type: 'string', def: '',
    req: 'language', section: 'Output',
    help: 'Language code echoed back in verbose_json. Validated against the model\'s supported '
        + 'set but NOT used to steer decoding: parakeet-tdt v3 is multilingual and detects the '
        + 'language itself, so this cannot force a language (unlike whisper).',
  },
  {
    key: 'maxSegmentChars', cli: ['--max-segment-chars'], env: 'PARAKEET_MAX_SEGMENT_CHARS', type: 'int',
    def: 180, min: 20, max: 2000, req: 'max_segment_chars', section: 'Output',
    help: 'Soft cap on segment length when grouping words into segments/subtitles.',
  },
  {
    key: 'segmentGapSec', cli: ['--segment-gap'], env: 'PARAKEET_SEGMENT_GAP_SEC', type: 'float',
    def: 0.8, min: 0.05, max: 10, req: 'segment_gap', section: 'Output',
    help: 'Start a new segment when the pause between two words exceeds this (seconds).',
  },

  // ── behaviour ───────────────────────────────────────────────────────────
  {
    key: 'lockParams', cli: ['--lock-params'], env: 'PARAKEET_LOCK_PARAMS', type: 'bool', def: false,
    section: 'Behaviour',
    help: 'Refuse (400) any request that tries to override a launch-time decoding knob, so every '
        + 'transcript from this instance is produced with identical settings. file/model/'
        + 'response_format/timestamp_granularities stay allowed.',
  },
  {
    key: 'ignoreUnsupported', cli: ['--ignore-unsupported'], env: 'PARAKEET_IGNORE_UNSUPPORTED',
    type: 'bool', def: false, section: 'Behaviour',
    help: 'Downgrade unsupported whisper flags/fields from an error to a warning, for drop-in '
        + 'use with clients that always send them. The transcript then does NOT honour them.',
  },
  {
    key: 'verbose', cli: ['--verbose', '-v', '--print-progress'], env: 'PARAKEET_VERBOSE', type: 'bool',
    def: false, section: 'Behaviour',
    help: 'Per-stage model + chunk timing logs.',
  },
];

// Accepted for compatibility, warned about once, and genuinely unable to change
// our output. Keeping them here (rather than in UNSUPPORTED) is what lets a
// whisper.cpp-shaped command line start unchanged.
export const ACCEPTED_NOOP = [
  { cli: ['--convert'], takesValue: false, why: 'uploads are always decoded through ffmpeg already' },
  { cli: ['-p', '--processors'], takesValue: true, why: 'this server runs one model instance; use --max-queue' },
  { cli: ['-fa', '--flash-attn'], takesValue: false, why: 'not applicable to the parakeet ONNX graphs' },
  { cli: ['-ng', '--no-gpu'], takesValue: false, why: 'the backend is chosen with --ort (default wasm = CPU)' },
  { cli: ['-nt', '--no-timestamps'], takesValue: false, why: 'timestamps are opt-in per request (verbose_json)' },
  { cli: ['-debug', '--debug-mode'], takesValue: false, why: 'use --verbose' },
];

// Would change the transcript if honoured, and we cannot honour them. Fatal at
// launch (and 400 per request) unless --ignore-unsupported is set. `alt` names
// the closest thing this pipeline does have, so the error is actionable.
export const UNSUPPORTED = [
  {
    cli: ['-tr', '--translate'], req: ['translate'], takesValue: false,
    why: 'parakeet transcribes only; it has no translation head',
    alt: 'transcribe, then translate the text with a separate tool',
  },
  {
    cli: ['-ot', '--offset-t'], req: ['offset_t'], takesValue: true,
    why: 'clipping the input is not implemented',
    alt: 'trim the audio before uploading (ffmpeg -ss)',
  },
  {
    cli: ['-d', '--duration'], req: ['duration'], takesValue: true,
    why: 'clipping the input is not implemented',
    alt: 'trim the audio before uploading (ffmpeg -t)',
  },
  {
    cli: ['-ml', '--max-len'], req: ['max_len'], takesValue: true,
    why: 'segment length is not a decoder constraint here',
    alt: '--max-segment-chars / --segment-gap shape the emitted segments',
  },
  {
    cli: ['-sow', '--split-on-word'], req: ['split_on_word'], takesValue: false,
    why: 'segments are always split on word boundaries',
    alt: 'nothing to do: this is the only behaviour',
  },
  {
    cli: ['-bo', '--best-of'], req: ['best_of'], takesValue: true,
    why: 'the TDT decoder has no sampling/rescoring pass to pick a best-of-N from',
    alt: '--beam-width (MAES beam search)',
  },
  {
    cli: ['-mc', '--max-context'], req: ['max_context'], takesValue: true,
    why: 'the RNN-T decoder has no text context window to bound',
    alt: '--chunk-duration bounds the audio context',
  },
  {
    cli: ['-tdrz', '--tinydiarize'], req: ['tinydiarize'], takesValue: false,
    why: 'that is a whisper-specific model variant',
    alt: '--diarize (sherpa-onnx pyannote + CAM++)',
  },
  {
    cli: ['--suppress-nst', '--suppress-non-speech-tokens'], req: ['suppress_nst'], takesValue: false,
    why: 'parakeet emits no non-speech tokens to suppress',
    alt: 'nothing to do',
  },
  {
    cli: ['-dtw', '--dtw'], req: ['dtw'], takesValue: true,
    why: 'token-level DTW realignment is whisper-specific',
    alt: 'word timestamps come from the TDT durations already (timestamp_granularities=word)',
  },
  {
    cli: ['--public'], req: [], takesValue: true,
    why: 'this server serves an API only, never static files',
    alt: 'the browser UI is the main parakeet_web app',
  },
  // NOTE: `stream` deliberately does NOT live here. This table rejects a field on
  // PRESENCE, but a client that spells out its default (`stream=false`) is asking
  // for exactly what we do, and refusing it would break that client for nothing.
  // params.mjs handles it inline instead and rejects only stream=true (which is a
  // hard 501, never downgraded by --ignore-unsupported: a client waiting for SSE
  // frames cannot use a plain JSON body).
];

const OPT_BY_KEY = new Map(OPTIONS.map((o) => [o.key, o]));
/** Look up an option row by its camelCase key. */
export function optionByKey(key) { return OPT_BY_KEY.get(key); }

/** Option rows a request may override, keyed by their multipart field name. */
export const REQUEST_OVERRIDES = new Map(
  OPTIONS.filter((o) => o.req).map((o) => [o.req, o]),
);

// Fields every request may send regardless of --lock-params: they select what
// comes back rather than how the audio is decoded, so they cannot make two
// transcripts from one instance disagree.
export const ALWAYS_ALLOWED_FIELDS = new Set([
  'file', 'model', 'response_format', 'timestamp_granularities', 'timestamp_granularities[]',
]);

/**
 * Coerce and validate one raw string value against an option row.
 * Throws Error with a human-readable message; callers turn that into a fatal
 * boot error or a 400.
 */
export function coerceValue(spec, raw, { source = 'option' } = {}) {
  const where = `${source} ${spec.cli ? spec.cli[0] : spec.req}`;
  if (spec.type === 'bool') {
    const v = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(v)) return false;
    throw new Error(`${where}: expected a boolean (true/false), got "${raw}"`);
  }
  if (spec.type === 'int' || spec.type === 'float') {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new Error(`${where}: expected a number, got "${raw}"`);
    if (spec.type === 'int' && !Number.isInteger(n)) throw new Error(`${where}: expected an integer, got "${raw}"`);
    if (spec.min != null && n < spec.min) throw new Error(`${where}: must be >= ${spec.min}, got ${n}`);
    if (spec.max != null && n > spec.max) throw new Error(`${where}: must be <= ${spec.max}, got ${n}`);
    return n;
  }
  if (spec.type === 'enum') {
    const v = String(raw).trim();
    if (!spec.choices.includes(v)) {
      throw new Error(`${where}: must be one of ${spec.choices.join(', ')}, got "${v}"`);
    }
    return v;
  }
  if (spec.type === 'list') {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return String(raw);
}

/**
 * Resolve options from argv + env, applying CLI > env > default.
 *
 * Returns `{ options, warnings, help }`. `help` is true when -h/--help was
 * passed (the caller prints {@link renderHelp} and exits 0). Unknown flags and
 * out-of-range values throw.
 */
export function resolveOptions(argv = [], env = process.env) {
  const options = {};
  const warnings = [];
  const seenCli = new Set();
  let help = false;

  // Index every CLI spelling once so an unknown flag is a hard error rather
  // than a silently ignored typo (--beam-widht must not mean greedy).
  const byCli = new Map();
  for (const spec of OPTIONS) {
    for (const c of spec.cli) byCli.set(c, { spec, negate: false });
    for (const c of spec.negCli || []) byCli.set(c, { spec, negate: true });
  }
  const noopByCli = new Map();
  for (const n of ACCEPTED_NOOP) for (const c of n.cli) noopByCli.set(c, n);
  const unsupByCli = new Map();
  for (const u of UNSUPPORTED) for (const c of u.cli) unsupByCli.set(c, u);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { help = true; continue; }
    if (!arg.startsWith('-')) throw new Error(`unexpected positional argument "${arg}" (this server takes options only)`);
    // Accept both --flag=value and --flag value.
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);

    const noop = noopByCli.get(name);
    if (noop) {
      if (noop.takesValue && inlineValue === null) i++;    // consume its value
      warnings.push(`ignoring ${name}: ${noop.why}`);
      continue;
    }
    const unsup = unsupByCli.get(name);
    if (unsup) {
      if (unsup.takesValue && inlineValue === null) i++;
      const msg = `${name} is not supported: ${unsup.why} (instead: ${unsup.alt})`;
      // The flag itself decides its own severity, so order on the command line
      // does not matter: collect, then apply once argv is fully parsed.
      (options._unsupportedSeen ||= []).push(msg);
      continue;
    }

    const hit = byCli.get(name);
    if (!hit) throw new Error(`unknown option "${name}" (try --help)`);
    const { spec, negate } = hit;
    let raw;
    if (spec.type === 'bool') {
      // Bare --flag means true (or false for a negCli spelling); --flag=false is honoured.
      raw = inlineValue !== null ? inlineValue : String(!negate);
      if (inlineValue !== null && negate) raw = String(!coerceValue(spec, inlineValue, { source: 'flag' }));
    } else {
      raw = inlineValue !== null ? inlineValue : argv[++i];
      if (raw === undefined) throw new Error(`option "${name}" needs a value`);
    }
    options[spec.key] = coerceValue(spec, raw, { source: 'flag' });
    seenCli.add(spec.key);
  }

  // --help must not have to satisfy the config: `--help` alone (no model dir, no
  // env) is how someone discovers the flags in the first place, so bail out
  // before the env fallback and the cross-option validation below.
  if (help) return { options: {}, warnings, help: true };

  // Env fallback + defaults for anything the CLI did not set.
  for (const spec of OPTIONS) {
    if (seenCli.has(spec.key)) continue;
    const raw = spec.env ? env[spec.env] : undefined;
    if (raw !== undefined && String(raw).trim() !== '') {
      options[spec.key] = coerceValue(spec, raw, { source: `env ${spec.env}` });
    } else {
      options[spec.key] = typeof spec.def === 'function' ? spec.def(options) : spec.def;
    }
  }

  const unsupportedSeen = options._unsupportedSeen || [];
  delete options._unsupportedSeen;
  if (unsupportedSeen.length) {
    if (options.ignoreUnsupported) warnings.push(...unsupportedSeen.map((m) => `${m} [--ignore-unsupported]`));
    else throw new Error(`${unsupportedSeen.join('\n  ')}\n  (pass --ignore-unsupported to downgrade these to warnings)`);
  }

  // Cross-option validation. These are the combinations that would otherwise
  // fail deep inside ORT, or silently expose the API.
  if (!options.modelDir) {
    throw new Error(
      'no model directory: pass --model-dir (or -m) / set PARAKEET_MODEL_DIR to the folder holding '
      + 'encoder-model.*.onnx + decoder_joint-model.*.onnx + vocab.txt.\n'
      + '  Populate one with:  hf download Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx --local-dir ./models',
    );
  }
  if (!isLoopbackHost(options.host) && !options.apiKey && !options.allowKeylessNonLoopback) {
    throw new Error(
      `refusing to listen on the non-loopback address ${options.host} without an API key. Pick one:\n`
      + '    * set --api-key / PARAKEET_API_KEY (openssl rand -hex 32)   <- do this if the port is reachable\n'
      + '    * bind 127.0.0.1 and put a reverse proxy in front\n'
      + '    * set --allow-keyless-non-loopback / PARAKEET_ALLOW_KEYLESS_NON_LOOPBACK=true if something\n'
      + '      else already limits reachability -- which is the case in the shipped docker-compose.yml,\n'
      + '      where the container binds 0.0.0.0 but the port is published to 127.0.0.1 only.',
    );
  }
  if (options.ort === 'wasm' && options.quant !== 'int8') {
    throw new Error(
      `--quant ${options.quant} cannot load on the wasm backend (a single ArrayBuffer caps at ~2 GB in `
      + '32-bit WASM, and the CPU/WASM EP upcasts fp16 to fp32 at session build). '
      + 'Use --ort node (or cuda) for fp16/fp32, or --quant int8.',
    );
  }
  if (options.wordlist && !options.wordlistDir) {
    throw new Error(`--wordlist ${options.wordlist} needs --wordlist-dir / PARAKEET_WORDLIST_DIR`);
  }
  if (options.language && !supportsLanguageStrict(options.model, options.language)) {
    throw new Error(`--language ${options.language} is not in ${options.model}'s supported set`);
  }
  if (!options.modelId) options.modelId = `${options.model}-${options.quant}`;
  if (options.requestPath && !options.requestPath.startsWith('/')) {
    throw new Error(`--request-path must start with "/" (got "${options.requestPath}")`);
  }
  if (options.inferencePath && !options.inferencePath.startsWith('/')) {
    throw new Error(`--inference-path must start with "/" (got "${options.inferencePath}")`);
  }

  return { options, warnings, help };
}

/** True for addresses that only accept connections from this host. */
export function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127\./.test(h);
}

// Language validation that tolerates the model key being unknown to models.js
// (it cannot be: --model is an enum over listModels(), but a future model
// without a `languages` list should not crash the boot path).
function supportsLanguageStrict(modelKey, language) {
  const cfg = getModelConfig(modelKey);
  if (!cfg || !Array.isArray(cfg.languages) || !cfg.languages.length) return true;
  return cfg.languages.includes(String(language).toLowerCase());
}

/** Render `--help`, generated from the tables so it can never drift. */
export function renderHelp() {
  const lines = [];
  lines.push('OpenAI/whisper-compatible HTTP API for the parakeet_web ONNX pipeline.');
  lines.push('');
  lines.push('Usage:');
  lines.push('  node scripts/openai-like-server/server.mjs --model-dir ./fallback_models [options]');
  lines.push('');
  lines.push('Routes (prefixed by --request-path):');
  lines.push('  POST /v1/audio/transcriptions   multipart: file, model, language, prompt, temperature,');
  lines.push('                                  response_format, timestamp_granularities[], plus the');
  lines.push('                                  per-request fields marked [field] below');
  lines.push('  POST /inference                 whisper.cpp-style alias of the above');
  lines.push('  POST /v1/audio/translations     501 (parakeet cannot translate)');
  lines.push('  POST /load                      501 (the model is fixed at launch)');
  lines.push('  GET  /v1/models                 the one served model');
  lines.push('  GET  /health                    liveness + queue depth');
  lines.push('');

  const pad = 26;
  let section = null;
  for (const spec of OPTIONS) {
    if (spec.section !== section) {
      section = spec.section;
      lines.push(`${section}:`);
    }
    const value = spec.type === 'bool' ? '' : ` ${spec.type.toUpperCase()}`;
    const flags = `  ${spec.cli.join(', ')}${value}`;
    const req = spec.req ? ` [${spec.req}]` : '';
    const neg = spec.negCli ? ` (negate: ${spec.negCli.join(', ')})` : '';
    const def = spec.def === null || spec.def === '' ? 'unset' : String(spec.def);
    const tail = `${spec.help}${neg} Default: ${def}. Env: ${spec.env}.${req}`;
    lines.push(column(flags, tail, pad));
  }
  lines.push('');
  lines.push('  -h, --help                Show this help.');
  lines.push('');
  lines.push('[field] = the multipart field a request may use to override that option');
  lines.push('          (disable all such overrides with --lock-params).');
  lines.push('');
  lines.push('Accepted for whisper compatibility but ignored (they cannot change our output):');
  for (const n of ACCEPTED_NOOP) lines.push(column(`  ${n.cli.join(', ')}`, n.why, pad));
  lines.push('');
  lines.push('Rejected (they WOULD change the transcript; --ignore-unsupported downgrades to a warning):');
  for (const u of UNSUPPORTED) {
    if (!u.cli.length) continue;
    lines.push(column(`  ${u.cli.join(', ')}`, `${u.why}; instead: ${u.alt}`, pad));
  }
  return lines.join('\n');
}

// Lay out one "label   description" row. A label at or past the column (e.g.
// --suppress-non-speech-tokens) wraps to its own line instead of running into
// the description with no space between them.
function column(label, tail, pad) {
  return label.length >= pad ? `${label}\n${' '.repeat(pad)}${tail}` : `${label.padEnd(pad)}${tail}`;
}
