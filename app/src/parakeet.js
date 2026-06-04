import { initOrt } from './backend.js';
import { ParakeetTokenizer } from './tokenizer.js';
import { OnnxPreprocessor } from './preprocessor.js';
import { JsPreprocessor } from './mel.js';

/**
 * Normalise an external-weights source into the ORT `externalData` array.
 *
 * A model's weights live either in a single `<model>.data` sidecar or, for a
 * sharded fp32 encoder (scripts/shard-fp32.py), across several
 * `<model>.data.000/.001/...` files, each kept under the 2 GB WASM ArrayBuffer
 * and Chromium blob-fetch caps so the ~2.4 GB fp32 encoder can load on WASM.
 *
 * @param {string|ArrayBuffer|Uint8Array|Array<{path:string,data:*}>|null} source
 *   Single sidecar (URL/buffer) OR an array of `{ path, data }` shard entries.
 *   For shards each `path` MUST equal the basename baked into the graph's
 *   external_data `location` (e.g. `encoder-model.onnx.data.000`).
 * @param {string} [modelFilename] Model graph filename, used to derive the
 *   single-sidecar path (`<modelFilename>.data`). Ignored for the array form.
 * @returns {Array<{path:string,data:*}>|undefined} ORT externalData, or
 *   undefined when there is nothing to mount.
 */
export function buildExternalData(source, modelFilename) {
  if (!source) return undefined;
  // Sharded form: caller already paired each shard's bytes with its baked-in
  // location, so pass the entries straight through.
  if (Array.isArray(source)) return source.length ? source : undefined;
  // Single-sidecar form: needs the model filename to name the `.data` path.
  if (!modelFilename) return undefined;
  return [{ data: source, path: modelFilename + '.data' }];
}

/**
 * Lightweight Parakeet model wrapper designed for browser usage.
 * Supports the *combined* decoder_joint-model ONNX (encoder+decoder+joiner in
 * transformerjs style) exported by parakeet TDT.
 */
export class ParakeetModel {
  constructor({ tokenizer, encoderSession, joinerSession, preprocessor, ort, subsampling = 8, windowStride = 0.01, normalizer = (s)=>s, verbose = false }) {
    this.tokenizer = tokenizer;
    this.encoderSession = encoderSession;
    this.joinerSession = joinerSession;
    this.preprocessor = preprocessor;
    this.ort = ort;

    // Read blank ID from tokenizer (last vocab entry for TDT models).
    // Dynamic instead of hardcoded so multilingual models (v3, vocabSize 4097)
    // work without modification.
    this.blankId = tokenizer.blankId;

    // Combined model specific constants
    this.predHidden = 640;
    this.predLayers = 2;
    this.maxTokensPerStep = 10;

    // Allocate zero LSTM states for the combined decoder; will be reused.
    const numLayers = this.predLayers;
    const hidden = this.predHidden;
    const size = numLayers * 1 * hidden;
    const z = new Float32Array(size); // zeros
    this._combState1 = new ort.Tensor('float32', z, [numLayers, 1, hidden]);
    this._combState2 = new ort.Tensor('float32', z.slice(), [numLayers, 1, hidden]);

    this._normalizer = normalizer;
    this.verbose = verbose;
    this.subsampling = subsampling;
    this.windowStride = windowStride;

    // Pre-allocate reusable tensors for the decoder loop.
    // ORT-WASM tensors wrapping a typed array do NOT copy the data on creation,
    // so mutating _targetIdArray[0] before each .run() is enough — no need to
    // create (and GC) a fresh Tensor per step.
    this._targetIdArray = new Int32Array(1);
    this._targetTensor = new ort.Tensor('int32', this._targetIdArray, [1, 1]);
    this._targetLenArray = new Int32Array([1]);
    this._targetLenTensor = new ort.Tensor('int32', this._targetLenArray, [1]);
  }

  /**
   * Create ParakeetModel by downloading all required assets.
   * @param {Object} cfg
   * @param {string} cfg.encoderUrl URL to encoder-model.onnx
   * @param {string} cfg.decoderUrl URL to decoder_joint-model.onnx
   * @param {string} cfg.tokenizerUrl URL to vocab.txt or tokens.txt
   * @param {string} [cfg.preprocessorUrl] URL to nemo80/128.onnx (required when preprocessorBackend='onnx')
   * @param {('js'|'onnx')} [cfg.preprocessorBackend='js'] 'js' uses pure-JS mel.js, 'onnx' uses ONNX preprocessor
   * @param {number} [cfg.nMels=128] Number of mel bins for JS preprocessor (80 or 128)
   * @param {('webgpu'|'wasm')} [cfg.backend='webgpu']
   */
  static async fromUrls(cfg) {
    const {
      encoderUrl,
      decoderUrl,
      tokenizerUrl,
      preprocessorUrl,
      encoderDataUrl,
      decoderDataUrl,
      filenames,
      backend = 'webgpu-hybrid',
      wasmPaths,
      subsampling = 8,
      windowStride = 0.01,
      verbose = false,
      enableProfiling = false,
      enableGraphCapture,
      cpuThreads = undefined,
      // 'js' uses the pure-JS mel.js preprocessor (no ONNX download needed);
      // 'onnx' uses the OnnxPreprocessor and requires preprocessorUrl.
      preprocessorBackend = 'js',
      // Number of mel bins for JS preprocessor (80 or 128, auto-detected from
      // model config preprocessor name when available)
      nMels = 128,
    } = cfg;

    const needsPreprocessorUrl = preprocessorBackend !== 'js';
    if (!encoderUrl || !decoderUrl || !tokenizerUrl || (needsPreprocessorUrl && !preprocessorUrl)) {
      throw new Error('fromUrls requires encoderUrl, decoderUrl, tokenizerUrl and preprocessorUrl (preprocessorUrl optional when preprocessorBackend="js")');
    }

    // 1. Init ONNX Runtime
    let ortBackend = backend;
    if (backend.startsWith('webgpu')) {
        ortBackend = 'webgpu';
    }
    const ort = await initOrt({ backend: ortBackend, wasmPaths, numThreads: cpuThreads });

    // 2. Configure session options for better performance
    // Graph-capture is beneficial only when every node runs on the same EP and
    // ORT can fully record the graph (currently true only for a “strict”
    // WebGPU session).  We therefore enable it *only* when the caller passes
    // `enableGraphCapture:true` **and** the selected backend is the strict
    // WebGPU preset.  In all other scenarios (hybrid WebGPU or pure WASM)
    // it is forced off to avoid the “External buffer must be provided …”
    // runtime error on recent ORT builds.
    const graphCaptureEnabled = !!enableGraphCapture && backend === 'webgpu-strict';
    const isFullWasm = backend === 'wasm';

    const baseSessionOptions = {
      executionProviders: [],
      graphOptimizationLevel: 'all',
      executionMode: 'parallel',
      enableCpuMemArena: true,
      enableMemPattern: true,
      enableProfiling,
      enableGraphCapture: graphCaptureEnabled,
      logSeverityLevel: verbose ? 0 : 2, // 0=verbose, 2=warning
    };

    // Set execution provider based on backend
    if (backend === 'webgpu-hybrid') {
      // WebGPU with fallback to WASM for encoder; decoder may be forced to WASM-only.
      baseSessionOptions.executionProviders = [
        {
          name: 'webgpu',
          deviceType: 'gpu',
          powerPreference: 'high-performance'
        },
        'wasm'
      ];
    } else if (backend === 'webgpu-strict') {
      baseSessionOptions.executionProviders = [
        {
          name: 'webgpu',
          deviceType: 'gpu',
          powerPreference: 'high-performance'
        }
      ];
    } else if (backend === 'wasm') {
      baseSessionOptions.executionProviders = ['wasm'];
    }

    console.log(`[Parakeet.js] Creating ONNX sessions with execution mode '${backend}'. Providers:`, baseSessionOptions.executionProviders);
    if (verbose) {
        console.log('[Parakeet.js] Verbose logging enabled for ONNX Runtime.');
    }

    // Create separate options for sessions that might have external data. Each
    // source is either a single <model>.data sidecar (URL/buffer) or, for a
    // sharded fp32 encoder (scripts/shard-fp32.py), an array of { path, data }
    // shard entries; buildExternalData normalises both into the ORT array.
    const encoderSessionOptions = { ...baseSessionOptions };
    const encoderExternalData = buildExternalData(encoderDataUrl, filenames?.encoder);
    if (encoderExternalData) encoderSessionOptions.externalData = encoderExternalData;

    const decoderSessionOptions = { ...baseSessionOptions };
    const decoderExternalData = buildExternalData(decoderDataUrl, filenames?.decoder);
    if (decoderExternalData) decoderSessionOptions.externalData = decoderExternalData;

    // In hybrid mode, the decoder is always run on WASM to avoid per-step
    // stalls. In pure WASM mode, both EPs are WASM anyway.
    if (backend.startsWith('webgpu')) {
      // Force decoder to run on WASM
      decoderSessionOptions.executionProviders = ['wasm'];
    }

    // 3. Load tokenizer & preprocessor in parallel with model sessions
    // helper to create session with graceful fallback if graph capture is unsupported
    async function createSession(url, opts) {
      try {
        return await ort.InferenceSession.create(url, opts);
      } catch (e) {
        const msg = (e.message || '') + '';
        if (opts.enableGraphCapture && msg.includes('graph capture')) {
          console.warn('[Parakeet] Graph-capture unsupported for this model/backend; retrying without it');
          const retryOpts = { ...opts, enableGraphCapture: false };
          return await ort.InferenceSession.create(url, retryOpts);
        }
        throw e;
      }
    }

    const tokenizerPromise = ParakeetTokenizer.fromUrl(tokenizerUrl);
    // Use pure-JS mel spectrogram when preprocessorBackend is 'js' (default),
    // falling back to ONNX-based preprocessor when explicitly requested.
    const preprocPromise = preprocessorBackend === 'js'
      ? Promise.resolve(new JsPreprocessor({ nMels }))
      : Promise.resolve(new OnnxPreprocessor(preprocessorUrl, { backend, wasmPaths, enableProfiling, enableGraphCapture: isFullWasm ? false : graphCaptureEnabled, numThreads: cpuThreads }));

    let encoderSession, joinerSession;
    // ORT mounts externalData into a single global Module.MountedFiles map and
    // unmounts (clears) the entire map at the end of every createSession call.
    // Parallel creation races: whichever session finishes first wipes the map
    // out from under the other, surfacing as "Module.MountedFiles is not
    // available" / "Deserialize tensor ... failed" on the still-loading model.
    const hasExternalData = !!(encoderSessionOptions.externalData || decoderSessionOptions.externalData);
    if (backend === 'webgpu-hybrid' || hasExternalData) {
      // avoid parallel create to prevent double initWasm race / external-data unmount race
      encoderSession = await createSession(encoderUrl, encoderSessionOptions);
      joinerSession = await createSession(decoderUrl, decoderSessionOptions);
    } else {
      [encoderSession, joinerSession] = await Promise.all([
        createSession(encoderUrl, encoderSessionOptions),
        createSession(decoderUrl, decoderSessionOptions),
      ]);
    }

    const [tokenizer, preprocessor] = await Promise.all([tokenizerPromise, preprocPromise]);

    return new ParakeetModel({ tokenizer, encoderSession, joinerSession, preprocessor, ort, subsampling, windowStride, verbose });
  }

