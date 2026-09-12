// Phrase boosting (context biasing), lifted out of App() whole.
//
// This owns everything between the sidebar's Phrase boosting section and the
// decoder: the phrase text and the knobs, the operator-supplied list manifest
// and the per-list server-prebuilt encodings, the encode worker that keeps BPE
// off the main thread, the debounced trie rebuild, and the gate a transcription
// waits on so it never decodes against a stale trie.
//
// What stays in App.jsx: the sidebar JSX that renders these values, the
// settings restore/persist that seeds and saves them, the medical-mode preset
// that picks a list, and the decode worker, which reads `boostEncodedRef` to
// rebuild its own trie (the live BoostingTrie is not structured-cloneable, so
// the cloneable token ids have to cross the boundary).
//
// The one ordering contract worth naming: the ?mode= medical preset and this
// hook's own one-shot init BOTH resolve a boost source once settings and the
// manifest have loaded, and both then fetch. In App() that was arbitrated by
// declaration order (the med-mode effect claimed a shared ref before this one
// could run), which no longer survives the move: a hook's effects all run
// before the effects declared after its call site. So the arbitration is now
// explicit, through `skipInit`: when a med-mode link is what opened the page,
// this hook does not resolve a source at all and the preset is the only writer.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { BoostingTrie, compileBoostList, parsePrebuiltBoost, encodedCount, selectPrebuilt, countPhraseLines, DEFAULT_DEPTH_SCALING } from '../../../src/phraseBoost.js';
import { loadBpeEncoder, BPE_ASSET_URL, vocabSignature } from '../../../src/bpeEncoder.js';
import { fetchTextCapped } from '../lib/fetchCapped.js';
import { CONFIG } from '../config.js';
import {
  BOOST_MINP_DEFAULT,
  BOOST_STRENGTH_DEFAULT,
  BOOST_SOURCE_CUSTOM,
  BOOST_SOURCE_DISABLED,
  BOOST_REBUILD_DEBOUNCE_MS,
  BOOST_SPINNER_MIN_PHRASES,
  BOOST_PREBUILT_MAX_BYTES,
  BOOST_COLLAPSE_MIN_LINES,
  BOOST_CUSTOM_COLLAPSE_MIN_LINES,
  boostBuildKey,
  normalizeBoostName,
} from '../lib/boostConfig.js';

// A ?phrase_boost=<name> query param lets a shareable link pre-select a curated
// boost list for first-time visitors. Read once at module load (the query
// string doesn't change within a session). Per the product decision it does NOT
// override a returning user's saved boost choice; it only seeds the default when
// none is saved. See the settings-load and boost-init effects.
const URL_PHRASE_BOOST = typeof window !== 'undefined'
  ? normalizeBoostName(new URLSearchParams(window.location.search).get('phrase_boost'))
  : null;

/**
 * Own the whole phrase-boosting feature: state, worker, trie and the readiness
 * gate. Called once from App().
 *
 * @param {object} deps
 * @param {boolean} deps.verboseLog     mirrored into a ref for the async paths
 * @param {boolean} deps.settingsLoaded gates the one-shot source resolution
 * @param {{current: any}} deps.modelRef the loaded model, read for its tokenizer
 * @param {(id: string) => void} deps.toggleSection the sidebar section toggle
 * @param {boolean} deps.skipInit       stand down: another writer (the ?mode=
 *   medical preset) owns the initial source choice and would otherwise race
 *   this hook to be the last fetch to land
 */
