import { initOrt } from './backend.js';
import { ParakeetTokenizer } from './tokenizer.js';
import { OnnxPreprocessor } from './preprocessor.js';
import { JsPreprocessor } from './mel.js';

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

    // Create separate options for sessions that might have external data
    const encoderSessionOptions = { ...baseSessionOptions };
    if (encoderDataUrl && filenames?.encoder) {
        encoderSessionOptions.externalData = [{
            data: encoderDataUrl,
            path: filenames.encoder + '.data',
        }];
    }

    const decoderSessionOptions = { ...baseSessionOptions };
    if (decoderDataUrl && filenames?.decoder) {
        decoderSessionOptions.externalData = [{
            data: decoderDataUrl,
            path: filenames.decoder + '.data',
        }];
    }

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
    return { tokenLogits, step, newState, _logitsTensor: logits };
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
   * @returns {{emit: boolean, isBlank: boolean, nextT: number, nextEmitted: number}}
   */
  _advanceDecision(t, emittedAtFrame, id, step, frameStride) {
    const isBlank = (id === this.blankId);
    let nextT, nextEmitted;
    if (step > 0) {
      nextT = t + step;
      nextEmitted = 0;
    } else if (isBlank || emittedAtFrame + 1 >= this.maxTokensPerStep) {
      nextT = t + frameStride;
      nextEmitted = 0;
    } else {
      nextT = t;
      nextEmitted = emittedAtFrame + 1;
    }
    return { emit: !isBlank, isBlank, nextT, nextEmitted };
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
    } = opts;

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

    // --- Decode (greedy = beam width 1) -------------------------------
    // The decoder is a degenerate beam: a single hypothesis carrying its own
    // frame pointer, decoder state, emitted ids and the per-frame
    // confidence/timestamp accumulators. The per-step work is factored into
    // _pickArgmax / _frameConfidence / _advanceDecision so a future
    // multi-hypothesis beam (PLAN.md Q1) can reuse them unchanged.
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
    // Caller may pass a decoder state from a previous (contiguous) chunk to
    // continue token-history continuity across calls. We hold a reference but
    // never dispose the externally-owned object — the caller still owns it.
    externalInitialState = previousDecoderState || null;
    decoderState = hyp.state; // keep the function-scope alias in sync for finally

    // Phrase boosting: reset the trie's active state per decode window (Q4) so
    // matches start fresh. When no trie is supplied, this whole path is inert
    // and the default decoding behavior is unchanged.
    phraseBoost?.reset();

    const decStartTime = perfEnabled ? performance.now() : 0;
    const TIME_STRIDE = this.subsampling * this.windowStride;

    while (hyp.t < Tenc) {
      // Yield to browser every ~50 frames to keep UI responsive
      if (hyp.t % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const frameBuf = transposed.subarray(hyp.t * D, (hyp.t + 1) * D);
      inFlightEncTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);

      const prevTok = hyp.ids.length ? hyp.ids[hyp.ids.length - 1] : this.blankId;
      const { tokenLogits, step, newState, _logitsTensor } = await this._runCombinedStep(inFlightEncTensor, prevTok, hyp.state);

      // Phrase boosting (shallow fusion): add the trie's rewards into the token
      // logits before the argmax so the per-step choice is biased toward
      // continuing/starting a boost phrase. We save the touched logits and
      // restore them right after the argmax so confidence/log-prob below stay
      // computed on the model's true (unboosted) distribution.
      // Argmax is invariant to a positive temperature divide, so we argmax the
      // raw logits directly (avoids the Infinity/NaN trap at temperature 0).
      const boostSaved = phraseBoost ? phraseBoost.applyBoost(tokenLogits) : null;
      let { maxId, maxLogit } = this._pickArgmax(tokenLogits);

      // Restore the boosted logits so confidence/log-prob use the true values.
      // _frameConfidence assumes maxLogit == tokenLogits[maxId] (chosen token's
      // numerator is 1), so reset maxLogit to the chosen token's true logit.
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
        // Dispose newState's tensors that aren't aliased with the kept state.
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
    // Either way we null `decoderState` so the function-level finally block
    // doesn't double-dispose or free a caller-owned tensor.
    finalDecoderState = hyp.state;
    if (!returnDecoderState) {
      this._disposeDecoderState(hyp.state);
    }
    decoderState = null;

    // Expose the winning hypothesis' accumulators under the names the
    // word/token assembly below expects.
    const ids = hyp.ids;
    const tokenTimes = hyp.tokenTimes;
    const tokenConfs = hyp.tokenConfs;
    const frameConfs = hyp.frameConfs;
    const overallLogProb = hyp.overallLogProb;

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