  async _runCombinedStep(encTensor, token, currentState = null) {
    const singleToken = typeof token === 'number' ? token : this.blankId;

    // Reuse pre-allocated tensors — just mutate the backing array
    this._targetIdArray[0] = singleToken;

    const state1 = currentState?.state1 || this._combState1;
    const state2 = currentState?.state2 || this._combState2;

    const feeds = {
      encoder_outputs: encTensor,
      targets: this._targetTensor,
      target_length: this._targetLenTensor,
      input_states_1: state1,
      input_states_2: state2,
    };

    const out = await this.joinerSession.run(feeds);
    const logits = out['outputs'];
    const outputState1 = out['output_states_1'];
    const outputState2 = out['output_states_2'];

    const vocab = this.tokenizer.id2token.length;

    // Validate the joiner output shape early so callers see a clear error
    // (mirrors upstream 9218917). Eagerly dispose `logits` on every failure
    // path to free its WASM/GPU buffer; the per-frame decode loop already
    // owns decoder-state disposal so we don't repeat it here.
    if (!logits || !logits.data || typeof logits.data.subarray !== 'function') {
      logits?.dispose?.();
      throw new Error('ParakeetModel decoder output did not include a valid `outputs` tensor.');
    }
    if (!outputState1 || !outputState2) {
      logits.dispose?.();
      throw new Error('ParakeetModel decoder output did not include both decoder state tensors.');
    }
    const data = logits.data;
    if (data.length < vocab) {
      logits.dispose?.();
      throw new Error(`ParakeetModel decoder output is too small (${data.length}) for vocab size ${vocab}.`);
    }
    const totalDim = data.length;

    // subarray(): zero-copy view into joiner output buffer.
    // Do NOT mutate tokenLogits/durLogits without copying first (.slice()).
    const tokenLogits = data.subarray(0, vocab);
    const durLogits = data.subarray(vocab, totalDim);
    if (durLogits.length === 0) {
      logits.dispose?.();
      throw new Error('ParakeetModel decoder output is missing required TDT duration logits.');
    }

    let step = 0;
    if (durLogits.length) {
      let maxVal = -Infinity;
      for (let i = 0; i < durLogits.length; ++i) if (durLogits[i] > maxVal) { maxVal = durLogits[i]; step = i; }
    }

    const newState = {
      state1: outputState1 || state1,
      state2: outputState2 || state2,
    };

    // Expose the logits tensor so callers can dispose it after consuming the
    // subarray views (prevents WASM/GPU memory leaks in long decode loops).
    // `durLogits` is the raw per-duration logit view: the greedy path uses the
    // pre-argmaxed `step`, while the MAES beam path scores over it (the duration
    // index equals the frame advance, so durLogits[i] is the log-weight of
    // advancing `i` frames).
    return { tokenLogits, step, durLogits, newState, _logitsTensor: logits };
  }

  /**
   * Dispose ORT tensors inside a decoder state object.
   * Safely skips null states, pre-allocated initial states, and tensors
   * shared with a `keepState` (to avoid double-dispose when the joiner
   * falls back to reusing its input state).
   * @param {object|null} state  - The state whose tensors should be freed.
   * @param {object|null} [keepState] - A state whose tensors must NOT be freed.
   */
  _disposeDecoderState(state, keepState = null) {
    if (!state) return;
    if (state.state1 && state.state1 !== this._combState1 && state.state1 !== keepState?.state1) {
      state.state1.dispose?.();
    }
    if (state.state2 && state.state2 !== this._combState2 && state.state2 !== keepState?.state2) {
      state.state2.dispose?.();
    }
  }

  /**
   * Argmax over a token-logit array. Pulled out of the decode loop so both the
   * greedy (width-1) path and a future beam path can share the same hot kernel.
   * The 8x unroll caches the block into v0..v7 before comparing, which sidesteps
   * redundant TypedArray index lookups and bounds checks in V8 each time a new
   * max is found. See upstream commit 514cea5.
   * @param {Float32Array} tokenLogits
   * @returns {{maxId: number, maxLogit: number}}
   */
  _pickArgmax(tokenLogits) {
    let maxLogit = -Infinity, maxId = 0;
    const tLen = tokenLogits.length;
    let ai = 0;
    for (; ai < tLen % 8; ai++) {
      if (tokenLogits[ai] > maxLogit) { maxLogit = tokenLogits[ai]; maxId = ai; }
    }
    for (; ai < tLen; ai += 8) {
      const v0 = tokenLogits[ai];
      const v1 = tokenLogits[ai+1];
      const v2 = tokenLogits[ai+2];
      const v3 = tokenLogits[ai+3];
      const v4 = tokenLogits[ai+4];
      const v5 = tokenLogits[ai+5];
      const v6 = tokenLogits[ai+6];
      const v7 = tokenLogits[ai+7];
      if (v0 > maxLogit) { maxLogit = v0; maxId = ai; }
      if (v1 > maxLogit) { maxLogit = v1; maxId = ai + 1; }
      if (v2 > maxLogit) { maxLogit = v2; maxId = ai + 2; }
      if (v3 > maxLogit) { maxLogit = v3; maxId = ai + 3; }
      if (v4 > maxLogit) { maxLogit = v4; maxId = ai + 4; }
      if (v5 > maxLogit) { maxLogit = v5; maxId = ai + 5; }
      if (v6 > maxLogit) { maxLogit = v6; maxId = ai + 6; }
      if (v7 > maxLogit) { maxLogit = v7; maxId = ai + 7; }
    }
    return { maxId, maxLogit };
  }

  /**
   * Softmax confidence (probability) of the chosen token, i.e. 1 / sum(exp((logit
   * - maxLogit)/T)) where `maxLogit` is the chosen token's logit. `temperature`
   * is the user-facing decoder temperature; at temperature 0 the model is fully
   * greedy and confidence is 1.0. Always computed on the model's true (unboosted)
   * logits so phrase boosting never distorts reported confidence. Clamps
   * degenerate outputs to a tiny positive value so the overall log-prob can't be
   * poisoned with -Infinity / NaN.
   *
   * The denom is unrolled 8x with eight independent accumulators for ILP, and
   * (logit/T - maxLogit/T) is folded into (logit - maxLogit) * invTemp so the
   * inner loop has one multiply instead of one divide per element. See upstream
   * commit 501cef3.
   * @param {Float32Array} tokenLogits
   * @param {number} maxLogit Chosen token's (true) logit.
   * @param {number} temperature
   * @returns {number}
   */
  _frameConfidence(tokenLogits, maxLogit, temperature) {
    let confVal;
    if (temperature > 1e-8) {
      const invTemp = 1.0 / temperature;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
      let i = 0;
      const len = tokenLogits.length;
      for (; i <= len - 8; i += 8) {
        s0 += Math.exp((tokenLogits[i]     - maxLogit) * invTemp);
        s1 += Math.exp((tokenLogits[i + 1] - maxLogit) * invTemp);
        s2 += Math.exp((tokenLogits[i + 2] - maxLogit) * invTemp);
        s3 += Math.exp((tokenLogits[i + 3] - maxLogit) * invTemp);
        s4 += Math.exp((tokenLogits[i + 4] - maxLogit) * invTemp);
        s5 += Math.exp((tokenLogits[i + 5] - maxLogit) * invTemp);
        s6 += Math.exp((tokenLogits[i + 6] - maxLogit) * invTemp);
        s7 += Math.exp((tokenLogits[i + 7] - maxLogit) * invTemp);
      }
      let sumExp = s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7;
      for (; i < len; i++) {
        sumExp += Math.exp((tokenLogits[i] - maxLogit) * invTemp);
      }
      confVal = 1 / sumExp;
    } else {
      // At temperature=0, the model is fully greedy, confidence is 1.0.
      confVal = 1.0;
    }
    if (!Number.isFinite(confVal) || confVal <= 0) confVal = 1e-10;
    return confVal;
  }

