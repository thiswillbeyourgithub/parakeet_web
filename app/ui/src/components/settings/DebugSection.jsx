import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';

// The sidebar's Debug group: how much the console says, whether a run keeps its
// per-token decode trace, and the copyable support report.
//
// The logging select drives TWO settings on purpose. `showAdvancedInfo` (extra
// numbers in the UI) and `verboseLog` (ORT/engine console output) are separate
// stored values, but a support request needs both or neither, so one control
// writes both and reads as on when either is on.
export default function DebugSection({
  t,
  open,
  onToggle,
  showAdvancedInfo,
  setShowAdvancedInfo,
  verboseLog,
  setVerboseLog,
  saveSetting,
  debugDecode,
  setDebugDecode,
  supportReport,
  supportReportCopied,
  copySupportReport,
}) {
  return (
    <CollapsibleSection id="debug" title={t('settingsGroupDebug')} open={open} onToggle={onToggle}>
      <div className="setting-row">
        <span className="setting-label">
          {t('debugLogging')}:
          <InfoTooltip text={t('tooltipDebugLogging')} />
        </span>
        <select
          value={(showAdvancedInfo || verboseLog) ? 'full' : 'off'}
          onChange={e => {
            const on = e.target.value === 'full';
            setShowAdvancedInfo(on);
            saveSetting('showAdvancedInfo', on);
            setVerboseLog(on);
          }}
          style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
        >
          <option value="off">{t('debugOff')}</option>
          <option value="full">{t('debugFullLogs')}</option>
        </select>
      </div>
      <div className="setting-row">
        <label>
          <input
            type="checkbox"
            checked={debugDecode}
            onChange={e => setDebugDecode(e.target.checked)}
          />
          {t('debugDecode')}
          <InfoTooltip text={t('tooltipDebugDecode')} />
        </label>
      </div>
      <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
        <span className="setting-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            {t('supportReport')}
            <InfoTooltip text={t('tooltipSupportReport')} />
          </span>
          <button
            type="button"
            className="support-report-copy"
            onClick={copySupportReport}
            style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
          >
            {supportReportCopied ? t('copied') : t('supportReportCopy')}
          </button>
        </span>
        <textarea
          className="support-report-text"
          readOnly
          value={supportReport}
          spellCheck={false}
          wrap="off"
          aria-label={t('supportReport')}
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
      </div>
    </CollapsibleSection>
  );
}
