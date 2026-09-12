import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';
import Banner from '../Banner.jsx';
import { estimatedDownloadMB } from '../../lib/benchmark.js';
import { formatDuration } from '../../lib/format.js';

// The sidebar's Benchmark group: one click measures every backend/precision
// this device can run, on a clip that ships with the app, then builds one
// anonymised report the user can read before copying or sending it.
//
// The results table shows speed as AUDIO PER SECOND OF COMPUTE, not the
// conventional rtf. Both describe the same measurement, but this way round
// reads without translation ("6x" is an hour of audio in ten minutes, bigger is
// better) and matches every other speed figure in the app. The report still
// stores rtf so older reports and scripts/benchmark-throughput.mjs stay
// comparable; the two are reciprocals, so nothing is lost.
export default function BenchmarkSection({
  t,
  open,
  onToggle,
  benchmarkPlan,
  benchmarkSelected,
  setBenchmarkSelected,
  benchmarkRunning,
  benchmarkLongProfile,
  setBenchmarkLongProfile,
  benchmarkRepeats,
  setBenchmarkRepeats,
  isTranscribing,
  runBenchmark,
  onCancel,
  benchmarkProgress,
  benchmarkDone,
  benchmarkResults,
  benchmarkReport,
  benchmarkReportRef,
  copyBenchmarkReport,
  benchmarkCopied,
  uploadEnabled,
  benchmarkSendState,
  sendBenchmarkReport,
  benchmarkAutoSend,
  setBenchmarkAutoSend,
}) {
  return (
    <CollapsibleSection id="benchmark" title={t('settingsGroupBenchmark')} open={open} onToggle={onToggle}>
      <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
        {t('benchmarkIntro')}
      </p>
      <Banner tone="warning" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>
        {t('benchmarkCacheWarning')}
      </Banner>

      <div className="setting-row">
        <span className="setting-label">
          {t('benchmarkCombos')}:
          <InfoTooltip text={t('tooltipBenchmarkCombos')} />
        </span>
        <div className="setting-options">
          {benchmarkPlan.length === 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>{t('benchmarkNoCombos')}</span>
          )}
          {benchmarkPlan.map(row => (
            <label key={row.id} className={benchmarkRunning ? 'disabled-option' : ''}>
              <input
                type="checkbox"
                name={`benchmark-combo-${row.id}`}
                checked={!!benchmarkSelected[row.id]}
                disabled={benchmarkRunning}
                onChange={e => setBenchmarkSelected(prev => ({ ...prev, [row.id]: e.target.checked }))}
              />
              {row.backend === 'wasm' ? t('wasmCpu') : t('webgpu')} / {row.quant}
              <span style={{ color: 'var(--text-subtle)' }}>
                {row.cached ? ` (${t('benchmarkAlreadyDownloaded')})` : ` (~${row.downloadMB} MB)`}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <label className={benchmarkRunning ? 'disabled-option' : ''}>
          <input
            type="checkbox"
            name="benchmarkLongProfile"
            checked={benchmarkLongProfile}
            disabled={benchmarkRunning}
            onChange={e => setBenchmarkLongProfile(e.target.checked)}
          />
          {t('benchmarkLongProfile')}
          <InfoTooltip text={t('tooltipBenchmarkLongProfile')} />
        </label>
      </div>

      <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span className="setting-label" style={{ flex: '1 1 auto' }}>
          {t('benchmarkRepeats')} (1-3):
          <InfoTooltip text={t('tooltipBenchmarkRepeats')} />
        </span>
        <input
          type="number"
          name="benchmarkRepeats"
          inputMode="numeric"
          min="1"
          max="3"
          value={benchmarkRepeats}
          disabled={benchmarkRunning}
          onChange={e => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setBenchmarkRepeats(Math.max(1, Math.min(3, Math.round(v))));
          }}
          style={{ width: '4rem' }}
        />
      </div>

      {(() => {
        const selected = benchmarkPlan.filter(c => benchmarkSelected[c.id]);
        const mb = estimatedDownloadMB(selected, benchmarkPlan.filter(c => c.cached).map(c => c.id));
        return (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', margin: '0.25rem 0 0.5rem' }}>
            {t('benchmarkEstimatedDownload')}: {mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`}
          </p>
        );
      })()}

      <button
        type="button"
        className="primary"
        style={{ width: '100%' }}
        data-umami-event="benchmark_run"
        disabled={benchmarkRunning || isTranscribing || !benchmarkPlan.some(c => benchmarkSelected[c.id])}
        onClick={runBenchmark}
      >
        {benchmarkRunning ? t('benchmarkRunning') : t('benchmarkRun')}
      </button>
      {benchmarkRunning && (
        <button
          type="button"
          style={{ width: '100%', marginTop: '0.35rem' }}
          onClick={onCancel}
        >
          {t('cancel')}
        </button>
      )}
      {benchmarkProgress && (
        <p className="benchmark-progress" style={{ fontSize: '0.78rem', margin: '0.4rem 0 0' }}>{benchmarkProgress}</p>
      )}

      {benchmarkDone && !benchmarkRunning && (
        <p className="benchmark-complete">{t('benchmarkComplete')}</p>
      )}

      {benchmarkResults.length > 0 && (
        <table className="benchmark-results">
          <thead>
            <tr>
              <th>{t('benchmarkColBackend')}</th>
              <th>{t('benchmarkColProfile')}</th>
              <th>{t('benchmarkColSpeed')}</th>
              <th>{t('benchmarkColLoad')}</th>
            </tr>
          </thead>
          <tbody>
            {benchmarkResults.map((r, i) => (
              <tr
                key={`${r.id}-${r.profile || 'na'}-${i}`}
                className={r.status === 'pending' || r.status === 'running' ? 'benchmark-row--waiting' : ''}
                data-testid={`benchmark-row-${r.id}-${r.profile || 'na'}`}
                data-status={r.status}
              >
                <td>{r.backend} / {r.quant}</td>
                <td>{r.profile || '-'}</td>
                <td>
                  {/* Speed as AUDIO PER SECOND OF COMPUTE, not the
                      inverse. Both describe the same measurement, but this
                      way round is the one that reads without translation:
                      "6x" means an hour of audio in ten minutes, and
                      bigger is better, which is what every other speed
                      figure in the app already means. The report keeps the
                      conventional rtf (compute per second of audio) so
                      scripts/benchmark-throughput.mjs and older reports
                      stay comparable; the two are reciprocals, so nothing
                      is lost by showing one and storing the other. */}
                  {r.status === 'ok' ? (
                    `${r.rtf > 0 ? `${(1 / r.rtf).toFixed(2)}x` : '-'} (${formatDuration((r.wallMs || 0) / 1000)})`
                  ) : r.status === 'pending' ? (
                    // An em dash would be a value; this is the absence of
                    // one, and it has to stay visibly different from a row
                    // that ran and produced nothing.
                    <span className="benchmark-cell--pending">{t('benchmarkRowPending')}</span>
                  ) : r.status === 'running' ? (
                    <span className="benchmark-cell--running">
                      <span className="spinner spinner--inline" aria-hidden="true" />
                      {r.phase || t('benchmarkTranscribing')}
                    </span>
                  ) : t(`benchmarkStatus_${r.status}`)}
                  {r.status === 'ok' && r.similarity != null && r.similarity < 0.8 && (
                    <span style={{ color: 'var(--danger)' }}> ⚠</span>
                  )}
                </td>
                {/* A load time means little on its own: a cold load times a
                    download on this connection, a warm one a cache read plus
                    session build. The GPU rows are always cold, because the
                    fp32 shards cannot be cached. */}
                <td>
                  {r.loadMs != null ? formatDuration(r.loadMs / 1000)
                    : (r.status === 'pending' || r.status === 'running') ? '' : '-'}
                  {r.loadCached === true && <span className="benchmark-load-note"> ({t('benchmarkLoadCached')})</span>}
                  {r.loadCached === false && r.loadDownloadMB > 0 && (
                    <span className="benchmark-load-note"> ({Math.round(r.loadDownloadMB)} MB)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {benchmarkReport && (
        <div ref={benchmarkReportRef} className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem', marginTop: '0.5rem' }}>
          <span className="setting-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              {t('benchmarkReport')}
              <InfoTooltip text={t('tooltipBenchmarkReport')} />
            </span>
            <button
              type="button"
              className="benchmark-report-copy"
              onClick={copyBenchmarkReport}
              style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
            >
              {benchmarkCopied ? t('copied') : t('supportReportCopy')}
            </button>
          </span>
          <textarea
            className="benchmark-report-text"
            readOnly
            value={benchmarkReport}
            spellCheck={false}
            wrap="off"
            aria-label={t('benchmarkReport')}
            style={{
              width: '100%',
              minHeight: '6rem',
              maxHeight: '11rem',
              overflow: 'auto',
              resize: 'vertical',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '0.68rem',
              lineHeight: 1.35,
              whiteSpace: 'pre',
              border: '1px solid var(--border-strong)',
              borderRadius: '4px',
              padding: '0.4rem',
              boxSizing: 'border-box',
            }}
          />
          {uploadEnabled && (
            <>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', margin: 0 }}>
                {t('benchmarkSendExplainer')}
              </p>
              <button
                type="button"
                className="primary"
                data-umami-event="benchmark_send"
                disabled={benchmarkSendState === 'sending' || benchmarkSendState === 'sent'}
                onClick={() => sendBenchmarkReport(benchmarkReport)}
              >
                {benchmarkSendState === 'sent' ? t('benchmarkSent')
                  : benchmarkSendState === 'sending' ? t('benchmarkSending')
                  : t('benchmarkSend')}
              </button>
              {benchmarkSendState === 'failed' && (
                <p style={{ fontSize: '0.78rem', color: 'var(--danger)', margin: 0 }}>{t('benchmarkSendFailed')}</p>
              )}
              <label>
                <input
                  type="checkbox"
                  name="benchmarkAutoSend"
                  checked={benchmarkAutoSend}
                  onChange={e => setBenchmarkAutoSend(e.target.checked)}
                />
                {t('benchmarkAutoSend')}
                <InfoTooltip text={t('tooltipBenchmarkAutoSend')} />
              </label>
            </>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