  /**
   * Frame-advancement + emission rule for one decoded token, matching NeMo /
   * onnx-asr reference exactly. Pure (depends only on its args + model
   * constants) so the greedy loop and a future beam decoder share identical
   * timing semantics:
   *   - TDT duration > 0: advance by `step`, reset the per-frame emit counter.
   *   - blank OR max-tokens reached: advance by `frameStride`, reset counter.
   *   - else (non-blank, step 0, under cap): stay on the frame to emit again.
   * @param {number} t Current encoder-frame pointer.
   * @param {number} emittedAtFrame Tokens already emitted at this frame.
   * @param {number} id Chosen token id.
   * @param {number} step TDT duration argmax.
   * @param {number} frameStride
   * @param {number} [maxSymbols] Per-frame emission cap. Defaults to the model's
   *   greedy `maxTokensPerStep`; the MAES beam path passes `maesNumSteps` here so
   *   the per-frame expansion budget is the MAES knob rather than the greedy cap.
   * @returns {{emit: boolean, isBlank: boolean, nextT: number, nextEmitted: number}}
   */
  _advanceDecision(t, emittedAtFrame, id, step, frameStride, maxSymbols = this.maxTokensPerStep) {
    const isBlank = (id === this.blankId);
    let nextT, nextEmitted;
    if (step > 0) {
      nextT = t + step;
      nextEmitted = 0;
    } else if (isBlank || emittedAtFrame + 1 >= maxSymbols) {
      nextT = t + frameStride;
      nextEmitted = 0;
    } else {
      nextT = t;
      nextEmitted = emittedAtFrame + 1;
    }
    return { emit: !isBlank, isBlank, nextT, nextEmitted };
  }

  /**
   * Log-sum-exp of a logit array at temperature 1 (the true-model log partition
   * function). The beam decoder uses it to turn raw logits into comparable
   * log-probabilities for ranking. Two passes: max for numerical stability,
   * then the exponential sum.
   * @param {Float32Array} logits
   * @returns {number}
   */
  _logSumExp(logits) {
    let m = -Infinity;
    for (let i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
    if (!Number.isFinite(m)) return m;
    let s = 0;
    for (let i = 0; i < logits.length; i++) s += Math.exp(logits[i] - m);
    return m + Math.log(s);
  }

  /**
   * Numerically stable log(exp(a) + exp(b)). Used by the beam decoder to
   * recombine the scores (log-probabilities) of merged duplicate hypotheses.
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  _logAddExp(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const m = Math.max(a, b);
    return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
  }

  /**
   * Indices of the `k` largest values in `logits` (unordered). O(V*k), cheap for
   * the small beam widths this decoder targets, and avoids sorting the whole
   * vocab each step.
   * @param {Float32Array} logits
   * @param {number} k
   * @returns {number[]}
   */
  _topK(logits, k) {
    const idx = [];
    const val = [];
    for (let i = 0; i < logits.length; i++) {
      const v = logits[i];
      if (idx.length < k) {
        idx.push(i); val.push(v);
      } else {
        let mi = 0; // index (within the kept set) of the current smallest
        for (let j = 1; j < k; j++) if (val[j] < val[mi]) mi = j;
        if (v > val[mi]) { val[mi] = v; idx[mi] = i; }
      }
    }
    return idx;
  }

  /**
   * Expand one beam hypothesis by a single joiner step (the per-hypothesis core
   * of the MAES decoder). Returns the candidate continuations and the shared next
   * decoder state.
   *
   * MAES adaptive expansion happens here in three stages, matching NeMo's
   * `modified_adaptive_expansion_search`, which expands over (token, duration)
   * pairs rather than a single argmaxed duration:
   *   - Over-generation (`maes_expansion_beta`): the caller's `expandK` is
   *     `beamWidth + beta`, so we pull the top-(beamWidth+beta) tokens, plus a
   *     forced blank so the hypothesis can always advance in time.
   *   - Duration branching: every kept token is crossed with every TDT duration,
   *     scoring `token_logp + duration_logp` (both temperature-1 log-softmax).
   *     The top-`expandK` (token, duration) pairs over that flattened space
   *     survive, so the beam can pick a non-argmax duration when its joint
   *     log-prob wins. Blank with duration 0 is forced to duration 1
   *     (`min_non_zero_duration_idx`) so it still advances a frame.
   *   - Adaptive prune (`maes_expansion_gamma`): non-blank pairs whose joint
   *     log-probability is more than `maesExpansionGamma` below the best pair are
   *     dropped. On a confident frame one pair dominates and every other falls
   *     below the threshold, so the hypothesis branches like greedy; on an
   *     ambiguous frame several survive and the beam widens. This is what makes
   *     the effective width adapt per token.
   *
   * Fan-out per hypothesis is `expandK * |durations|` pairs before the topk and
   * gamma prune; `|durations|` is small (typically 5) so the extra cost is modest.
   *
   * Each candidate carries:
   *   - id / isBlank / emit / step (the branched TDT duration, per candidate)
   *   - confVal: frame confidence at the UI temperature on the TRUE (unboosted)
   *     token logits, for output confidence_scores (matches greedy semantics;
   *     duration does not enter confVal so overallLogProb stays token-only).
   *   - rankDelta: boosted joint (token+duration) log-probability at temperature
   *     1, for ranking/pruning. It is independent of the UI temperature so
   *     ranking still discriminates at temperature 0 (where confVal collapses to
   *     1.0).
   *   - active: the boosting trie's active-node set for the child (advanced for
   *     emitted tokens, inherited for blank). The trie's `active` field is
   *     borrowed per-hyp via assignment so phraseBoost.js needs no change.
   *
   * The caller owns `newState`: it must retain it for surviving emit-children
   * and dispose it if no emit-child references it.
   * @returns {{cands: Array<object>, newState: object}}
   */
  async _expandHyp(hyp, transposed, D, opts) {
    const { temperature, expandK, maesExpansionGamma, phraseBoost } = opts;
    const frameBuf = transposed.subarray(hyp.t * D, (hyp.t + 1) * D);
    const encTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);
    // The beam scores over the raw duration logits (see below), so it ignores
    // the pre-argmaxed `step` the greedy path consumes.
    const { tokenLogits, durLogits, newState, _logitsTensor } = await this._runCombinedStep(encTensor, hyp.lastTok, hyp.state);

    // Boost selection: borrow the trie's active set for this hypothesis.
    if (phraseBoost) phraseBoost.active = hyp.active;
    const boostSaved = phraseBoost ? phraseBoost.applyBoost(tokenLogits) : null;

    // Over-generate (top-(beamWidth+beta)) over the (possibly boosted) logits,
    // and always allow blank so the hypothesis can choose to advance time.
    const topIds = this._topK(tokenLogits, expandK);
    if (!topIds.includes(this.blankId)) topIds.push(this.blankId);

    // Capture boosted values, then restore so confidence/ranking use the true
    // distribution. boostBonus is the additive reward boosting applied (0 when
    // no trie or the token is not boosted).
    const boostedVal = new Map();
    for (const id of topIds) boostedVal.set(id, tokenLogits[id]);
    if (boostSaved) phraseBoost.restore(tokenLogits, boostSaved);

    const logZ = this._logSumExp(tokenLogits);   // temperature-1 token partition
    const durZ = this._logSumExp(durLogits);     // temperature-1 duration partition
    const nDur = durLogits.length;
    // Blank with duration 0 cannot advance time; force it to the smallest
    // non-zero duration (NeMo's min_non_zero_duration_idx == 1 under the
    // duration-index == frame-advance convention this codebase uses).
    const minNonZeroDur = nDur > 1 ? 1 : 0;

    // Per-token boosted log-prob (rankDelta's token term), computed once and
    // reused across every duration that token is crossed with.
    const tokenLP = new Map();
    for (const id of topIds) {
      const trueLogit = tokenLogits[id];
      const boostBonus = boostedVal.get(id) - trueLogit;
      tokenLP.set(id, { trueLogit, logp: (trueLogit - logZ) + boostBonus });
    }

    // Cross every kept token with every TDT duration; score the joint
    // (token+duration) log-prob. Pairs with zero probability (a -Infinity
    // duration logit) carry no mass, so skip them.
    const pairs = [];
    let maxTotal = -Infinity;
    for (const id of topIds) {
      const isBlank = (id === this.blankId);
      const { trueLogit, logp: tlp } = tokenLP.get(id);
      for (let d = 0; d < nDur; d++) {
        const total = tlp + (durLogits[d] - durZ);
        if (!Number.isFinite(total)) continue;
        // The score keeps duration `d`'s log-prob even when blank's frame
        // advance is forced off 0 (NeMo forces the advance, not the score).
        const stepEff = (isBlank && d === 0) ? minNonZeroDur : d;
        pairs.push({ id, isBlank, trueLogit, rankDelta: total, step: stepEff });
        if (total > maxTotal) maxTotal = total;
      }
    }

    // Keep the top-`expandK` (token, duration) pairs (NeMo topks the flattened
    // space to max_candidates), then guarantee a blank advance survives even if
    // it fell outside that cut, so the hypothesis can always move forward in time.
    pairs.sort((a, b) => b.rankDelta - a.rankDelta);
    const kept = pairs.slice(0, expandK);
    if (!kept.some(p => p.isBlank)) {
      const bestBlank = pairs.find(p => p.isBlank); // pairs is sorted desc
      if (bestBlank) kept.push(bestBlank);
    }

    // Adaptive (MAES) prune: drop non-blank pairs more than `gamma` log-prob
    // below the best pair. Blank pairs always survive (advance guarantee).
    // Confidence + trie advance are token-only, so cache them per token id.
    const threshold = maxTotal - maesExpansionGamma;
    const cands = [];
    const confCache = new Map();
    const activeCache = new Map();
    for (const { id, isBlank, trueLogit, rankDelta, step } of kept) {
      if (!isBlank && rankDelta < threshold) continue;
      let confVal = confCache.get(id);
      if (confVal === undefined) {
        confVal = this._frameConfidence(tokenLogits, trueLogit, temperature);
        confCache.set(id, confVal);
      }
      let active = hyp.active;
      if (!isBlank) {
        active = activeCache.get(id);
        if (active === undefined) {
          if (phraseBoost) {
            phraseBoost.active = hyp.active;
            phraseBoost.advance(id);
            active = phraseBoost.active;
          } else {
            active = hyp.active;
          }
          activeCache.set(id, active);
        }
      }
      cands.push({ id, isBlank, emit: !isBlank, step, confVal, rankDelta, active });
    }

    _logitsTensor?.dispose?.();
    encTensor.dispose?.();
    return { cands, newState };
  }

