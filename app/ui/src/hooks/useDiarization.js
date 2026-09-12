// Speaker diarization, as one hook: the "Speakers" view's state, the run
// itself, and the speaker rename/merge/persist helpers that read it.
//
// This is the first cluster lifted out of App(), which had grown to one 8800
// line function holding 231 state slots in a single scope. Diarization was a
// clean seam because its state is used by almost nothing else: 15 slots and
// four refs, of which only the caches the persist effect writes and the
// handful the entry UI renders cross the boundary at all. Everything that only
// diarization touches (the run's progress, the model-download error, the
// silence-cut cache, the embedding/name mirror refs) is now private to it.
//
// What deliberately stayed in App.jsx: `diarizedPlainText` and
// `renderDiarizedTranscript`. Both compose the diarized view with the DICTATION
// regex layer, which is a different feature with its own state, so they belong
// to the entry-display code rather than here.
//
// Built with Claude Code.

import { useState, useRef, useEffect } from 'react';
import { runDiarization, cancelDiarization, createDiarizerClient } from '../lib/diarizer.js';
import { findSilenceCuts, excisePcm, remapSegments } from '../lib/silenceCut.js';
import { shouldPiecewise, runPiecewiseDiarization } from '../lib/diarizePiecewise.js';
import { getDiarizationModels } from '../lib/diarizationModels.js';
import { assignSpeakersToWords, groupWordsIntoTurns, canonicalizeTurns } from '../lib/speakerAssign.js';
import { embedSpeakers } from '../lib/speakerEmbedding.js';
import { autoNameSpeakers, DEFAULT_MATCH_THRESHOLD } from '../lib/speakerMatch.js';
import { transcribeErrorMessage } from '../lib/format.js';

/**
 * @param {object} deps  everything diarization needs from the rest of App().
 * @param {(key:string)=>string} deps.t                 i18n lookup (speaker ordinals, error text).
 * @param {string} deps.status                          model-load status; the prefetch waits for 'modelReady'.
 * @param {Array} deps.transcriptions                   the history entries; the auto-run scans them.
 * @param {boolean} deps.forceLocalFallback             the model source is the local mirror only.
 * @param {{current:boolean}} deps.localFirstRef        HuggingFace preflight answer, shared with the ASR loader.
 * @param {object} deps.entryDisplayModes               per-entry base view overrides (an auto-run trigger).
 * @param {string} deps.transcriptDisplayMode           the global default display (an auto-run trigger).
 * @param {(id:string)=>string} deps.getEntryBase       effective base view for an entry.
 * @param {(id:string, base:string)=>void} deps.setEntryBase
 */
