import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';
import { shortRepoLabel } from '../../lib/modelRepos.js';
import { describeLoadedModel } from '../../lib/loadedModel.js';
import { encoderQuantRows, ENCODER_QUANT_ROWS } from '../../lib/encoderQuants.js';
import { boldRuns } from '../../lib/format.js';
import { MIN_CHUNK_DURATION_SEC, MAX_CHUNK_DURATION_SEC } from '../../../../src/models.js';

// The sidebar's Engine group: which model, how it is chunked, which backend and
// precision it loads at, and the decoder knobs.
//
// Three handlers arrive as single callbacks rather than as the state they touch
// (`onRepoChange`, `onAutoconfigure`, `onCpuThreadsCommit`): each one arms a
// model reload and reads refs that only App owns, and passing those refs down
// would put the reload rules in two places.
export default function EngineSection({
  t,
  open,
  onToggle,
  modelRepos,
  repoId,
  onRepoChange,
  modelSource,
  modelSwapBlocked,
  enableChunking,
  setEnableChunking,
  chunkDuration,
  setChunkDuration,
  loadedModelInfo,
  backend,
  chooseBackend,
  armModelReloadIfLoaded,
  webgpuDisabled,
  webgpuAvailable,
  webgpuUnavailableReason,
  webgpuShaderF16,
  onAutoconfigure,
  probeState,
  probeVerdict,
  isWebgpuSelected,
  effectiveEncoderQuant,
  setWasmEncoderQuant,
  setWebgpuEncoderQuant,
  sourceRepoFiles,
  maxCores,
  cpuThreads,
  setCpuThreads,
  onCpuThreadsCommit,
  parallelEncode,
  setParallelEncode,
  frameStride,
  setFrameStride,
  beamWidth,
  setBeamWidth,
  beamWidthAuto,
  setBeamWidthAuto,
  maesNumSteps,
  setMaesNumSteps,
  maesExpansionBeta,
  setMaesExpansionBeta,
  maesExpansionGamma,
  setMaesExpansionGamma,
  maesPrefixAlpha,
  setMaesPrefixAlpha,
}) {
  return (
    <CollapsibleSection id="engine" title={t('settingsGroupEngine')} open={open} onToggle={onToggle}>
      {/* Model picker. Only rendered when the operator configured more
          than one repo in VITE_MODEL_REPO: with a single one there is
          nothing to choose and a one-option control would just be noise.
          Locked during a transcription like the other model-defining
          controls, since switching disposes the live session. Choosing
          here makes the choice the visitor's own, so it clears the
          ?model= flag and becomes persistable again. */}
      {modelRepos.length > 1 && (
        <div className="setting-row">
          <span className="setting-label">
            {t('model')}:
            <InfoTooltip text={t('tooltipModel')} />
          </span>
          <select
            value={repoId}
            onChange={e => onRepoChange(e.target.value)}
            disabled={modelSwapBlocked}
            style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
            data-umami-event="model_repo_select"
          >
            {modelRepos.map(id => (
              <option key={id} value={id} title={id}>{shortRepoLabel(id)}</option>
            ))}
          </select>
        </div>
      )}
      <p style={{ marginTop: 0 }}>
        <strong>{t('model')}:</strong>{' '}
        {/* Link to the HuggingFace model page whenever weights come from HF
            ('hf' or 'both'); in 'local' mode there is no HF page to open,
            so show the repo id as plain text. */}
        {modelSource !== 'local'
          ? <a href={`https://huggingface.co/${repoId}`} target="_blank" rel="noopener noreferrer">{repoId}</a>
          : repoId}
      </p>

      <div className="setting-row">
        <label>
          <input type="checkbox" checked={enableChunking} onChange={e => setEnableChunking(e.target.checked)} />
          {t('chunkLongAudio')}
          <InfoTooltip text={t('tooltipChunking')} />
        </label>
        {enableChunking && (
          <div style={{ marginTop: '0.25rem', width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('chunkDuration')} (s):
              <InfoTooltip text={t('tooltipChunkDuration')} />
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_CHUNK_DURATION_SEC}
              max={MAX_CHUNK_DURATION_SEC}
              step="1"
              value={chunkDuration}
              onChange={e => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setChunkDuration(Math.max(MIN_CHUNK_DURATION_SEC, Math.min(MAX_CHUNK_DURATION_SEC, v)));
              }}
              style={{ width: '5rem' }}
            />
          </div>
        )}
      </div>

      {/* What actually loaded, versus what the controls below request.
          Rendered only once a model is up, and called out when the two
          disagree. hub.js is allowed to resolve a request differently
          (the WASM int8 pin, the GPU->WASM fallback on a precision this
          source cannot serve, a switch to the /models mirror), and every
          one of those was invisible before this row existed: the controls
          kept showing the request, so a station could sit on
          "WebGPU / fp32" while an int8 CPU model did the work. */}
      {(() => {
        const described = describeLoadedModel(
          loadedModelInfo,
          { repoId, backend, encoderQuant: effectiveEncoderQuant },
          {
            wasm: t('wasmCpu'),
            webgpu: t('webgpu'),
            fromHub: t('loadedFromHub'),
            fromLocal: t('loadedFromLocal'),
          },
        );
        if (!described) return null;
        return (
          <div className={`setting-row setting-row--loaded${described.mismatch ? ' setting-row--mismatch' : ''}`}>
            <span className="setting-label">
              {t('loadedModel')}:
              <InfoTooltip text={t('tooltipLoadedModel')} />
            </span>
            <span className="loaded-model-value" data-testid="loaded-model">{described.text}</span>
            {described.mismatch && <p className="setting-hint">{t('loadedDiffers')}</p>}
          </div>
        );
      })()}

      <div className="setting-row">
        <span className="setting-label">
          {t('backend')}:
          <InfoTooltip text={t('tooltipBackend')} />
        </span>
        <div className="setting-options">
          <label className={modelSwapBlocked ? 'disabled-option' : ''}>
            <input type="radio" name="backend" value="wasm" checked={backend === 'wasm'} onChange={e => { armModelReloadIfLoaded(); chooseBackend(e.target.value); }} disabled={modelSwapBlocked} />
            {t('wasmCpu')}
          </label>
          <label className={modelSwapBlocked || webgpuDisabled || webgpuAvailable === false ? 'disabled-option' : ''}>
            <input type="radio" name="backend" value="webgpu-hybrid" checked={backend === 'webgpu-hybrid'} onChange={e => { armModelReloadIfLoaded(); chooseBackend(e.target.value); }} disabled={modelSwapBlocked || webgpuDisabled || webgpuAvailable === false} />
            {webgpuDisabled ? t('webgpuDisabled') : (webgpuAvailable === false ? t('webgpuUnavailable') : t('webgpu'))}
            {webgpuDisabled ? (
              <InfoTooltip text={t('tooltipWebgpuDisabled')} />
            ) : (webgpuAvailable === false && (
              <InfoTooltip text={t(`webgpuReason_${webgpuUnavailableReason || 'noAdapter'}`)} />
            ))}
          </label>
        </div>
      </div>

      {/* Autoconfigure: time both providers on THIS machine and pick.
          Offered whenever WebGPU could be selected here, because that is
          the only case where the answer can change anything. */}
      {!webgpuDisabled && webgpuAvailable !== false && (
        <div className="setting-row">
          <span className="setting-label">
            {t('autoconfigure')}: <InfoTooltip text={t('tooltipAutoconfigure')} />
          </span>
          <div className="setting-options">
            <button
              type="button"
              className="primary"
              onClick={onAutoconfigure}
              disabled={probeState === 'running' || modelSwapBlocked}
              data-umami-event="autoconfigure_button"
            >
              {probeState === 'running' ? t('autoconfigureRunning') : t('autoconfigureRun')}
            </button>
            {probeState !== 'running' && probeVerdict && (
              <span className="setting-hint">
                {probeVerdict.backend === 'webgpu-hybrid'
                  ? t('autoconfigureResultGpu', { speedup: (probeVerdict.speedup ?? 0).toFixed(1) })
                  : (probeVerdict.speedup
                    ? t('autoconfigureResultCpu', { speedup: (probeVerdict.speedup ?? 0).toFixed(1) })
                    : t('autoconfigureResultCpuOnly'))}
              </span>
            )}
            {probeState === 'failed' && (
              <span className="setting-hint">{t('autoconfigureFailed')}</span>
            )}
          </div>
        </div>
      )}

      {(backend === 'wasm' || backend.startsWith('webgpu')) && (() => {
        // One display order (w4a8 / int8 lite / int8 / fp16 / fp32, by
        // ascending download size, see ENCODER_QUANT_ROWS), filtered per
        // backend and per source. Neither int8 build has a GPU encoder
        // kernel and fp16 has no usable WASM one, so those rows are
        // absent rather than greyed; fp32 and w4a8 run on both, w4a8
        // through the MatMulNBits kernel the GPU EP does implement. The
        // remembered selection is per-backend, so WASM keeps its choice
        // independently of WebGPU.
        // The runnable/effective rules live in lib/encoderQuants.js and
        // are resolved once at component scope (effectiveEncoderQuant)
        // because the loaded-model row above needs the same answer; a
        // local copy here is how the two would drift apart.
        const isWebgpu = isWebgpuSelected;
        const setQuant = isWebgpu ? setWebgpuEncoderQuant : setWasmEncoderQuant;
        const effectiveQuant = effectiveEncoderQuant;
        // int8 is the default on WASM. int8 lite is the same recipe with
        // fewer MatMuls quantised: ~88 MB smaller and lighter on RAM, at
        // slightly higher error, and only the model repo ships it (a repo
        // without it surfaces the quantUnavailable banner rather than
        // silently loading the heavier int8). w4a8 is the 4-bit build:
        // the smallest download by far and the fastest to load, but
        // slower to run than int8 on WASM and than fp32 on WebGPU (the
        // encoder is compute-bound, so shrinking the weights buys load
        // time, not throughput). fp16 is WebGPU-only: lossless at
        // half the fp32 download, the best GPU option on an adapter that
        // reports shader-f16. fp32 is opt-in on WASM via the <2 GB
        // shards (~2.4 GB, ~35 % slower) and the WebGPU default.
        // Built from ENCODER_QUANT_ROWS so the radios and the whitelists
        // the settings restore validates against cannot drift apart: a
        // value offered here but missing there would be silently reset to
        // int8 on the next reload, which is exactly how int8lite first
        // shipped without surviving a page load. A value with no entry in
        // PRECISION_ROW throws here rather than rendering a blank radio.
        const PRECISION_ROW = {
          int8lite: () => t('precisionInt8Lite'),
          int8: () => t('precisionInt8'),
          w4a8: () => t('precisionW4a8'),
          fp16: () => t('precisionFp16'),
          fp32: () => t('precisionFp32'),
        };
        // Which rows exist at all is policy, not rendering, so it lives in
        // lib/encoderQuants.js with the rest of the three-question
        // taxonomy: a precision this BACKEND has no kernel for, or one
        // this SOURCE does not host, is not rendered, and only a
        // precision the MACHINE cannot run gets a greyed row with a
        // reason. The greyed row is worth keeping for exactly that case
        // because the visitor's own adapter is the thing that decided it.
        const rows = encoderQuantRows({
          backend,
          repoFiles: sourceRepoFiles,
          shaderF16: webgpuShaderF16 === true,
          order: ENCODER_QUANT_ROWS,
        }).map((r) => ({
          ...r,
          label: PRECISION_ROW[r.value](),
          note: r.reason === 'no-shader-f16' ? t('precisionUnavailableNoF16')
            : r.reason === 'source' ? t('precisionUnavailableSource')
              : '',
        }));
        return (
          <div className="setting-row">
            <span className="setting-label">
              {t('encoderPrecision')}:
              <InfoTooltip text={t('tooltipEncoderPrecision')} />
            </span>
            <div className="setting-options">
              {/* The rows run smallest download first (ENCODER_QUANT_ROWS),
                  and that is worth stating because the obvious reading of
                  the ladder is wrong: the smallest entry, w4a8, is also
                  the slowest to run and the weakest on long audio. Without
                  this line a visitor reasonably assumes small means fast.
                  Full width so it sits on its own line above the radios. */}
              <span className="setting-hint precision-order-hint">{t('precisionOrderHint')}</span>
              {rows.map(r => {
                const disabled = modelSwapBlocked || !r.available;
                return (
                  <label key={r.value} className={disabled ? 'disabled-option' : ''}>
                    <input type="radio" name="encoderQuant" value={r.value} checked={r.available && effectiveQuant === r.value} onChange={e => { armModelReloadIfLoaded(); setQuant(e.target.value); }} disabled={disabled} />
                    {/* The label carries `**bold**` markers (int8's
                        "recommended"), so it renders as runs rather than
                        as one text node. */}
                    <span>{boldRuns(r.label).map((run, i) => (run.bold ? <strong key={i}>{run.text}</strong> : run.text))}{!r.available ? ` ${r.note}` : ''}</span>
                  </label>
                );
              })}
              {/* Nothing here is checked, which needs saying rather than
                  leaving a group of radios looking undecided: the visitor
                  is on a GPU backend whose default (fp16) this machine or
                  this source cannot deliver, and the app will not pick
                  fp32 or w4a8 for them. So a load started now moves to
                  the processor at int8, and the note says so before they
                  press the button rather than as a banner after it. */}
              {effectiveQuant === null && isWebgpu && (
                <span className="setting-hint">{t('precisionNoneAutoUsable')}</span>
              )}
            </div>
          </div>
        );
      })()}

      {(backend === 'wasm' || backend.startsWith('webgpu')) && (
        <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <span className="setting-label" style={{ flex: '1 1 auto' }}>
            {t('cpuThreads')} (1-{maxCores}):
            <InfoTooltip text={t('tooltipCpuThreads')} />
          </span>
          <input
            type="number"
            name="cpuThreads"
            inputMode="numeric"
            min="1"
            max={maxCores}
            value={cpuThreads}
            onChange={e=>{
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setCpuThreads(Math.max(1, Math.min(maxCores, v)));
            }}
            onBlur={onCpuThreadsCommit}
            disabled={modelSwapBlocked}
            style={{ width: '4.5rem', opacity: modelSwapBlocked ? 0.5 : 1 }}
          />
        </div>
      )}

      {backend === 'wasm' && (
        <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ flex: '1 1 auto' }}>
            <input
              type="checkbox"
              name="parallelEncode"
              checked={parallelEncode}
              onChange={e => setParallelEncode(e.target.checked)}
              disabled={modelSwapBlocked}
            />
            {' '}{t('parallelEncode')}
            <InfoTooltip text={t('tooltipParallelEncode')} />
          </label>
        </div>
      )}

      <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span className="setting-label" style={{ flex: '1 1 auto' }}>
          {t('frameStride')} (1-4):
          <InfoTooltip text={t('tooltipFrameStride')} />
        </span>
        <input
          type="number"
          inputMode="numeric"
          min="1"
          max="4"
          value={frameStride}
          onChange={e=>{
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setFrameStride(Math.max(1, Math.min(4, v)));
          }}
          style={{ width: '4.5rem' }}
        />
      </div>

      <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span className="setting-label" style={{ flex: '1 1 auto' }}>
          {t('beamWidth')} (1-10):
          <InfoTooltip text={t('tooltipBeamWidth')} />
          {beamWidthAuto && <span className="setting-hint"> {t('beamWidthAutoHint')}</span>}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min="1"
          max="10"
          value={beamWidth}
          onChange={e=>{
            const v = Number(e.target.value);
            if (Number.isFinite(v)) {
              // An explicit edit ends the boost-state coupling for good.
              setBeamWidthAuto(false);
              setBeamWidth(Math.max(1, Math.min(10, Math.round(v))));
            }
          }}
          style={{ width: '4.5rem' }}
        />
      </div>

      {/* MAES knobs: only meaningful when beamWidth>1 (the decoder ignores
          them at width 1, which is plain greedy), so hide them otherwise. */}
      {beamWidth > 1 && (
        <>
          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('maesNumSteps')}:
              <InfoTooltip text={t('tooltipMaesNumSteps')} />
            </span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="10"
              value={maesNumSteps}
              onChange={e=>{
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMaesNumSteps(Math.max(1, Math.min(10, Math.round(v))));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>

          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('maesExpansionBeta')}:
              <InfoTooltip text={t('tooltipMaesExpansionBeta')} />
            </span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="10"
              value={maesExpansionBeta}
              onChange={e=>{
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMaesExpansionBeta(Math.max(0, Math.min(10, Math.round(v))));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>

          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('maesExpansionGamma')}:
              <InfoTooltip text={t('tooltipMaesExpansionGamma')} />
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              max="20"
              step="0.1"
              value={maesExpansionGamma}
              onChange={e=>{
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setMaesExpansionGamma(Math.min(20, v));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>

          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('maesPrefixAlpha')}:
              <InfoTooltip text={t('tooltipMaesPrefixAlpha')} />
            </span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="5"
              value={maesPrefixAlpha}
              onChange={e=>{
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMaesPrefixAlpha(Math.max(0, Math.min(5, Math.round(v))));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>
        </>
      )}

    </CollapsibleSection>
  );
}