  /**
   * NeMo's last-mAES-step blank closure (the `n == maes_num_steps - 1` branch of
   * `modified_adaptive_expansion_search`). A non-blank zero-duration emission
   * that exhausts the per-frame symbol budget (`maesNumSteps`) cannot emit again
   * on this frame, so NeMo does not just advance it one frame: it closes the
   * hypothesis with an implicit blank, advancing by the argmax (forced non-zero)
   * TDT duration and folding `logp(blank) + logp(best_dur)` into the score.
   * Without this the hypothesis would carry only its own (token, duration-0)
   * score and land on `t + frameStride`, leaving its score incomparable to
   * NeMo's and its landing frame wrong whenever the argmax duration is > 1.
   *
   * Mutates `child` in place: bumps `score` and resets `t` to the closure frame.
   * `overallLogProb` (the token-only confidence accumulator) is left untouched
   * because the closing blank emits no token, matching greedy semantics. The
   * joiner state minted here is a throwaway (a blank does not advance the
   * decoder), so it is disposed; `child` keeps its post-emit state.
   * @param {object} child Post-emit child hypothesis (carries the new state/lastTok).
   * @param {number} parentT Frame the emission happened on (the closure frame).
   * @param {Float32Array} transposed
   * @param {number} D
   */
  async _applyBlankClosure(child, parentT, transposed, D) {
    const frameBuf = transposed.subarray(parentT * D, (parentT + 1) * D);
    const encTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);
    const { tokenLogits, durLogits, newState, _logitsTensor } =
      await this._runCombinedStep(encTensor, child.lastTok, child.state);

    const blankLogp = tokenLogits[this.blankId] - this._logSumExp(tokenLogits);

    // Argmax duration, forced to the smallest non-zero index so the closing
    // blank always advances the frame (NeMo's min_non_zero_duration_idx == 1
    // under this model's identity-indexed duration head).
    let bestIdx = 0, bestVal = -Infinity;
    for (let d = 0; d < durLogits.length; d++) {
      if (durLogits[d] > bestVal) { bestVal = durLogits[d]; bestIdx = d; }
    }
    if (bestIdx === 0) bestIdx = durLogits.length > 1 ? 1 : 0;
    const durLogp = durLogits[bestIdx] - this._logSumExp(durLogits);

    child.score += blankLogp + durLogp;
    child.t = parentT + bestIdx;