export function usePhraseBoost({ verboseLog, settingsLoaded, modelRef, toggleSection, skipInit }) {
  // Phrase boosting (context biasing): the user lists phrases to bias the
  // greedy decoder toward (PLAN.md). `boostPhrases` is the raw textarea text
  // (one phrase per line, optional `phrase:WEIGHT`); `boostStrength` is the
  // global multiplier (0 disables). The built BoostingTrie lives in a ref so
  // we rebuild it only when the phrase text changes (not on every keystroke of
  // unrelated state), and the strength slider just mutates trie.strength.
  const [boostPhrases, setBoostPhrases] = useState('');
  const [boostStrength, setBoostStrength] = useState(BOOST_STRENGTH_DEFAULT);
  // Advanced boost knobs, mirroring the CLI's --boost-minp / --depth-scaling
  // (scripts/transcribe.mjs). `boostMinp` is a GLOBAL min-p override: a number
  // in [0, 1] supersedes every per-phrase min-p at decode time
  // (trie.minpOverride, mutable like strength, no rebuild). The value IS the
  // min-p and is monotonic: 0 = boost every candidate (no gate), 1 = disabled
  // (only the model's top token). `null` (a blank field) turns the override off
  // so each phrase keeps its own baked gate. Note this is NOT `0`: 0 is a real
  // value (boost all), the off state is null. `boostDepthScaling` is the linear
  // per-depth reward growth; it is baked into node bonuses at insert time, so
  // changing it re-runs the (debounced) trie rebuild.
  const [boostMinp, setBoostMinp] = useState(BOOST_MINP_DEFAULT);
  const [boostDepthScaling, setBoostDepthScaling] = useState(DEFAULT_DEPTH_SCALING);
  // Surface-form augmentation (Title Case, ALL CAPS, proclitic prefixes,
  // symbol-stripped forms, French plurals) is opt-in per phrase via the `:AUG` field, or list-wide
  // via a `*:::AUG` defaults line; there is no global UI toggle. The BPE encoder is
  // case-sensitive, so each form is a distinct token sequence / trie branch. See
  // expandAugmentations.
  const [boostWarnings, setBoostWarnings] = useState([]); // [{phrase}] with out-of-range weight
  const [boostUnkWarnings, setBoostUnkWarnings] = useState([]); // phrases dropped: encode to <unk> (e.g. CJK)
  // Actively-incompatible duplicate phrases (e.g. `venlafaxine:5` AND
  // `venlafaxine:-5`): a hand-editing user is only warned (the offline compile
  // step hard-fails instead, see boostCompile.js). A plain repeated line with the
  // same weight is NOT a conflict and is ignored. See findBoostConflicts.
  const [boostConflicts, setBoostConflicts] = useState([]);
  // Phrases the list actually declares, as counted by the parse. It comes back
  // from the boost worker with the warnings and conflicts above rather than
  // being derived during render: parsing a 75k-line list costs ~90 ms, which is
  // not affordable on the main thread. Render-time size decisions use the cheap
  // countPhraseLines() probe instead.
  const [boostPhraseCount, setBoostPhraseCount] = useState(0);
  // True while a long phrase list is (re)encoding+building so the header status
  // shows a spinner; only set for lists past BOOST_SPINNER_MIN_PHRASES so a
  // small edit never flashes it (small lists rebuild in a few ms).
  const [boostRebuilding, setBoostRebuilding] = useState(false);
  const phraseBoostRef = useRef(null);   // BoostingTrie | null (null = inert)
  const boostStrengthRef = useRef(BOOST_STRENGTH_DEFAULT);
  // Current min-p override for the debounced rebuild closure (which, like
  // strength, must not be a rebuild dependency: moving the knob only mutates
  // the live trie, but a rebuild from another cause must carry it over).
  const boostMinpRef = useRef(BOOST_MINP_DEFAULT);
  // boostBuildKey of the last COMPLETED trie build (or completed decision that
  // no trie is possible/needed). waitForBoostReady() polls this against the
  // key expected for the live config, so a transcription that starts while the
  // debounced/async rebuild is still running (worst case: the capture queue
  // drains in the very tick that publishes the vocab signature, BEFORE the
  // rebuild effect has even run) waits for the trie instead of silently
  // decoding boost-less. Live mirrors of the key's inputs sit beside it
  // because the waiter polls between renders, where closure state goes stale.
  const boostBuiltKeyRef = useRef(null);
  const boostPhrasesRef = useRef('');
  const boostDepthScalingRef = useRef(DEFAULT_DEPTH_SCALING);
  // Vocab signature of the currently loaded tokenizer (null when no model is
  // loaded). This is the *only* model-side input the boost-trie rebuild needs:
  // it changes when (and only when) the model's vocab does, so the rebuild
  // effect keys on it instead of `status`. Keying on `status` was the bug
  // behind the "My Computer tab frozen on load": `status` also flips on every
  // recording start/stop, file transcribe, and even each chunk-progress tick
  // (setStatus with a percentage string), and each flip re-ran the heavy
  // parseBoostPhrases + trie rebuild and pushed fresh boost-warning arrays that
  // forced the giant phrase-list textarea to reconcile. Now the rebuild fires
  // once per real model change, not once per status string.
  const [tokenizerVocabSig, setTokenizerVocabSig] = useState(null);
  // Current verbose-logging flag for use inside the debounced rebuild closure
  // (which captures a stale `verboseLog`); synced by the effect below.
  const verboseLogRef = useRef(false);
  // Operator-supplied phrase lists (BOOST_PHRASES_SOURCE -> /boost-phrases/).
  // `boostFiles` is the manifest filenames; when non-empty the UI shows a
  // selector. `boostSource` is the current choice: the BOOST_SOURCE_CUSTOM
  // sentinel (user-typed text) or one of the filenames. `boostCustomText`
  // preserves the user's own text so switching to a file and back never
  // loses it; it is persisted across sessions.
  const [boostFiles, setBoostFiles] = useState([]);
  const [boostFilesLoaded, setBoostFilesLoaded] = useState(false);
  const [boostSource, setBoostSource] = useState(BOOST_SOURCE_CUSTOM);
  const [boostCustomText, setBoostCustomText] = useState('');
  const boostCustomTextRef = useRef('');
  // Whether the user asked to edit an oversized Custom list inline. Deliberately
  // NOT persisted and reset on every source switch: mounting that textarea is
  // the ~1 s cost this gate exists to defer, so it must never be paid on a load
  // or a switch, only on an explicit click.
  const [boostEditorOpen, setBoostEditorOpen] = useState(false);
  // Server-prebuilt encoding for the currently selected bundled list, or null.
  // { text, vocabSig, encoded, skipped }: `text` is the exact list text it was
  // built from, so the rebuild effect only trusts it while the textarea is
  // unedited and `vocabSig` matches the loaded tokenizer (else it re-encodes).
  const prebuiltBoostRef = useRef(null);
  // Cached BPE encoder, tied to the tokenizer it was built from so a model
  // swap (different vocab) rebuilds it. { tokenizer, encoder } | null. Only used
  // by the main-thread fallback when the encode worker is unavailable.
  const bpeEncoderRef = useRef(null);
  // Encode worker (lazy): offloads the heavy BPE tokenization of the boost
  // phrase list off the main thread. `undefined` = not yet created, `null` =
  // creation failed (fall back to main-thread encode). `boostReqIdRef` tags each
  // request so a superseded reply (after a debounce/model-swap race) is ignored.
  const boostWorkerRef = useRef(undefined);
  const boostReqIdRef = useRef(0);

  // Boost token-ids + params stashed for the decode worker to rebuild its trie
  // (the live BoostingTrie itself is not structured-cloneable). null = no boost.
  const boostEncodedRef = useRef(null);

  // Keep a ref of the user's custom boost text so async callbacks (switching
  // between a file and Custom) always read the latest value.
  useEffect(() => { boostCustomTextRef.current = boostCustomText; }, [boostCustomText]);

  // Names of the server-prebuilt boost encodings (<name>.json) the manifest
  // advertises. Empty until the manifest lands, and empty forever on a
  // deployment that prebuilds nothing, which is what keeps the app from
  // requesting an artifact that was never generated.
  const boostPrebuiltFilesRef = useRef(new Set());
  // Discover operator-supplied boost lists served at /boost-phrases/. No
  // manifest (BOOST_PHRASES_SOURCE unset) just means no selector is shown and
  // the box stays in manual-entry mode.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await fetchTextCapped('/boost-phrases/manifest.txt');
        if (!cancelled && manifest.ok) {
          const entries = manifest.text.trim().split('\n')
            .map(f => f.trim())
            .filter(Boolean);
          setBoostFiles(entries.filter(f => f.endsWith('.txt')));
          // The manifest also names the server-prebuilt encodings (<name>.json)
          // when the container had a local vocab to build them from. It is the
          // ONLY way to know whether one exists: fetching to find out means a
          // 404 per list on every deployment without them, which looks like a
          // broken install and is the sole trace this optional optimisation
          // leaves in the console.
          boostPrebuiltFilesRef.current = new Set(entries.filter(f => f.endsWith('.json')));
        }
      } catch (e) {
        console.warn('[Boost] failed to load phrase-list manifest:', e);
      } finally {
        if (!cancelled) setBoostFilesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply a boost-source selection: fill the textarea from the chosen file, or
  // restore the user's own text for the Custom sentinel. Shared by the selector
  // onChange and the one-shot init resolution below.
  async function applyBoostSource(src) {
    setBoostSource(src);
    // Any switch closes an opened oversized-list editor: leaving it open would
    // re-mount a huge textarea the moment the user comes back to Custom, which
    // is exactly the stall the lazy gate exists to avoid.
    setBoostEditorOpen(false);
    if (src === BOOST_SOURCE_DISABLED) {
      // Turn boosting off. Clearing the phrase text hits the empty-phrase fast
      // path in the rebuild effect (phraseBoostRef -> null, no encode/build) and
      // cancels any in-flight trie build for the previous list, so switching
      // here from a very large curated list is instant (fetches nothing). The
      // user's Custom text is left untouched in boostCustomTextRef for later.
      prebuiltBoostRef.current = null;
      setBoostPhrases('');
      return;
    }
    if (src === BOOST_SOURCE_CUSTOM) {
      prebuiltBoostRef.current = null; // user text is never server-prebuilt
      setBoostPhrases(boostCustomTextRef.current);
      return;
    }
    // Fetch the list text (for display/editing) and its server-prebuilt
    // encoding (token ids) in parallel. The prebuilt JSON lets the trie build
    // skip BPE; it is absent on pure-HF deploys or empty lists, in which case
    // the browser encodes the text itself (prebuiltBoostRef stays null).
    const jsonName = src.replace(/\.txt$/, '.json');
    // Only ask for the prebuilt encoding when the manifest says it is there.
    // The artifact is written by the container's prebuild step and only when a
    // local vocab exists, so on every other deployment the speculative GET was
    // a guaranteed 404 per list: harmless (it is swallowed below) but it is the
    // one red line in the console of an otherwise healthy install, and it sent
    // at least one operator hunting for a bug that was not there.
    const hasPrebuilt = boostPrebuiltFilesRef.current.has(jsonName);
    const fetchT0 = performance.now();
    if (verboseLogRef.current) {
      console.log(`[Boost] loading list "${src}"`
        + `${hasPrebuilt ? ` (+ prebuilt "${jsonName}")` : ' (no prebuilt encoding served; encoding in-browser)'}...`);
    }
    const [r, parsedPrebuilt] = await Promise.all([
      fetchTextCapped(`/boost-phrases/${encodeURIComponent(src)}`),
      // Fetched, parsed AND packed inside the boost worker: on a large clinical
      // list this artifact is tens of megabytes and parses to ~330k objects, and
      // doing that here blocked the main thread for over a second at page load.
      // A prebuilt failure must never break the text load, so every miss (absent,
      // oversized, malformed) comes back as null and the browser encodes the
      // text itself.
      hasPrebuilt
        ? loadPrebuiltBoost(`/boost-phrases/${encodeURIComponent(jsonName)}`, BOOST_PREBUILT_MAX_BYTES)
        : Promise.resolve(null),
    ]);
    if (verboseLogRef.current) {
      const ms = (performance.now() - fetchT0).toFixed(0);
      console.log(`[Boost] fetched "${src}" in ${ms}ms `
        + `(text: ${r.ok ? `${r.text.length} chars` : 'FAILED'}, `
        + `prebuilt: ${parsedPrebuilt ? `${encodedCount(parsedPrebuilt.encoded)} entries` : 'absent (will encode in-browser)'}).`);
    }
    if (!r.ok) {
      console.warn(`[Boost] could not load phrase list "${src}":`,
        r.oversize ? `oversize ${r.declared} bytes` : `status ${r.status}`);
      prebuiltBoostRef.current = null;
      return;
    }
    // Tag the prebuilt encoding with the exact text it corresponds to, so the
    // rebuild effect only trusts it while the textarea is unedited. Everything
    // else about it (parse, v2 validation, packing) already happened in the
    // worker, and the packed arrays arrived transferred, so nothing is copied
    // here.
    const pre = parsedPrebuilt ? { ...parsedPrebuilt, text: r.text } : null;
    prebuiltBoostRef.current = pre;
    if (verboseLogRef.current) {
      if (pre) {
        console.log(`[Boost] prebuilt encoding ready for "${src}": ${encodedCount(pre.encoded)} entries, `
          + `${pre.skipped.length} skipped, vocabSig=${pre.vocabSig}, augmentDefault="${pre.augmentDefault}". `
          + `The trie rebuild will reuse this and skip the BPE encode (provided vocab + augment toggle match).`);
      } else {
        console.log(`[Boost] no usable prebuilt for "${src}"; the trie rebuild will BPE-encode the list in-browser `
          + `(slow for large lists; runs in a worker when available).`);
      }
    }
    // A curated list sets its own per-phrase defaults via a `*:WEIGHT:MINP:AUG`
    // line in the text itself (resolved in parseBoostPhrases), so loading a list
    // no longer touches the global strength slider: whatever strength the user
    // had is left as-is and multiplies those baked-in weights.
    setBoostPhrases(r.text);
  }

  // One-shot: once both settings and the manifest have loaded, resolve the
  // source to load. A filename that still exists is (re)fetched so the box shows
  // the canonical list; a filename the operator has since removed falls back to
  // Custom so the user is never stuck on a dead entry. Custom needs nothing
  // (boostPhrases was already seeded from the saved custom text).
  //
  // When the user has NO saved boost choice (a fresh visitor), seed the default
  // from the ?phrase_boost= query param, then the VITE_PHRASE_BOOST_DEFAULT env
  // default. Neither overrides an explicit saved choice (boostSourceSavedRef).
  // This lives here (not only in the settings restore) because a first-time
  // visitor's restore takes the version-mismatch fast path that skips the
  // restore block, so the param/env default must be applied unconditionally.
  //
  // `skipInit` stands the whole thing down when another writer owns the initial
  // choice (the ?mode= medical preset). In App() that was arranged by declaring
  // the preset's effect above this one and having it claim a shared ref; inside
  // a hook that no longer works, because every effect a hook declares runs
  // before the effects declared after its call site, so the two would simply
  // race to be the last fetch to land.
  const boostSourceSavedRef = useRef(false);
  const boostInitRef = useRef(false);

  useEffect(() => {
    if (skipInit) return;
    if (!settingsLoaded || !boostFilesLoaded || boostInitRef.current) return;
    boostInitRef.current = true;
    let source = boostSource;
    if (!boostSourceSavedRef.current && source === BOOST_SOURCE_CUSTOM) {
      source = URL_PHRASE_BOOST || normalizeBoostName(CONFIG.VITE_PHRASE_BOOST_DEFAULT) || BOOST_SOURCE_CUSTOM;
    }
    if (source === BOOST_SOURCE_DISABLED) {
      // Explicit "boosting off": leave it off (restore already cleared the
      // phrase text). Don't treat it as a stale/unknown list name below.
      setBoostPhrases('');
    } else if (source !== BOOST_SOURCE_CUSTOM) {
      if (boostFiles.includes(source)) {
        if (source !== boostSource) setBoostSource(source);
        applyBoostSource(source);
      } else {
        setBoostSource(BOOST_SOURCE_CUSTOM);
        setBoostPhrases(boostCustomTextRef.current);
      }
    }
  }, [settingsLoaded, boostFilesLoaded, skipInit]);

  // Lazily create the encode worker. Returns null when Workers are unavailable
  // (e.g. an exotic environment), so the caller can fall back to the main
  // thread. The BPE asset only downloads once the worker is first used, i.e.
  // when the user actually enters boost phrases (PLAN.md Phase 1 "gate asset
  // download" / Phase 3).
  const getBoostWorker = useCallback(() => {
    if (boostWorkerRef.current !== undefined) return boostWorkerRef.current;
    try {
      boostWorkerRef.current = new Worker(
        new URL('../phraseBoost.worker.js', import.meta.url),
        { type: 'module' }
      );
    } catch (e) {
      console.warn('[Boost] encode worker unavailable, using main thread:', e);
      boostWorkerRef.current = null;
    }
    return boostWorkerRef.current;
  }, []);

  // Run the phrase list through the whole compile chain (parse -> warnings +
  // conflicts -> augmentation expansion -> BPE encode), off the main thread via
  // the worker when available, otherwise on a main-thread encoder cached per
  // tokenizer (model swap rebuilds it). Resolves compileBoostList's result:
  // { phraseCount, warnings, conflicts, expandedCount, encoded, skipped }.
  //
  // `encode: false` asks for a parse-only pass (no tokenizer needed): the UI
  // still gets the count and the inline warnings, and the expensive half is
  // skipped. Everything here used to run inline in the rebuild effect below,
  // where the expansion alone froze the tab for ~1 s per keystroke on a large
  // list, un-debounced (only the encode was behind the debounce).
  // Fetch + parse + pack a server-prebuilt boost encoding, off the main thread
  // when a worker can be created. The artifact is tens of megabytes and parses
  // to ~330k small objects for a large clinical list, so doing it inline froze
  // the tab for well over a second at page load on a slow device -- the exact
  // stall a `?mode=` link hits, since it selects a curated list before the
  // visitor has touched anything.
  //
  // Resolves the parsed prebuilt, or null when there is nothing usable (missing,
  // oversized, malformed, or a legacy v1 artifact); the caller then encodes the
  // list in-browser, exactly as on a deployment that ships no artifact.
  const loadPrebuiltBoost = useCallback((url, maxBytes) => {
    const worker = getBoostWorker();
    if (!worker) {
      // No worker: same work, same shared helpers, just on this thread.
      return fetchTextCapped(url, maxBytes)
        .then(res => (res.ok ? parsePrebuiltBoost(res.text) : null))
        .catch(() => null);
    }
    return new Promise((resolve) => {
      const reqId = ++boostReqIdRef.current;
      const onMsg = (ev) => {
        if (ev.data.id !== reqId) return;
        worker.removeEventListener('message', onMsg);
        if (ev.data.oversize) {
          console.warn(`[Boost] prebuilt encoding at ${url} is oversized `
            + `(${ev.data.declared} bytes > ${maxBytes}); encoding the list in-browser instead.`);
        }
        resolve(ev.data.ok ? ev.data.prebuilt : null);
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id: reqId, kind: 'prebuilt', url, maxBytes });
    });
  }, [getBoostWorker]);

  const compileBoostPhrases = useCallback((text, { encode, tokenizer, augmentDefault = '' }) => {
    const worker = getBoostWorker();
    if (!worker) {
      return (async () => {
        let encoder = null;
        if (encode) {
          if (!bpeEncoderRef.current || bpeEncoderRef.current.tokenizer !== tokenizer) {
            bpeEncoderRef.current = { tokenizer, encoder: await loadBpeEncoder(tokenizer) };
          }
          encoder = bpeEncoderRef.current.encoder;
        }
        return compileBoostList(text, encoder, { augmentDefault });
      })();
    }
    return new Promise((resolve, reject) => {
      const reqId = ++boostReqIdRef.current;
      const onMsg = (ev) => {
        if (ev.data.id !== reqId) return; // a different (e.g. older) request's reply
        worker.removeEventListener('message', onMsg);
        if (ev.data.ok) resolve(ev.data);
        else reject(new Error(ev.data.error));
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({
        id: reqId,
        text,
        augmentDefault,
        encode,
        id2token: encode ? tokenizer.id2token : null,
        assetUrl: BPE_ASSET_URL,
      });
    });
  }, [getBoostWorker]);

  // Terminate the encode worker on unmount so it does not outlive the app.
  useEffect(() => () => {
    if (boostWorkerRef.current) boostWorkerRef.current.terminate();
  }, []);

  // Cheap synchronous size probe for the collapse gates below. It has to be
  // synchronous (deciding whether to render the textarea at all happens during
  // render, and a one-frame "render it, then hide it" would pay exactly the cost
  // we are avoiding), so it counts non-blank lines instead of parsing: a few ms
  // on a 2 MB list against ~90 ms for the real parse, which now runs in the
  // boost worker. The exact phrase count comes back from there (boostPhraseCount).
  const boostLineCount = useMemo(() => countPhraseLines(boostPhrases), [boostPhrases]);

  // A large *served* (non-Custom) list is collapsed to a read-only summary
  // rather than rendered in the editable textarea: a 60k-line lexicon is never
  // hand edited, and a controlled textarea that big makes the field scroll and
  // the sidebar lag. The text still lives in `boostPhrases` for boosting.
  //
  // The user's own text gets the same treatment past a much higher threshold,
  // but behind an explicit "edit anyway" button (boostEditorOpen) rather than
  // flatly refusing to show it: mounting a 75k-line textarea costs ~1 s, and
  // paying that on every source switch and every reopen of this section is what
  // made both feel frozen. Opening the editor is now the only thing that pays it.
  const boostCustomOversize = boostSource === BOOST_SOURCE_CUSTOM
    && boostLineCount >= BOOST_CUSTOM_COLLAPSE_MIN_LINES;
  const boostCollapsed = boostSource !== BOOST_SOURCE_CUSTOM
    && boostLineCount >= BOOST_COLLAPSE_MIN_LINES;

  // Closing the Phrase boosting section also drops the "edit anyway" opt-in.
  // The section body unmounts when collapsed, so without this the flag would
  // survive and reopening the section would re-mount the huge textarea, which is
  // the other half of what this gate exists to avoid.
  const toggleBoostingSection = useCallback((id) => {
    setBoostEditorOpen(false);
    toggleSection(id);
  }, [toggleSection]);

  // Phrase boosting: rebuild the trie when the phrase text changes or the model
  // becomes ready (the encoder needs the loaded tokenizer's vocab). The rebuild
  // is debounced (a large paste shouldn't re-encode per keystroke) and the
  // encode runs in the worker, so the main thread never blocks on tokenizing a
  // big list; only the cheap trie insert happens here. Strength is applied
  // separately (below) so moving the slider does not force a re-encode. We key
  // on `tokenizerVocabSig` (not `status`) so a model load/swap refreshes the
  // trie exactly once: `status` also flips on every recording/transcribe/chunk
  // transition, none of which change the vocab, and re-running the parse +
  // rebuild + warning-state writes on each of those froze the UI on a large
  // curated list (the textarea reconciled the whole list every time).
  useEffect(() => {
    const text = boostPhrases;
    const tokenizer = modelRef.current?.tokenizer;
    const sig = tokenizer?.id2token ? vocabSignature(tokenizer.id2token) : null;
    // A completed decision is a completed "build": stamp the key so
    // waitForBoostReady() doesn't hold runs for a trie that can't or needn't
    // exist (no phrases, or no tokenizer yet).
    const stampBuilt = () => {
      boostBuiltKeyRef.current = boostBuildKey(text, boostDepthScaling, sig);
    };

    // Empty list: nothing to parse, encode or build. Handled synchronously, and
    // without waking the worker, so clearing the box (or picking Disabled) takes
    // boosting off immediately.
    if (!text.trim()) {
      phraseBoostRef.current = null;
      boostEncodedRef.current = null;
      setBoostWarnings([]);
      setBoostConflicts([]);
      setBoostUnkWarnings([]);
      setBoostPhraseCount(0);
      stampBuilt();
      return;
    }

    // Use the server-prebuilt encoding when it matches the current text exactly
    // (unedited) and the vocab it was built for matches the loaded tokenizer;
    // that skips the BPE encode AND the augmentation expansion (the prebuilt
    // baked both in), which is the difference between an insert-only rebuild and
    // a from-scratch one. Augmentation is opt-in from the list text itself (a
    // per-phrase `:AUG` field or a `*:::AUG` defaults line), so the global
    // baseline is empty.
    const pre = prebuiltBoostRef.current;
    const augmentDefault = '';
    const { usePrebuilt, reasons: prebuiltRejectReasons } = selectPrebuilt(pre, {
      text, vocabSig: sig, augmentDefault,
    });
    // Without a tokenizer there is no trie to build, but the list can still be
    // parsed for the count and the inline warnings, so ask the worker for a
    // parse-only pass rather than bailing out entirely.
    const canBuild = !!tokenizer;
    const needEncode = canBuild && !usePrebuilt;

    if (!canBuild) {
      phraseBoostRef.current = null;
      boostEncodedRef.current = null;
      stampBuilt();
      // A server-prebuilt artifact ships its own `skipped` list (the phrases the
      // model vocab can't represent, computed against that vocab at prebuild
      // time) and is fetched into prebuiltBoostRef the moment the list is
      // selected. Surface it now so the untokenizable-words warning appears on
      // list-load rather than only once the model is ready; the full rebuild
      // recomputes it against the live tokenizer. Guard on text match so an
      // edited list shows nothing stale (editing a curated list drops the
      // prebuilt anyway).
      const canPreview = pre && pre.text === text && Array.isArray(pre.skipped);
      setBoostUnkWarnings(canPreview ? pre.skipped : []);
    }

    let cancelled = false;
    // When a prebuilt exists but is rejected, say why: this is the difference
    // between a fast (prebuilt) rebuild and a slow from-scratch BPE re-encode,
    // so it is the first thing to check if a curated list is unexpectedly slow.
    if (verboseLogRef.current && pre && !usePrebuilt && canBuild) {
      console.log(`[Boost] prebuilt encoding present but NOT used; will BPE-encode in-browser. Reason: ${prebuiltRejectReasons.join('; ')}.`);
    }
    // Long lists take long enough to encode+build that the user should see the
    // app is busy; small ones (or prebuilt ones, which only insert) rebuild in
    // a few ms, so a spinner would only flash. The exact phrase count is only
    // known once the worker replies, so the gate goes by the raw line count:
    // the two differ only by comment/defaults lines.
    const showSpinner = needEncode && boostLineCount >= BOOST_SPINNER_MIN_PHRASES;
    const timer = setTimeout(async () => {
      if (showSpinner) setBoostRebuilding(true);
      const t0 = performance.now();
      if (verboseLogRef.current) {
        // Keep "[Boost] rebuilding trie" as the one-per-actual-rebuild marker
        // (boost-rebuild-on-status.spec.js counts it); a parse-only pass builds
        // nothing, so it gets its own wording.
        console.log(canBuild
          ? `[Boost] rebuilding trie for ${boostLineCount} line(s)`
            + `${usePrebuilt ? ' (server-prebuilt encoding, skipping BPE)' : ''}...`
          : `[Boost] parsing ${boostLineCount} line(s) for warnings only (no model loaded, nothing to build)...`);
      }
      try {
        const res = await compileBoostPhrases(text, { encode: needEncode, tokenizer, augmentDefault });
        if (cancelled) return;
        // Display-only outputs, available on every path (including parse-only).
        setBoostWarnings(res.warnings.map(w => ({ phrase: w.phrase })));
        setBoostConflicts(res.conflicts);
        setBoostPhraseCount(res.phraseCount);
        // Parse-only pass: no model, so nothing to build. The key was already
        // stamped synchronously above.
        if (!canBuild) return;
        // Text that is non-blank but holds no phrases (only comments/directives).
        if (!res.phraseCount) {
          phraseBoostRef.current = null;
          boostEncodedRef.current = null;
          setBoostUnkWarnings([]);
          stampBuilt();
          return;
        }
        const { encoded, skipped } = needEncode
          ? { encoded: res.encoded, skipped: res.skipped }
          : { encoded: pre.encoded, skipped: pre.skipped };
        const count = encodedCount(encoded);
        const trie = BoostingTrie.buildFromEncoded(encoded, {
          strength: boostStrengthRef.current,
          depthScaling: boostDepthScaling,
          // Carry the live decode-time override into the fresh trie (0 = off).
          minpOverride: boostMinpRef.current, // null = off (per-phrase gates); 0 = boost all; 1 = disabled
        });
        trie.skipped = skipped;
        // Phrases with characters the model vocab cannot represent (e.g. CJK)
        // were dropped during encode; surface them so the user knows why.
        setBoostUnkWarnings(skipped);
        phraseBoostRef.current = trie.isEmpty ? null : trie;
        // Stash the cloneable ids + params so the decode worker can rebuild an
        // equivalent trie (the live trie instance cannot cross postMessage).
        boostEncodedRef.current = trie.isEmpty ? null : {
          encoded,
          strength: boostStrengthRef.current,
          depthScaling: boostDepthScaling,
          minpOverride: boostMinpRef.current,
        };
        stampBuilt();
        if (verboseLogRef.current) {
          const ms = performance.now() - t0;
          const perLine = count ? ms / count : 0;
          console.log(
            `[Boost] trie rebuilt in ${ms.toFixed(1)}ms for ${count} entr(ies) `
            + `(avg ${perLine.toFixed(3)}ms/line, ${trie.size} inserted, ${skipped.length} skipped`
            + `${usePrebuilt ? ', prebuilt' : ''}).`
          );
        }
      } catch (e) {
        if (cancelled) return;
        console.warn('[Boost] failed to build boosting trie:', e);
        phraseBoostRef.current = null;
        // A failed build is complete too: waiting longer would not produce a
        // trie, so release any waiter (the run proceeds unboosted, as before).
        stampBuilt();
      } finally {
        if (showSpinner) setBoostRebuilding(false);
      }
    }, BOOST_REBUILD_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); if (showSpinner) setBoostRebuilding(false); };
    // boostDepthScaling is a dep (unlike strength/min-p, which mutate the live
    // trie) because insert() bakes it into every node bonus, so a change needs
    // a rebuild. The rebuild is debounced and, on the prebuilt/cached path,
    // insert-only, so this stays cheap for curated lists. boostLineCount is
    // derived from boostPhrases (so it never fires on its own); it is listed
    // because the spinner gate reads it.
  }, [boostPhrases, boostLineCount, tokenizerVocabSig, compileBoostPhrases, boostDepthScaling]);

  // Apply the strength slider without rebuilding the trie.
  useEffect(() => {
    boostStrengthRef.current = boostStrength;
    if (phraseBoostRef.current) phraseBoostRef.current.strength = boostStrength;
    if (boostEncodedRef.current) boostEncodedRef.current.strength = boostStrength;
  }, [boostStrength]);

  // Apply the global min-p override without rebuilding the trie: it is a
  // decode-time gate (BoostingTrie.applyBoost), so mutating the live instance
  // is enough. 0 is the UI's "off" sentinel -> null (per-phrase gates apply).
  useEffect(() => {
    boostMinpRef.current = boostMinp;
    // Pass the value straight through: null = off (per-phrase gates), a number
    // in [0,1] = the global gate (0 = boost all, 1 = disabled). applyBoost reads
    // Math.log(override), and Math.log(0) = -Infinity is exactly "no gate".
    if (phraseBoostRef.current) phraseBoostRef.current.minpOverride = boostMinp;
    if (boostEncodedRef.current) boostEncodedRef.current.minpOverride = boostMinp;
  }, [boostMinp]);

  // Live mirrors of the boost-build-key inputs for waitForBoostReady().
  useEffect(() => { boostPhrasesRef.current = boostPhrases; }, [boostPhrases]);
  useEffect(() => { boostDepthScalingRef.current = boostDepthScaling; }, [boostDepthScaling]);

  // Keep the verbose-log ref current for the debounced rebuild closure.
  useEffect(() => { verboseLogRef.current = verboseLog; }, [verboseLog]);

  // Wait until the boost trie matches the current phrase list, depth scaling
  // and loaded vocab before a run starts decoding. The trie rebuilds
  // asynchronously (a 300 ms debounce plus BPE-encode time, inside an effect
  // that only runs after the next render), while a run can start SYNCHRONOUSLY
  // with the config change: on model-ready, loadModel publishes the vocab
  // signature and drains the capture queue in the same tick, so a queued
  // capture's run began before the rebuild effect had even been scheduled and
  // silently decoded boost-less (same file + same sidebar produced a different
  // transcript than every later run). Any manual upload inside the debounce
  // window raced it the same way. Polling with a real sleep (not a spin) keeps
  // this robust to that effect ordering; the cap means a pathological build
  // can only delay a run, never wedge it (it then proceeds exactly as before
  // the fix, and says so).
  async function waitForBoostReady(capMs = 30_000) {
    // Fast path: no phrases configured and no trie active -> nothing to wait for.
    if (!boostPhrasesRef.current.trim() && !phraseBoostRef.current) return;
    const t0 = performance.now();
    // The vocab signature hashes the whole id2token table; cache it per
    // tokenizer identity so the poll loop doesn't recompute it every tick.
    let sigTk = null, sigVal = null;
    for (;;) {
      const tk = modelRef.current?.tokenizer;
      if (tk !== sigTk) { sigTk = tk; sigVal = tk?.id2token ? vocabSignature(tk.id2token) : null; }
      const expected = boostBuildKey(boostPhrasesRef.current, boostDepthScalingRef.current, sigVal);
      if (boostBuiltKeyRef.current === expected) {
        const waited = performance.now() - t0;
        if (waited > 50 && verboseLogRef.current) {
          console.log(`[Boost] transcription waited ${Math.round(waited)}ms for the trie rebuild`);
        }
        return;
      }
      if (performance.now() - t0 > capMs) {
        console.warn(`[Boost] trie still building after ${Math.round(capMs)}ms; transcribing with the previous boost state.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    // --- Phrase text and the knobs the sidebar binds to ---------------------
    boostPhrases,
    setBoostPhrases,
    boostStrength,
    setBoostStrength,
    boostMinp,
    setBoostMinp,
    boostDepthScaling,
    setBoostDepthScaling,
    // --- Source selection (operator lists, Custom, Disabled) ----------------
    boostFiles,
    boostFilesLoaded,
    boostSource,
    setBoostSource,
    boostCustomText,
    setBoostCustomText,
    boostCustomTextRef,
    applyBoostSource,
    // Set by the settings restore: whether the user has an explicit saved
    // choice, which the ?phrase_boost= / env default must never override.
    boostSourceSavedRef,
    // --- Render-time size gates for the phrase textarea ---------------------
    boostLineCount,
    boostCollapsed,
    boostCustomOversize,
    boostEditorOpen,
    setBoostEditorOpen,
    toggleBoostingSection,
    // --- What the compile pass found ----------------------------------------
    boostWarnings,
    boostConflicts,
    boostUnkWarnings,
    boostPhraseCount,
    boostRebuilding,
    // --- Decoder-facing --------------------------------------------------
    // The live trie (main-thread decode) and its cloneable token ids (the
    // decode worker rebuilds an equivalent trie from these).
    phraseBoostRef,
    boostEncodedRef,
    waitForBoostReady,
    // The loaded tokenizer's vocab signature: published by loadModel, and the
    // one input that makes a model load or swap refresh the trie exactly once
    // (keying on `status` re-ran the whole rebuild on every chunk tick).
    tokenizerVocabSig,
    setTokenizerVocabSig,
  };
}