export function useDiarization({
  t,
  status,
  transcriptions,
  forceLocalFallback,
  localFirstRef,
  entryDisplayModes,
  transcriptDisplayMode,
  getEntryBase,
  setEntryBase,
}) {
  // Speaker diarization (optional "Speakers" view). diarizationCache maps an
  // entry id -> its [{start,end,speaker}] segments; diarizingId is the entry a
  // diarization run is currently in flight for (spinner + one-at-a-time guard).
  const [diarizationCache, setDiarizationCache] = useState({});
  const [diarizingId, setDiarizingId] = useState(null);
  // Progress of the in-flight diarization (the one on diarizingId), or null.
  // Only the long "piecewise" path can report progress (a single sherpa
  // process() is one synchronous WASM call with no intra-run signal); short
  // clips stay a bare spinner. Shape: {phase:'diarize'|'embed', done, total}.
  const [diarProgress, setDiarProgress] = useState(null);
  // Set to a human-readable reason when the diarization MODELS fail to download
  // (background prefetch or an on-demand run). Non-null greys out the Speakers
  // button + the sidebar's "Speakers" default-display option, with the reason
  // shown as a hover tooltip instead of a disruptive browser alert. Cleared on
  // the next successful model load. Viewing an entry's already-cached diarized
  // turns needs no models, so that path stays enabled regardless.
  const [diarizationModelError, setDiarizationModelError] = useState(null);
  // One-shot guard so the background prefetch fires exactly once per model load
  // (the status-keyed effect below would otherwise re-fire on every return to
  // 'modelReady', e.g. after each transcription; harmless on a memoised success
  // but a wasteful retry storm on a persistent download failure). Re-armed at
  // the start of loadModel.
  const diarPrefetchDoneRef = useRef(false);
  // Default speaker count for diarization: 0 (or any value <= 0) means
  // auto-detect (threshold clustering); a positive integer forces that many
  // speakers. Persisted; the per-entry kebab can override it for one entry.
  const [diarizationNumSpeakers, setDiarizationNumSpeakers] = useState(0);
  // Per-entry speaker-count override (id -> count) set from the entry's kebab;
  // re-segments that entry on change. Falls back to diarizationNumSpeakers.
  const [diarizationNumByEntry, setDiarizationNumByEntry] = useState({});
  // User-renamed speaker labels, per entry: id -> { speakerIndex -> name }.
  // Renaming updates every turn for that speaker (and the copied text). In
  // memory only, like diarizationCache. `editingSpeaker` is the `${id}:${turnIndex}`
  // of the label currently shown as an input, or null.
  const [speakerNames, setSpeakerNames] = useState({});
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  // Draft text shown in the speaker-rename input; applied on commit (Enter/blur)
  // so the merge-on-matching-name check fires once, not on every keystroke.
  const [editingSpeakerDraft, setEditingSpeakerDraft] = useState('');
  // Set true when Escape aborts a rename, so the trailing blur skips the commit.
  const renameCancelRef = useRef(false);
  // User speaker-merges, per entry: id -> { rawSpeakerIndex -> mergedIntoIndex }.
  // Renaming a speaker to another speaker's current label merges the two (same
  // colour + label), via union-find over the raw indices. In memory only; the
  // merge is baked into the persisted grouped turns (their `speaker` is the
  // root), so it survives a reload without persisting this map.
  const [speakerMerges, setSpeakerMerges] = useState({});
  // F-130: diarization persists ONLY the grouped turns (speaker index + turn
  // text), never per-word timings or raw float segments. After a reload an
  // entry's pcm/words are gone, so its restored turns live here (id -> [{speaker,
  // text}]) and back the diarized view + copy when no live segments exist.
  const [persistedTurns, setPersistedTurns] = useState({});
  // Cross-recording speaker matching (session-only). One CAM++ voice embedding
  // per (entry, speaker), kept in memory ONLY (voiceprints are biometric, never
  // persisted): id -> { speakerIndex -> Float32Array }. When a new recording is
  // diarized, its speakers are matched against the names the user gave speakers
  // in OTHER recordings, so the same voice auto-reuses the same label.
  const [speakerEmbeddings, setSpeakerEmbeddings] = useState({});
  // Refs mirror the latest embeddings/names so a diarization run that started
  // earlier still matches against entries diarized/renamed since (avoids stale
  // closures in the async diarizeEntry).
  const speakerEmbeddingsRef = useRef({});
  const speakerNamesRef = useRef({});
  // Silence-cut runs per entry (id -> Array<{start,end}> in samples). pcm is
  // immutable, so a numSpeakers-change re-run of diarizeEntry reuses these instead
  // of rescanning the whole clip's energy (the scan is O(N) over every sample).
  const silenceCutsRef = useRef({});

  // Mirror the latest embeddings/names into refs so a run that started earlier
  // still matches against entries diarized or renamed since it began.
  useEffect(() => { speakerEmbeddingsRef.current = speakerEmbeddings; }, [speakerEmbeddings]);
  useEffect(() => { speakerNamesRef.current = speakerNames; }, [speakerNames]);

  // --- Speaker diarization ---
  // Offline diarization needs the whole clip's PCM, which lives only on
  // in-memory entries (trans.pcm), so this is gated the same way as
  // "Transcribe again": unavailable on entries restored after a reload.
  async function diarizeEntry(trans, numSpeakersOverride) {
    if (!trans?.pcm || !trans.words?.length || diarizingId) return;
    // Per-entry kebab override wins; else the sidebar default. <= 0 means auto.
    const requested = Number.isInteger(numSpeakersOverride)
      ? numSpeakersOverride
      : (diarizationNumByEntry[trans.id] ?? diarizationNumSpeakers);
    setDiarizingId(trans.id);
    setDiarProgress(null);
    // Load the models first, in their own guard: a download failure here is not
    // a transcript-level error, so instead of a browser alert we record the
    // reason (greys out the Speakers controls with a hover tooltip) and bail.
    let models;
    try {
      models = await getDiarizationModels({
        localBaseUrl: '/models',
        localOnly: forceLocalFallback,
        // Same preflight answer the ASR weights use. These models live in their
        // own repos and had their own HF-first order, so on a network that
        // blocks HuggingFace they went on paying the connect timeout after the
        // ASR load had learned better. localFirst REORDERS rather than skips,
        // so a mirror that does not carry them still falls back to HuggingFace.
        localFirst: localFirstRef.current,
      });
      setDiarizationModelError(null);
    } catch (e) {
      console.error('[Diarize] model load failed:', e);
      setDiarizationModelError(transcribeErrorMessage(e));
      setDiarizingId(null);
      return;
    }
    const t0 = performance.now();
    try {
      // trans.pcm is a mono 16 kHz Float32Array (see the transcribeChunked call,
      // which hardcodes 16000). Excise long silences so the diarizer sees a
      // shorter clip; segments come back on the CONDENSED timeline and are remapped
      // to the original before anything downstream (embeddings, word assignment,
      // persistence) sees them. Only bother when there is a meaningful amount to
      // remove, so short/dense clips take exactly the old path.
      const DIAR_SR = 16000;
      let cuts = silenceCutsRef.current[trans.id];
      if (!cuts) {
        cuts = findSilenceCuts(trans.pcm, DIAR_SR);
        silenceCutsRef.current[trans.id] = cuts;
      }
      const totalExcised = cuts.reduce((s, c) => s + (c.end - c.start), 0);
      const worthExcising = totalExcised >= Math.max(5 * DIAR_SR, 0.10 * trans.pcm.length);
      const { pcm: diarPcm, map } = worthExcising
        ? excisePcm(trans.pcm, cuts, DIAR_SR)
        : { pcm: trans.pcm, map: null };
      if (worthExcising) {
        console.log(`[Diarize] excised ${(totalExcised / DIAR_SR).toFixed(1)}s of silence (${cuts.length} runs); diarizing ${(diarPcm.length / DIAR_SR).toFixed(1)}s of ${(trans.pcm.length / DIAR_SR).toFixed(1)}s`);
      }
      // numSpeakers <= 0 -> auto-detect (threshold-based); > 0 forces a count.
      const numSpk = requested > 0 ? requested : -1;
      const durSec = diarPcm.length / DIAR_SR;
      const piecewise = shouldPiecewise(durSec, numSpk);
      console.log(`[Diarize] start: ${durSec.toFixed(1)}s audio, ${numSpk > 0 ? `${numSpk} speakers (fixed)` : 'auto speaker count'}, ${piecewise ? 'piecewise' : 'single'} path`);
      const singleRun = () => runDiarization(diarPcm, {
        segmentationBytes: models.segmentationBytes,
        embeddingBytes: models.embeddingBytes,
        numSpeakers: numSpk,
      });
      let rawSegments;
      if (!piecewise) {
        rawSegments = await singleRun();
      } else {
        // Long, auto-detect clip: diarize silence-aligned pieces on a small pool of
        // workers concurrently, then reconcile speaker labels across pieces. Pool is
        // capped so K workers never oversubscribe the box (each runs its own ORT
        // threads), and the raised per-worker thread default (2a: cores-1) is DIVIDED
        // across the pool. Any non-cancel failure falls back to one full run (the
        // single path stays ground truth); a user cancel unwinds without a fallback.
        const hc = navigator.hardwareConcurrency || 4;
        const poolSize = Math.max(1, Math.min(3, Math.floor((hc - 1) / 4)));
        const perWorkerThreads = Math.max(1, Math.floor((hc - 1) / poolSize));
        const clients = Array.from({ length: poolSize }, () => createDiarizerClient());
        try {
          console.log(`[Diarize] piecewise: ${poolSize} workers x ${perWorkerThreads} threads over ${(diarPcm.length / DIAR_SR).toFixed(0)}s`);
          rawSegments = await runPiecewiseDiarization({
            pcm: diarPcm,
            sampleRate: DIAR_SR,
            clients,
            embed: embedSpeakers,
            embeddingBytes: models.embeddingBytes,
            diarOpts: {
              segmentationBytes: models.segmentationBytes,
              embeddingBytes: models.embeddingBytes,
              numThreads: perWorkerThreads,
            },
            onProgress: ({ phase, done, total }) => {
              setDiarProgress({ phase, done, total });
              if (phase === 'diarize' && done > 0) {
                console.log(`[Diarize] piece ${done}/${total} diarized`);
              } else if (phase === 'embed' && done === 0) {
                console.log(`[Diarize] reconciling speakers across ${total} pieces`);
              }
            },
          });
        } catch (err) {
          if (err && err.cancelled) throw err; // user cancelled: do NOT fall back
          console.warn('[Diarize] piecewise failed, falling back to single run:', err);
          setDiarProgress(null); // single run reports no progress; drop the stale %
          rawSegments = await singleRun();
        } finally {
          for (const c of clients) c.dispose();
        }
      }
      // Remap condensed-timeline segments back to the original timeline (identity
      // when nothing was excised). remapSegments splits any segment that bridges an
      // excised gap so it never inflates across the removed silence.
      const segments = map ? remapSegments(rawSegments, map, DIAR_SR) : rawSegments;
      const speakerCount = new Set(segments.map(s => s.speaker)).size;
      console.log(`[Diarize] done in ${((performance.now() - t0) / 1000).toFixed(1)}s: ${speakerCount} speaker(s), ${segments.length} segments`);
      setDiarizationCache(prev => ({ ...prev, [trans.id]: segments }));
      setEntryBase(trans.id, 'diarized');

      // Cross-recording speaker matching (session-only): embed each speaker's
      // voice, then auto-label any that match a name the user gave in another
      // recording. The diarized view already showed above, so an embedding
      // failure (or no prior names) is non-fatal: it just means no auto-naming.
      try {
        const embs = await embedSpeakers(trans.pcm, segments, models.embeddingBytes);
        if (Object.keys(embs).length > 0) {
          // Read the freshest embeddings/names via refs (other entries may have
          // diarized or been renamed since this run started).
          const allEmbeddings = { ...speakerEmbeddingsRef.current, [trans.id]: embs };
          setSpeakerEmbeddings(allEmbeddings);
          const auto = autoNameSpeakers(trans.id, allEmbeddings, speakerNamesRef.current, DEFAULT_MATCH_THRESHOLD);
          if (Object.keys(auto).length > 0) {
            // Existing names on this entry win; only fill unnamed speakers.
            setSpeakerNames(prev => ({ ...prev, [trans.id]: { ...auto, ...(prev[trans.id] || {}) } }));
          }
        }
      } catch (e) {
        console.warn('[Diarize] speaker embedding/matching failed (non-fatal):', e);
      }
    } catch (e) {
      // A user cancel (worker.terminate) rejects with `cancelled`: not an error.
      if (e?.cancelled) {
        console.log('[Diarize] cancelled by user');
      } else {
        console.error('[Diarize] failed:', e);
        alert(`${t('diarizeError')}: ${transcribeErrorMessage(e)}`);
      }
    } finally {
      setDiarizingId(null);
      setDiarProgress(null);
    }
  }

  // Abort the in-flight diarization (hard-terminates its worker). The pending
  // runDiarization rejects with `cancelled`, unwinding diarizeEntry quietly. When
  // nothing is cached to show, also drop the entry out of 'diarized' mode so the
  // auto-diarize effect doesn't immediately restart it (e.g. when "Speakers" is
  // the default display); a re-segmentation keeps its previous cached view.
  function cancelDiarizeEntry(trans) {
    cancelDiarization();
    setDiarizingId(null);
    setDiarProgress(null);
    if (!hasDiarization(trans)) setEntryBase(trans.id, 'raw');
  }

  // Auto-diarize: when an entry's effective display mode is 'diarized' (the
  // sidebar default or a per-entry override) but it has no cached segments yet,
  // run one in the background. One at a time (diarizingId guards); the effect
  // re-fires for the next entry once this one resolves.
  useEffect(() => {
    if (diarizingId) return;
    const next = transcriptions.find(
      tr => tr.pcm && tr.words?.length && getEntryBase(tr.id) === 'diarized' && !diarizationCache[tr.id],
    );
    if (next) diarizeEntry(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptions, entryDisplayModes, transcriptDisplayMode, diarizationCache, diarizingId]);

  // Background prefetch: once the ASR model has finished loading, warm the
  // ~34 MB of diarization models into the hub cache so the first Speakers run
  // is instant. Fire-and-forget so it never blocks recording or transcription;
  // getDiarizationModels is memoised, so this dedups with the on-click download
  // (and any earlier prefetch) and only fetches once. A failed prefetch is
  // non-fatal: the models then download lazily on the first Speakers click.
  useEffect(() => {
    if (status !== 'modelReady' || diarPrefetchDoneRef.current) return;
    diarPrefetchDoneRef.current = true;
    getDiarizationModels({ localBaseUrl: '/models', localOnly: forceLocalFallback, localFirst: localFirstRef.current })
      .then(() => setDiarizationModelError(null))
      .catch((e) => {
        console.warn('[Diarize] background model prefetch failed (non-fatal):', e);
        setDiarizationModelError(transcribeErrorMessage(e));
      });
  }, [status]);

  // Gap-free default speaker label for a display position: ordinal words for the
  // first twelve speakers ("First".."Twelfth"), then "Speaker N" beyond that.
  function defaultSpeakerName(position) {
    const ordinals = t('speakerOrdinals').split(',');
    if (position < ordinals.length) return ordinals[position];
    return `${t('speaker')} ${position + 1}`;
  }
  // The (possibly user-renamed) label for a speaker in an entry. `speaker` is the
  // stable root raw index (custom names are keyed by it); `position` is the
  // gap-free display slot used for the default ordinal name.
  function speakerDisplayName(entryId, speaker, position) {
    return speakerNames[entryId]?.[speaker] || defaultSpeakerName(position);
  }
  // Rename a speaker for one entry; applies to every turn for that speaker.
  function setSpeakerName(entryId, speaker, name) {
    setSpeakerNames(prev => ({
      ...prev,
      [entryId]: { ...(prev[entryId] || {}), [speaker]: name },
    }));
  }
  // Drop a speaker's custom name (revert to the default ordinal label). Prunes
  // the entry key when no custom names remain.
  function clearSpeakerName(entryId, speaker) {
    setSpeakerNames(prev => {
      if (!prev[entryId] || !(speaker in prev[entryId])) return prev;
      const names = { ...prev[entryId] };
      delete names[speaker];
      const next = { ...prev };
      if (Object.keys(names).length) next[entryId] = names; else delete next[entryId];
      return next;
    });
  }
  // Merge one speaker into another for an entry (renaming a speaker to another's
  // label). The merged-away speaker inherits the target's colour + label, so its
  // own custom name is dropped.
  function mergeSpeakers(entryId, fromRoot, intoRoot) {
    setSpeakerMerges(prev => ({
      ...prev,
      [entryId]: { ...(prev[entryId] || {}), [fromRoot]: intoRoot },
    }));
    clearSpeakerName(entryId, fromRoot);
  }
  // Apply the rename draft to a speaker turn. Empty or back-to-default clears the
  // custom name; a draft matching ANOTHER speaker's current label merges the two;
  // otherwise it sets a custom name. `turns` is the canonicalised turn list (so
  // the match is against the labels actually on screen).
  function commitSpeakerRename(entryId, turn, turns) {
    setEditingSpeaker(null);
    const root = turn.speaker;
    const name = editingSpeakerDraft.trim();
    if (!name || name === defaultSpeakerName(turn.position)) {
      clearSpeakerName(entryId, root);
      return;
    }
    const target = turns.find(tn => tn.speaker !== root &&
      speakerDisplayName(entryId, tn.speaker, tn.position).toLowerCase() === name.toLowerCase());
    if (target) {
      mergeSpeakers(entryId, root, target.speaker);
      return;
    }
    setSpeakerName(entryId, root, name);
  }

  // Speaker turns for an entry (or null when not diarized yet). Live entries
  // group their in-memory words against the cached segments; a reloaded entry
  // has no words/segments in memory (F-130) so it falls back to the grouped
  // turns restored from disk.
  function getDiarizedTurns(trans) {
    const segments = diarizationCache[trans.id];
    const turns = (segments && trans.words?.length)
      ? groupWordsIntoTurns(assignSpeakersToWords(trans.words, segments))
      : persistedTurns[trans.id];
    if (!turns) return null;
    // Apply user merges + gap-free renumbering so colours/labels are merged and
    // never skip an index (the diarizer can emit non-contiguous speaker indices).
    return canonicalizeTurns(turns, speakerMerges[trans.id]);
  }

  // True when an entry has a diarized view to show (live segments or restored
  // turns). Gates the Speakers button + diarized render on reloaded entries.
  function hasDiarization(trans) {
    return !!(diarizationCache[trans.id] || persistedTurns[trans.id]);
  }

  // Attach the opt-in diarization payload (grouped turns + speaker names) to a
  // transcript before it is persisted, so the diarized view + names come back
  // after reload. Returns the transcript unchanged when it has neither, so the
  // common (un-diarized) entry is not cloned. Reads the SAME grouped turns the
  // UI shows (live or restored), so deleting an entry re-persists the others'
  // diarization intact.
  function enrichTranscriptForPersist(trans) {
    const turns = getDiarizedTurns(trans);
    const names = speakerNames[trans.id];
    const hasTurns = Array.isArray(turns) && turns.length > 0;
    const hasNames = names && Object.keys(names).length > 0;
    if (!hasTurns && !hasNames) return trans;
    const out = { ...trans };
    if (hasTurns) out.diarTurns = turns.map(tn => ({ speaker: tn.speaker, text: tn.text }));
    if (hasNames) out.speakerNames = names;
    return out;
  }

  return {
    // Caches the persist effect and the entry UI read.
    diarizationCache,
    persistedTurns,
    setPersistedTurns,
    speakerNames,
    setSpeakerNames,
    // The in-flight run.
    diarizeEntry,
    cancelDiarizeEntry,
    diarizingId,
    diarProgress,
    diarizationModelError,
    diarPrefetchDoneRef,
    // Speaker count: the sidebar default and the per-entry kebab override.
    diarizationNumSpeakers,
    setDiarizationNumSpeakers,
    diarizationNumByEntry,
    setDiarizationNumByEntry,
    // Rename / merge, driven by the inline speaker-label input.
    speakerDisplayName,
    commitSpeakerRename,
    editingSpeaker,
    setEditingSpeaker,
    editingSpeakerDraft,
    setEditingSpeakerDraft,
    renameCancelRef,
    setSpeakerMerges,
    // Read models.
    getDiarizedTurns,
    hasDiarization,
    enrichTranscriptForPersist,
  };
}