    _logitsTensor?.dispose?.();
    encTensor.dispose?.();
    if (newState) this._disposeDecoderState(newState);
  }

  /**
   * Emitted-token id sequence of a backpointer hypothesis, oldest-first. Walks
   * the parent chain (cheap at the small beam widths this decoder targets).
   * @param {object} hyp
   * @returns {number[]}
   */
  _hypIds(hyp) {
    const ids = [];
    for (let node = hyp; node && node.parent; node = node.parent) {
      if (node.emit) ids.push(node.id);
    }
    ids.reverse();
    return ids;
  }

  /**
   * Prefix-search recombination (NeMo's `prefix_search` / `maes_prefix_alpha`).
   * Run at the start of each round on the current beam: whenever a shorter
   * hypothesis is a strict prefix of a longer one and they sit on the SAME
   * encoder frame, fold the probability of extending the short hypothesis into
   * the long one's tokens (at duration 0, since the extension must not advance
   * the frame) into the long hypothesis' score via log-sum-exp. This stops the
   * beam from double-counting the shared prefix and credits the longer path with
   * the mass it would otherwise lose to its own prefix.
   *
   * `maesPrefixAlpha` bounds the length gap considered (NeMo default 1). The
   * extension is scored on the TRUE model distribution (phrase-boost is a
   * per-emission search bias applied during expansion, not re-applied here). All
   * decoder states allocated while scoring are throwaway and disposed; the
   * hypotheses' own stored states are never touched (scores only are updated).
   * @param {Array<object>} beam
   * @param {Float32Array} transposed
   * @param {number} D
   * @param {object} opts - { maesPrefixAlpha }
   */
  async _prefixSearch(beam, transposed, D, opts) {
    const { maesPrefixAlpha } = opts;
    if (maesPrefixAlpha <= 0 || beam.length < 2) return;

    // Only hypotheses on the same frame can recombine (NeMo's last_frame group).
    const byFrame = new Map();
    for (const h of beam) {
      const g = byFrame.get(h.t);
      if (g) g.push(h); else byFrame.set(h.t, [h]);
    }

    for (const [t, group] of byFrame) {
      if (group.length < 2) continue;
      const entries = group.map(h => ({ hyp: h, ids: this._hypIds(h) }));
      // Longest first so a long hypothesis can absorb every shorter prefix.
      entries.sort((a, b) => b.ids.length - a.ids.length);
      const frameBuf = transposed.subarray(t * D, (t + 1) * D);

      for (let i = 0; i < entries.length; i++) {
        const longE = entries[i];
        for (let j = i + 1; j < entries.length; j++) {
          const shortE = entries[j];
          const gap = longE.ids.length - shortE.ids.length;
          if (gap < 1 || gap > maesPrefixAlpha) continue;
          // shortE must be a strict prefix of longE.
          let isPrefix = true;
          for (let k = 0; k < shortE.ids.length; k++) {
            if (shortE.ids[k] !== longE.ids[k]) { isPrefix = false; break; }
          }
          if (!isPrefix) continue;

          // Score the extension tokens (forced) from the short hypothesis'
          // decoder state, all at duration 0 on frame `t`.
          const extension = longE.ids.slice(shortE.ids.length);
          let state = shortE.hyp.state;
          let prevTok = shortE.hyp.lastTok;
          let extLogp = 0;
          for (const tok of extension) {
            const enc = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);
            const { tokenLogits, durLogits, newState, _logitsTensor } =
              await this._runCombinedStep(enc, prevTok, state);
            extLogp += (tokenLogits[tok] - this._logSumExp(tokenLogits))
              + (durLogits[0] - this._logSumExp(durLogits));
            _logitsTensor?.dispose?.();
            enc.dispose?.();
            if (state !== shortE.hyp.state) this._disposeDecoderState(state);
            state = newState;
            prevTok = tok;
          }
          if (state !== shortE.hyp.state) this._disposeDecoderState(state);

          longE.hyp.score = this._logAddExp(longE.hyp.score, shortE.hyp.score + extLogp);
        }
      }
    }
  }

  /**
   * Multi-hypothesis TDT beam search over the encoder frames, using Modified
   * Adaptive Expansion Search (MAES, Kim et al. 2020 — NeMo's `maes` strategy).
   * Returns the winning hypothesis' decoded ids and per-frame/per-token
   * accumulators. Full-file only: never returns a decoder state, and disposes
   * every ORT state tensor it allocates via refcounting (PLAN.md Q1).
   *
   * Frame-synchronous (matches NeMo's `maes` loop): an outer pass over encoder
   * frames `timeIdx`, with a global `keptHyps` pool partitioned each step into
   * the hypotheses due at this frame (`t === timeIdx`) and the future ones
   * (`t > timeIdx`) that wait their turn. Hypotheses are backpointer nodes
   * (parent chain) so per-step accumulators are reconstructed once at the end.
   * Processing all hypotheses on a frame together is what lets duplicate-merge
   * and prefix-search recombination actually co-occur, unlike a label-synchronous
   * loop (each hyp owning its own frame pointer) where they rarely line up.
   *
   * Per frame: prefix-search recombination over the due hypotheses; then an inner
   * expansion loop (up to `maesNumSteps`) that re-expands zero-duration emissions
   * on the same frame while sending duration>0 children to the future pool; a
   * zero-duration emission that exhausts the `maesNumSteps` budget is closed with
   * NeMo's implicit best-duration blank (see `_applyBlankClosure`) rather than a
   * bare advance; then duplicate-merge over the pool and prune to `beamWidth`.
   *
   * MAES knobs (defaults match NeMo): `beamWidth` is the global beam cap;
   * `maesExpansionBeta` over-generates to top-(beamWidth+beta) per hypothesis;
   * `maesExpansionGamma` adaptively prunes those expansions by log-prob (see
   * `_expandHyp`); `maesNumSteps` caps symbols emitted per frame; `maesPrefixAlpha`
   * bounds prefix-search recombination (see `_prefixSearch`; 0 disables it). The
   * duration index equals the frame advance throughout (the model's TDT duration
   * head is an identity-indexed skip count).
   * @returns {{ids: number[], tokenTimes: Array, tokenConfs: number[], frameConfs: number[], overallLogProb: number}}
   */
  async _decodeBeam(transposed, D, Tenc, opts) {
    const { beamWidth, frameStride, phraseBoost, returnTimestamps, returnConfidences, timeStride,
            maesNumSteps, maesExpansionBeta, maesExpansionGamma, maesPrefixAlpha } = opts;

    if (Tenc <= 0) return { ids: [], tokenTimes: [], tokenConfs: [], frameConfs: [], overallLogProb: 0 };

    // Per-hypothesis expansion budget: top-(beamWidth+beta) tokens. Threaded into
    // _expandHyp alongside the gamma threshold via the shared opts object below.
    const expandK = beamWidth + maesExpansionBeta;
    const expandOpts = { temperature: opts.temperature, phraseBoost, expandK, maesExpansionGamma };

    // Build one backpointer child node from a parent hypothesis and one of its
    // (token, duration) expansion candidates.
    const makeChild = (hyp, c, newState) => {
      const dec = this._advanceDecision(hyp.t, hyp.emittedAtFrame, c.id, c.step, frameStride, maesNumSteps);
      return {
        parent: hyp,
        emit: c.emit,
        id: c.emit ? c.id : null,
        confVal: c.confVal,
        tokenTime: (c.emit && returnTimestamps)
          ? [hyp.t * timeStride, (hyp.t + (c.step > 0 ? c.step : 1)) * timeStride]
          : null,
        state: c.emit ? newState : hyp.state,
        t: dec.nextT,
        emittedAtFrame: dec.nextEmitted,
        overallLogProb: hyp.overallLogProb + Math.log(c.confVal),
        score: hyp.score + c.rankDelta,
        active: c.active,
        lastTok: c.emit ? c.id : hyp.lastTok,
        // Incremental emitted-token sequence identity (blank leaves it
        // unchanged). Used to detect duplicate hypotheses for merging.
        seqKey: c.emit ? hyp.seqKey + c.id + ',' : hyp.seqKey,
      };
    };

    const rootActive = phraseBoost ? phraseBoost.active : null; // caller already reset()
    let keptHyps = [{
      parent: null, emit: false, id: null, confVal: null, tokenTime: null,
      state: null, t: 0, emittedAtFrame: 0, overallLogProb: 0, score: 0,
      active: rootActive, lastTok: this.blankId, seqKey: '',
    }];
    let best = null;     // highest-scoring finished hypothesis (t >= Tenc)
    let workFrames = 0;  // frames that actually carried hypotheses (for yield cadence)

    try {
      for (let timeIdx = 0; timeIdx < Tenc && keptHyps.length; timeIdx++) {
        const current = keptHyps.filter(h => h.t === timeIdx);
        if (!current.length) continue; // no hypothesis is due here; skip cheaply
        if (workFrames++ % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));

        const futures = keptHyps.filter(h => h.t > timeIdx); // wait for their frame

        // Prefix-search recombination over the due hypotheses (scores only;
        // never mutates their stored decoder states). NeMo runs this once per
        // frame, before expansion.
        await this._prefixSearch(current, transposed, D, { maesPrefixAlpha });

        // Per-frame mark-and-sweep seed: every decoder state in play this frame
        // (all current + future hypotheses), plus every newState minted below.
        // Anything not referenced by the post-frame keptHyps (or best) is freed
        // at the end. Set semantics make shared states (blank children reuse the
        // parent's state; emit siblings share one newState) safe without refcounts.
        const disposable = new Set();
        for (const h of keptHyps) disposable.add(h.state);

        const produced = []; // duration>0 children, advancing to a future frame
        let working = current; // hypotheses still emitting at this frame
        for (let n = 0; n < maesNumSteps && working.length; n++) {
          const stayed = []; // zero-duration emissions, re-expanded on this frame
          for (const hyp of working) {
            const { cands, newState } = await this._expandHyp(hyp, transposed, D, expandOpts);
            if (newState) disposable.add(newState);
            for (const c of cands) {
              const child = makeChild(hyp, c, newState);
              // Last-mAES-step blank closure (NeMo): a non-blank zero-duration
              // emission that hits the per-frame symbol cap is closed with an
              // implicit best-duration blank instead of a bare one-frame advance,
              // so its score and landing frame match
              // modified_adaptive_expansion_search. The cap condition mirrors
              // _advanceDecision's forced-advance branch exactly.
              if (c.emit && c.step === 0 && hyp.emittedAtFrame + 1 >= maesNumSteps) {
                await this._applyBlankClosure(child, hyp.t, transposed, D);
              }
              if (child.t >= Tenc) {
                // Finished: keep only the running best (finished scores are final).
                if (best === null || child.score > best.score) {
                  if (best) disposable.add(best.state); // old best may now be free
                  best = child;
                }
              } else if (child.t > timeIdx) {
                produced.push(child);
              } else {
                stayed.push(child); // emitted at duration 0: still on this frame
              }
            }
          }
          // Bound the zero-duration fan-out the same way the beam is bounded.
          stayed.sort((a, b) => b.score - a.score);
          working = stayed.slice(0, beamWidth);
        }

        // Merge duplicate hypotheses (NeMo's merge_duplicate_hypotheses) over the
        // surviving futures + this frame's new children: any two with the same
        // emitted-token sequence AND frame are the same hypothesis reached by
        // different routes, so collapse them into one whose score is the
        // log-sum-exp of the group (recombining their probability mass). The
        // highest-scoring member is the representative; the others never enter
        // keptHyps, so the sweep below frees any state they alone held.
        const merged = new Map();
        for (const child of futures.concat(produced)) {
          const key = `${child.seqKey}@${child.t}`;
          const rep = merged.get(key);
          if (rep === undefined) {
            merged.set(key, child);
          } else if (child.score > rep.score) {
            child.score = this._logAddExp(child.score, rep.score);
            merged.set(key, child);
          } else {
            rep.score = this._logAddExp(rep.score, child.score);
          }
        }

        keptHyps = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth);

        // Sweep: free every in-play state no surviving hypothesis (or best) points at.
        const keep = new Set();
        for (const h of keptHyps) keep.add(h.state);
        if (best) keep.add(best.state);
        for (const s of disposable) if (s && !keep.has(s)) this._disposeDecoderState(s);
      }
    } finally {
      // Dispose whatever is still live (the decoder never returns a state). On
      // the normal path keptHyps empties as hypotheses finish, so this just frees
      // best; on an error mid-decode it frees the live pool too. Deduped so a
      // shared state is never double-disposed.
      const live = new Set();
      for (const h of keptHyps) if (h.state) live.add(h.state);
      if (best && best.state) live.add(best.state);
      for (const s of live) this._disposeDecoderState(s);
    }

    // Reconstruct the winning path from the backpointer chain (seed has no
    // frame). Only scalars/ids are read here, so the disposed states don't matter.
    const idsR = [], framesR = [], timesR = [], confsR = [];
    let overall = 0;
    if (best) {
      overall = best.overallLogProb;
      for (let node = best; node && node.parent; node = node.parent) {
        framesR.push(node.confVal);
        if (node.emit) {
          idsR.push(node.id);
          if (returnTimestamps) timesR.push(node.tokenTime);
          if (returnConfidences) confsR.push(node.confVal);
        }
      }
      idsR.reverse(); framesR.reverse(); timesR.reverse(); confsR.reverse();
    }
    return { ids: idsR, tokenTimes: timesR, tokenConfs: confsR, frameConfs: framesR, overallLogProb: overall };
  }

  async computeFeatures(audio, sampleRate = 16000) {
    const { features, length } = await this.preprocessor.process(audio);
    const T = length; // number of frames returned by preprocessor
    const melBins = features.length / T;
    return { features, T, melBins };
  }

  /**
   * Transcribe 16-kHz mono PCM. Returns full rich output (timestamps/confidences opt-in).
   */
  async transcribe(audio, sampleRate = 16000, opts = {}) {
    const {
      returnTimestamps = false,
      returnConfidences = false,
      temperature = 1.2,
      debug = false,
      enableProfiling = false,
      skipCMVN = false,
      frameStride = 1,
      previousDecoderState = null,
      returnDecoderState = false,
      timeOffset = 0,
      phraseBoost = null,
      beamWidth = 1,
      // MAES knobs (used only when beamWidth > 1). Defaults match NeMo's `maes`.
      maesNumSteps = 2,
      maesExpansionBeta = 2,
      maesExpansionGamma = 2.3,
      maesPrefixAlpha = 1,
    } = opts;

    // Beam search is full-file only: a beam of N hypotheses cannot be serialized
    // into the single decoder state the streaming path round-trips, so width > 1
    // is forced back to greedy whenever decoder-state continuity is requested.
    let effBeamWidth = Math.max(1, Math.floor(beamWidth) || 1);
    if (returnDecoderState && effBeamWidth > 1) {
      console.warn('[Parakeet] beamWidth>1 is unsupported with decoder-state continuity (streaming); forcing width 1.');
      effBeamWidth = 1;
    }

    // Collect per-stage timings only when the caller opts in. Default off so a
    // production transcribe() doesn't spam the console; `verbose: true` at model
    // construction also flips it on for development.
    const perfEnabled = this.verbose || debug || enableProfiling;
    let t0, tPreproc = 0, tEncode = 0, tDecode = 0, tToken = 0;
    if (perfEnabled) t0 = performance.now();

    // ORT-allocated resources tracked at function scope so the finally block
    // can free them if any await between here and the normal dispose calls
    // throws. Without this, an encoder/joiner failure mid-run pins encoder
    // outputs and per-frame tensors in the WASM/GPU heap until the page
    // reloads, which is fatal for chunked long-audio sessions.
    let input = null;
    let lenTensor = null;
    let enc = null;
    let inFlightEncTensor = null;
    let decoderState = null;
    let externalInitialState = null;
    let finalDecoderState = null;

    try {

    // 1. Feature extraction (ONNX pre-processor)
    let features, T, melBins;
    if (perfEnabled) {
      const s = performance.now();
      ({ features, T, melBins } = await this.computeFeatures(audio, sampleRate));
      tPreproc = performance.now() - s;
    } else {
      ({ features, T, melBins } = await this.computeFeatures(audio, sampleRate));
    }

    // 2. Encode entire utterance
    input = new this.ort.Tensor('float32', features, [1, melBins, T]);
    lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]);
    let encOut;
    if (perfEnabled) {
      const s = performance.now();
      encOut = await this.encoderSession.run({ audio_signal: input, length: lenTensor });
      tEncode = performance.now() - s;
    } else {
      encOut = await this.encoderSession.run({ audio_signal: input, length: lenTensor });
    }
    enc = encOut['outputs'] ?? Object.values(encOut)[0];
    // Some encoder ONNX exports emit auxiliary outputs (e.g. encoded_length).
    // Dispose anything other than the main `enc` tensor; otherwise those
    // tensors leak into the WASM heap, one per transcribe() call.
    for (const v of Object.values(encOut)) {
      if (v !== enc) v?.dispose?.();
    }
    // Free encoder input tensors now that the encoder has produced its output —
    // long sessions (continuous recording) would otherwise accumulate them.
    input.dispose?.(); input = null;
    lenTensor.dispose?.(); lenTensor = null;

    // Transpose encoder output [B, D, T] ➔ [T, D] for B=1.
    // t-outer / d-inner gives sequential writes to `transposed`, and the
    // d-loop is unrolled 8x to cut V8's bounds-checking overhead. See
    // upstream commit 85cf1fc for the benchmark notes.
    const [ , D, Tenc ] = enc.dims;
    const transposed = new Float32Array(Tenc * D);
    const encData = enc.data;
    for (let t = 0; t < Tenc; t++) {
      const tOffset = t * D;
      let d = 0;
      for (; d <= D - 8; d += 8) {
        const srcOffset = d * Tenc + t;
        transposed[tOffset + d]     = encData[srcOffset];
        transposed[tOffset + d + 1] = encData[srcOffset + Tenc];
        transposed[tOffset + d + 2] = encData[srcOffset + 2 * Tenc];
        transposed[tOffset + d + 3] = encData[srcOffset + 3 * Tenc];
        transposed[tOffset + d + 4] = encData[srcOffset + 4 * Tenc];
        transposed[tOffset + d + 5] = encData[srcOffset + 5 * Tenc];
        transposed[tOffset + d + 6] = encData[srcOffset + 6 * Tenc];
        transposed[tOffset + d + 7] = encData[srcOffset + 7 * Tenc];
      }
      for (; d < D; d++) {
        transposed[tOffset + d] = encData[d * Tenc + t];
      }
    }

    // Encoder output has been copied into `transposed`; free its WASM/GPU
    // buffer before entering the decode loop. With chunked long-audio
    // transcription this single dispose is the biggest leak fix in the file.
    enc.dispose?.(); enc = null;

    // --- Decode -------------------------------------------------------
    // Phrase boosting: reset the trie's active state per decode window (Q4) so
    // matches start fresh. When no trie is supplied, this whole path is inert
    // and the default decoding behavior is unchanged.
    phraseBoost?.reset();
    externalInitialState = previousDecoderState || null;
    const decStartTime = perfEnabled ? performance.now() : 0;
    const TIME_STRIDE = this.subsampling * this.windowStride;

    // Winning hypothesis' accumulators, populated by whichever decode path runs.
    let ids, tokenTimes, tokenConfs, frameConfs, overallLogProb;

    if (effBeamWidth === 1) {
      // --- Greedy (= beam width 1) ------------------------------------
      // A single hypothesis carrying its own frame pointer, decoder state,
      // emitted ids and per-frame accumulators. Bit-for-bit identical to the
      // original greedy decoder.
      const hyp = {
        ids: [],
        state: previousDecoderState || null,
        t: 0,
        emittedAtFrame: 0,
        tokenTimes: [],
        tokenConfs: [],
        frameConfs: [],
        overallLogProb: 0,
      };
      decoderState = hyp.state; // keep the function-scope alias in sync for finally

      while (hyp.t < Tenc) {
        // Yield to browser every ~50 frames to keep UI responsive
        if (hyp.t % 50 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const frameBuf = transposed.subarray(hyp.t * D, (hyp.t + 1) * D);
        inFlightEncTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);

        const prevTok = hyp.ids.length ? hyp.ids[hyp.ids.length - 1] : this.blankId;
        const { tokenLogits, step, newState, _logitsTensor } = await this._runCombinedStep(inFlightEncTensor, prevTok, hyp.state);

        // Phrase boosting (shallow fusion): add the trie's rewards into the
        // token logits before the argmax so the per-step choice is biased
        // toward continuing/starting a boost phrase. Restore right after so
        // confidence/log-prob below stay computed on the true distribution.
        // Argmax is invariant to a positive temperature divide, so we argmax
        // the raw logits directly (avoids the Infinity/NaN trap at temp 0).
        const boostSaved = phraseBoost ? phraseBoost.applyBoost(tokenLogits) : null;
        let { maxId, maxLogit } = this._pickArgmax(tokenLogits);

        // _frameConfidence assumes maxLogit == tokenLogits[maxId] (chosen
        // token's numerator is 1), so reset maxLogit to the true logit.
        if (boostSaved) {
          phraseBoost.restore(tokenLogits, boostSaved);
          maxLogit = tokenLogits[maxId];
        }

        const confVal = this._frameConfidence(tokenLogits, maxLogit, temperature);
        hyp.frameConfs.push(confVal);
        hyp.overallLogProb += Math.log(confVal);

        const dec = this._advanceDecision(hyp.t, hyp.emittedAtFrame, maxId, step, frameStride);

        if (dec.emit) {
          hyp.ids.push(maxId);
          // Advance the boosting trie by the emitted token (blank leaves it
          // unchanged, so no advance in the else branch below).
          phraseBoost?.advance(maxId);
          if (returnTimestamps) {
            const durFrames = step > 0 ? step : 1;
            const start = hyp.t * TIME_STRIDE;
            const end = (hyp.t + durFrames) * TIME_STRIDE;
            hyp.tokenTimes.push([start, end]);
          }
          if (returnConfidences) hyp.tokenConfs.push(confVal);
          // Only adopt the new decoder state when a non-blank token is emitted.
          // Free the previous state (unless caller-owned) before reassigning.
          if (hyp.state && hyp.state !== newState && hyp.state !== externalInitialState) {
            this._disposeDecoderState(hyp.state, newState);
          }
          hyp.state = newState;
          decoderState = hyp.state;
        } else {
          // Blank token: keep the previous state and discard newState.
          if (newState && newState !== hyp.state) {
            this._disposeDecoderState(newState, hyp.state);
          }
        }

        // Dispose the joiner logits tensor now that subarray views are consumed
        _logitsTensor?.dispose?.();
        // Dispose the per-frame encoder tensor. Without this, each decoded
        // frame leaks its WASM-side handle (~450k handles for a 1h audio at
        // sub=8/stride=0.01s).
        inFlightEncTensor.dispose?.();
        inFlightEncTensor = null;

        hyp.t = dec.nextT;
        hyp.emittedAtFrame = dec.nextEmitted;
      }

      // Dispose final decoder state unless the caller asked to keep it for a
      // future call. When returning state, the caller becomes its owner.
      finalDecoderState = hyp.state;
      if (!returnDecoderState) {
        this._disposeDecoderState(hyp.state);
      }
      decoderState = null;

      ids = hyp.ids;
      tokenTimes = hyp.tokenTimes;
      tokenConfs = hyp.tokenConfs;
      frameConfs = hyp.frameConfs;
      overallLogProb = hyp.overallLogProb;
    } else {
      // --- Beam search (width > 1) ------------------------------------
      // Full-file only (the streaming guard above forced width 1 when state
      // continuity is requested), so the beam never returns/owns a decoder
      // state and disposes everything it allocates internally.
      const out = await this._decodeBeam(transposed, D, Tenc, {
        beamWidth: effBeamWidth,
        temperature,
        frameStride,
        phraseBoost,
        returnTimestamps,
        returnConfidences,
        timeStride: TIME_STRIDE,
        maesNumSteps: Math.max(1, Math.floor(maesNumSteps) || 1),
        maesExpansionBeta: Math.max(0, Math.floor(maesExpansionBeta) || 0),
        maesExpansionGamma: Number.isFinite(maesExpansionGamma) ? maesExpansionGamma : 2.3,
        maesPrefixAlpha: Math.max(0, Math.floor(maesPrefixAlpha) || 0),
      });
      ids = out.ids;
      tokenTimes = out.tokenTimes;
      tokenConfs = out.tokenConfs;
      frameConfs = out.frameConfs;
      overallLogProb = out.overallLogProb;
      finalDecoderState = null;
      decoderState = null;
    }

    if (perfEnabled) {
      tDecode = performance.now() - decStartTime;
    }

    let tokenStart;
    if (perfEnabled) tokenStart = performance.now();
    const rawText = this.tokenizer.decode(ids);
    if (this.verbose) console.log('[Parakeet.js] Raw decoded text:', rawText);
    const text = this._normalizer(rawText);
    if (this.verbose) console.log('[Parakeet.js] Normalized text (final):', text);
    if (perfEnabled) tToken = performance.now() - tokenStart;

    // Early exit if no extras requested
    if (!returnTimestamps && !returnConfidences) {
      if (perfEnabled) {
        const total = performance.now() - t0;
        const audioDur = audio.length / sampleRate;
        const rtf = audioDur / (total / 1000);
        console.log(`[Perf] RTF: ${rtf.toFixed(2)}x (audio ${audioDur.toFixed(2)} s, time ${(total/1000).toFixed(2)} s)`);
        console.table({Preprocess:`${tPreproc.toFixed(1)} ms`, Encode:`${tEncode.toFixed(1)} ms`, Decode:`${tDecode.toFixed(1)} ms`, Tokenize:`${tToken.toFixed(1)} ms`, Total:`${total.toFixed(1)} ms`});
      }
      const metrics = perfEnabled ? {
        preprocess_ms: +tPreproc.toFixed(1),
        encode_ms: +tEncode.toFixed(1),
        decode_ms: +tDecode.toFixed(1),
        tokenize_ms: +tToken.toFixed(1),
        total_ms: +( (performance.now() - t0).toFixed(1) ),
        rtf: +((audio.length / sampleRate) / ((performance.now() - t0) / 1000)).toFixed(2)
      } : null;
      const earlyOut = { utterance_text: text, words: [], metrics, is_final: !returnDecoderState };
      if (returnDecoderState) earlyOut.decoderState = finalDecoderState;
      return earlyOut;
    }

    // --- Build words & detailed token arrays ---------------------------
    const words = [];
    const tokensDetailed = [];
    let currentWord = '', wordStart = 0, wordEnd = 0;
    let wordConfs = [];

    ids.forEach((tokId, i) => {
      const raw = this.tokenizer.id2token[tokId];
      if (raw === this.tokenizer.blankToken) return;
      if (raw === this.tokenizer.unkToken) return;

      const isWordStart = raw.startsWith('▁');
      const cleanTok = isWordStart ? raw.slice(1) : raw;
      const ts = tokenTimes[i] || [null, null];
      const conf = tokenConfs[i];

      // tokensDetailed entry. timeOffset shifts windowed timestamps to absolute time.
      const tokEntry = { token: [cleanTok] };
      if (returnTimestamps) { tokEntry.start_time = +(ts[0] + timeOffset).toFixed(3); tokEntry.end_time = +(ts[1] + timeOffset).toFixed(3); }
      if (returnConfidences) tokEntry.confidence = +conf.toFixed(4);
      tokensDetailed.push(tokEntry);

      // accumulate into words
      if (isWordStart) {
        if (currentWord) {
          const avg = wordConfs.length ? wordConfs.reduce((a,b)=>a+b,0)/wordConfs.length : 0;
          words.push({ text: currentWord, start_time: +(wordStart + timeOffset).toFixed(3), end_time: +(wordEnd + timeOffset).toFixed(3), confidence: +avg.toFixed(4) });
        }
        currentWord = cleanTok;
        if (returnTimestamps) { wordStart = ts[0]; wordEnd = ts[1]; }
        wordConfs = returnConfidences ? [conf] : [];
      } else {
        currentWord += cleanTok;
        if (returnTimestamps) wordEnd = ts[1];
        if (returnConfidences) wordConfs.push(conf);
      }
    });

    if (currentWord) {
      const avg = wordConfs.length ? wordConfs.reduce((a,b)=>a+b,0)/wordConfs.length : 0;
      words.push({ text: currentWord, start_time: +(wordStart + timeOffset).toFixed(3), end_time: +(wordEnd + timeOffset).toFixed(3), confidence: +avg.toFixed(4) });
    }

    const avgWordConf = words.length && returnConfidences ? words.reduce((a,b)=>a+b.confidence,0)/words.length : null;
    const avgTokenConf = tokensDetailed.length && returnConfidences ? tokensDetailed.reduce((a,b)=>a+(b.confidence||0),0)/tokensDetailed.length : null;

    if (perfEnabled) {
      const total = performance.now() - t0;
      const audioDur = audio.length / sampleRate;
      const rtf = audioDur / (total / 1000);
      console.log(`[Perf] RTF: ${rtf.toFixed(2)}x (audio ${audioDur.toFixed(2)} s, time ${(total/1000).toFixed(2)} s)`);
      console.table({Preprocess:`${tPreproc.toFixed(1)} ms`, Encode:`${tEncode.toFixed(1)} ms`, Decode:`${tDecode.toFixed(1)} ms`, Tokenize:`${tToken.toFixed(1)} ms`, Total:`${total.toFixed(1)} ms`});
    }

    const fullOut = {
      utterance_text: text,
      words,
      tokens: tokensDetailed,
      confidence_scores: returnConfidences ? {
        token: tokenConfs.map(c=>+c.toFixed(4)),
        token_avg: +avgTokenConf?.toFixed(4),
        word: words.map(w=>w.confidence),
        word_avg: +avgWordConf?.toFixed(4),
        frame: frameConfs.map(f=>+f.toFixed(4)),
        frame_avg: frameConfs.length ? +(frameConfs.reduce((a,b)=>a+b,0)/frameConfs.length).toFixed(4) : null,
        overall_log_prob: +overallLogProb.toFixed(6)
      } : { overall_log_prob: null, frame: null, frame_avg: null },
      metrics: perfEnabled ? {
        preprocess_ms: +tPreproc.toFixed(1),
        encode_ms: +tEncode.toFixed(1),
        decode_ms: +tDecode.toFixed(1),
        tokenize_ms: +tToken.toFixed(1),
        total_ms: +( (performance.now() - t0).toFixed(1) ),
        rtf: +((audio.length / sampleRate) / ((performance.now() - t0) / 1000)).toFixed(2)
      } : null,
      is_final: !returnDecoderState,
    };
    if (returnDecoderState) fullOut.decoderState = finalDecoderState;
    return fullOut;

    } finally {
      // Best-effort cleanup. On the success path each tensor is disposed and
      // nulled as soon as it's no longer needed, so these are no-ops. If an
      // await between the encoder run and the end of the decode loop threw,
      // the still-live tensors are freed here. Skip `externalInitialState` —
      // it's caller-owned.
      input?.dispose?.();
      lenTensor?.dispose?.();
      enc?.dispose?.();
      inFlightEncTensor?.dispose?.();
      if (decoderState && decoderState !== externalInitialState) {
        try { this._disposeDecoderState(decoderState); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
   * Transcribe a (possibly long) audio buffer by splitting it into overlapping
   * chunks and stitching the per-chunk results back together. This is the
   * file-transcription path used by both the web UI and the CLI harness, so the
   * chunking/overlap/stitching behaviour stays in one place and the two callers
   * cannot drift apart.
   *
   * Each chunk is transcribed with this.transcribe(); the per-chunk options
   * (returnTimestamps, frameStride, temperature, beamWidth, MAES knobs,
   * phraseBoost, enableProfiling, ...) are forwarded verbatim from `opts` so the
   * model behaviour is identical to a single-pass call. Word timestamps are
   * shifted by each chunk's start offset before being concatenated.
   *
   * Overlap dedup: consecutive chunks share `overlapSec` of audio, so each side
   * independently transcribes the same words in that zone. Rather than emit them
   * twice, we split the shared zone at its midpoint (the "seam") using the
   * absolute word timestamps: the earlier chunk keeps the words whose midpoint
   * falls before the seam, the later chunk keeps the words at/after it, so every
   * overlap word survives exactly once. The combined transcript text is then
   * rebuilt from the deduped words so text and word list stay consistent. This
   * requires `returnTimestamps: true`; without timestamps there are no words to
   * align on, so we fall back to plain text concatenation (the old behaviour).
   *
   * When chunking is disabled (`enableChunking: false`) or the audio is shorter
   * than one chunk, this falls back to a single this.transcribe() pass; the
   * `onChunk` callback still fires once (with totalChunks === 1) so callers have
   * a single code path.
   *
   * @param {Float32Array} audio          PCM samples.
   * @param {number}       sampleRate      Sample rate of `audio` (Hz).
   * @param {object}       opts            Chunking options + transcribe() opts:
   *   @param {boolean} [opts.enableChunking=true]  Split long audio into chunks.
   *   @param {number}  [opts.chunkDurationSec=60]  Max chunk length, seconds.
   *   @param {number}  [opts.overlapSec=2]         Overlap between chunks, seconds.
   *   (all other keys are forwarded to this.transcribe())
   * @param {function}     [onChunk]       Optional async callback invoked after
   *   each chunk with { chunkNum, totalChunks, result, partialText, start, end,
   *   elapsedMs }. Awaited, so callers may yield to the UI here.
   * @returns {Promise<object>} Combined result in the same shape transcribe()
   *   returns (utterance_text, words, confidence_scores, metrics, is_final).
   */
  async transcribeChunked(audio, sampleRate = 16000, opts = {}, onChunk = null) {
    const {
      enableChunking = true,
      chunkDurationSec = 60,
      overlapSec = 2,
      ...transcribeOpts
    } = opts;

    const maxChunkSamples = Math.max(1, Math.round(chunkDurationSec * sampleRate));

    // Short audio (or chunking disabled): one pass, but still fire onChunk once
    // so callers don't need a separate branch.
    if (!enableChunking || audio.length <= maxChunkSamples) {
      const t0 = performance.now();
      const result = await this.transcribe(audio, sampleRate, transcribeOpts);
      if (onChunk) {
        await onChunk({
          chunkNum: 1,
          totalChunks: 1,
          result,
          partialText: result.utterance_text,
          start: 0,
          end: audio.length,
          elapsedMs: performance.now() - t0,
        });
      }
      return result;
    }

    const overlapSamples = Math.max(0, Math.round(overlapSec * sampleRate));
    const stride = Math.max(1, maxChunkSamples - overlapSamples);
    const totalChunks = Math.ceil(audio.length / stride);

    // Dedup is only possible when transcribe() returns timestamped words; with
    // returnTimestamps off there are no words, so we keep the plain-concat path.
    const canDedup = !!transcribeOpts.returnTimestamps;
    const wordMid = (w) => (w.start_time + w.end_time) / 2;

    const combinedTextParts = [];
    const combinedWords = [];
    let firstChunkMetrics = null;
    let firstChunkConfidences = null;
    let totalProcessingTime = 0;
    let chunkNum = 0;
    let prevEnd = null; // absolute sample index where the previous chunk ended

    // Text reflecting what's currently in combinedWords (deduped) when we have
    // words, otherwise the raw per-chunk concatenation.
    const buildText = () => (canDedup && combinedWords.length
      ? combinedWords.map((w) => w.text).join(' ')
      : combinedTextParts.join(' '));

    for (let start = 0; start < audio.length; start += stride) {
      const end = Math.min(start + maxChunkSamples, audio.length);
      // subarray (zero-copy view); the model copies into its own ORT tensor.
      const chunk = audio.subarray(start, end);
      chunkNum += 1;

      const tChunk = performance.now();
      const chunkRes = await this.transcribe(chunk, sampleRate, transcribeOpts);
      const elapsedMs = performance.now() - tChunk;

      // Shift word timestamps from chunk-local to absolute time.
      const timeOffset = start / sampleRate;
      const chunkWords = chunkRes.words || [];
      for (const word of chunkWords) {
        word.start_time += timeOffset;
        word.end_time += timeOffset;
      }

      // Stitch this chunk's words onto the running list, deduping the overlap
      // zone [start, prevEnd] at its midpoint seam. The first chunk (prevEnd
      // null) and the no-timestamp fallback just append everything.
      if (canDedup && prevEnd != null && combinedWords.length && chunkWords.length) {
        const seamSec = (start + prevEnd) / 2 / sampleRate;
        // Drop the previous chunk's words past the seam (combinedWords stays
        // time-ordered, so the overlap words are exactly the trailing run).
        while (combinedWords.length && wordMid(combinedWords[combinedWords.length - 1]) >= seamSec) {
          combinedWords.pop();
        }
        // Keep only this chunk's words at/after the seam.
        for (const word of chunkWords) {
          if (wordMid(word) >= seamSec) combinedWords.push(word);
        }
      } else {
        for (const word of chunkWords) combinedWords.push(word);
      }
      combinedTextParts.push(chunkRes.utterance_text);
      prevEnd = end;

      if (chunkNum === 1) {
        firstChunkMetrics = chunkRes.metrics;
        firstChunkConfidences = chunkRes.confidence_scores;
      }
      totalProcessingTime += chunkRes.metrics?.total_ms || 0;

      if (onChunk) {
        await onChunk({
          chunkNum,
          totalChunks,
          result: chunkRes,
          partialText: buildText(),
          start,
          end,
          elapsedMs,
        });
      }
    }

    const combinedText = buildText();
    const totalDuration = audio.length / sampleRate;
    return {
      utterance_text: combinedText,
      words: combinedWords,
      confidence_scores: firstChunkConfidences || {},
      metrics: {
        ...firstChunkMetrics,
        total_ms: totalProcessingTime,
        rtf: totalProcessingTime ? totalDuration / (totalProcessingTime / 1000) : null,
      },
      is_final: true,
    };
  }

  /**
   * Release all ONNX sessions and clean up resources.
   * Call this before loading a new model or when the page unloads.
   */
  dispose() {
    try {
      this.encoderSession?.release();
      this.joinerSession?.release();
      this.preprocessor?.dispose();
      this.encoderSession = null;
      this.joinerSession = null;
      this.preprocessor = null;
      console.log('[Parakeet] Model sessions released');
    } catch (e) {
      console.warn('[Parakeet] Error releasing sessions:', e);
    }
  }

  /**
   * Stop ORT profiling (if enabled) for all sessions and print a quick summary
   * of time spent on GPU (WebGPU) vs CPU (WASM) kernels. Returns the parsed
   * summary object for further inspection.
   */
  endProfiling() {
    try { this.encoderSession?.endProfiling(); } catch(e) { /* ignore */ }
    try { this.joinerSession?.endProfiling(); } catch(e) { /* ignore */ }

    const FS = this.ort?.env?.wasm?.FS;
    if (!FS) {
      console.warn('[Parakeet] Profiling FS not accessible');
      return null;
    }

    const files = FS.readdir('/tmp').filter(f => f.startsWith('profile_') && f.endsWith('.json'));
    if (!files.length) {
      console.warn('[Parakeet] No profiling files found. Was profiling enabled?');
      return null;
    }

    const summary = {};
    for (const file of files) {
      try {
        const txt = FS.readFile('/tmp/' + file, { encoding: 'utf8' });
        const events = JSON.parse(txt);
        let gpu = 0, cpu = 0;
        for (const ev of events) {
          if (ev.cat === 'Node') {
            const prov = ev.args?.provider;
            if (prov === 'webgpu') gpu += ev.dur;
            else if (prov) cpu += ev.dur;
          }
        }
        summary[file] = { gpu_us: gpu, cpu_us: cpu, total_us: gpu + cpu };
      } catch (err) {
        console.warn('[Parakeet] Failed to parse profile file', file, err);
      }
    }
    console.table(summary);
    return summary;
  }
} 
