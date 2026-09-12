import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';

// The sidebar's General group: the keyboard-shortcut opt-in and its cheat
// sheet, what happens to a finished transcript (auto-copy, spelled numbers to
// digits, whether history survives a reload), and which view a transcript opens
// in by default.
//
// The display-mode options are DISABLED rather than hidden when they cannot be
// served: a Speakers default with no diarization models greys out and says why
// on hover, and the dictation options only exist when rules are configured.
export default function GeneralSection({
  t,
  open,
  onToggle,
  keyboardShortcutsEnabled,
  setKeyboardShortcutsEnabled,
  showShortcuts,
  setShowShortcuts,
  autoCopyToClipboard,
  setAutoCopyToClipboard,
  numbersToDigits,
  setNumbersToDigits,
  persistTranscripts,
  setPersistTranscripts,
  forgetPersistedTranscripts,
  transcriptDisplayMode,
  setTranscriptDisplayMode,
  dictationRegexRules,
  diarizationModelError,
  diarizationNumSpeakers,
  setDiarizationNumSpeakers,
}) {
  return (
    <CollapsibleSection id="general" title={t('settingsGroupGeneral')} open={open} onToggle={onToggle}>
      <div className="setting-row" style={{ marginBottom: '0.5rem' }}>
        <label>
          <input
            type="checkbox"
            checked={keyboardShortcutsEnabled}
            onChange={e => setKeyboardShortcutsEnabled(e.target.checked)}
          />
          {t('enableKeyboardShortcuts')}
          <InfoTooltip text={t('tooltipKeyboardShortcuts')} />
        </label>
      </div>

      <button
        onClick={() => setShowShortcuts(prev => !prev)}
        style={{ marginBottom: '0.75rem', width: '100%' }}
        className="primary"
      >
        {showShortcuts ? t('hideKeyboardShortcuts') : t('showKeyboardShortcuts')}
      </button>

      {showShortcuts && (
        <div style={{
          marginBottom: '0.75rem',
          padding: '0.75rem',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          borderRadius: '4px',
          border: '1px solid var(--border)',
          fontSize: '0.9rem',
          lineHeight: '1.8'
        }}>
          <strong>{t('keyboardShortcuts')}</strong>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
            <tbody>
              {[
                ['S', t('shortcutToggleSettings')],
                ['Space / Enter', t('shortcutLoadModel')],
                ['R / Space', t('shortcutStartRecording')],
                ['R / S / Space', t('shortcutStopRecording')],
                ['P', t('shortcutPauseRecording')],
                ['F', t('shortcutSelectFile')],
              ].map(([key, desc]) => (
                <tr key={key}>
                  <td style={{ padding: '0.15rem 0.5rem 0.15rem 0', fontWeight: 'bold', fontFamily: 'monospace' }}>{key}</td>
                  <td style={{ padding: '0.15rem 0' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
            {t('shortcutsDisabledInInputs')}
          </p>
        </div>
      )}

      <div className="setting-row">
        <label>
          <input type="checkbox" checked={autoCopyToClipboard} onChange={e => setAutoCopyToClipboard(e.target.checked)} />
          {t('autoCopyToClipboard')}
          <InfoTooltip text={t('tooltipAutoCopy')} />
        </label>
      </div>

      <div className="setting-row">
        <label>
          <input type="checkbox" checked={numbersToDigits} onChange={e => setNumbersToDigits(e.target.checked)} />
          {t('numbersToDigits')}
          <InfoTooltip text={t('tooltipNumbersToDigits')} />
        </label>
      </div>

      <div className="setting-row">
        <label>
          <input
            type="checkbox"
            checked={persistTranscripts}
            onChange={e => {
              const next = e.target.checked;
              setPersistTranscripts(next);
              // Toggle OFF: scrub the on-disk copy immediately so the
              // user's existing history doesn't sit there forever.
              // usePersistedSetting's gate already stops new writes.
              if (!next) forgetPersistedTranscripts();
            }}
          />
          {t('persistTranscripts')}
          <InfoTooltip text={t('tooltipPersistTranscripts')} />
        </label>
      </div>

      <div className="setting-row">
        <span className="setting-label">
          {t('defaultTranscriptDisplay')}:
          <InfoTooltip text={t('tooltipDisplayMode')} />
        </span>
        <select
          value={transcriptDisplayMode}
          onChange={e => setTranscriptDisplayMode(e.target.value)}
          style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
        >
          <option value="raw">{t('raw')}</option>
          {dictationRegexRules.length > 0 && <option value="dictation">{t('dictationRules')} ({dictationRegexRules.length} {t('dictationRulesExperimental')}</option>}
          {/* Grey out the Speakers default options when the diarization
              models could not be loaded; the title surfaces the reason on
              hover in the open dropdown. */}
          <option value="diarized" disabled={!!diarizationModelError} title={diarizationModelError ? `${t('diarizeModelsUnavailable')} (${diarizationModelError})` : undefined}>{t('speakers')}</option>
          {dictationRegexRules.length > 0 && <option value="diarized+dictation" disabled={!!diarizationModelError} title={diarizationModelError ? `${t('diarizeModelsUnavailable')} (${diarizationModelError})` : undefined}>{t('speakers')} + {t('dictationExp')}</option>}
        </select>
      </div>

      <div className="setting-row">
        <span className="setting-label">
          {t('numSpeakers')}:
          <InfoTooltip text={t('tooltipNumSpeakers')} />
        </span>
        <select
          value={diarizationNumSpeakers}
          onChange={e => setDiarizationNumSpeakers(parseInt(e.target.value, 10) || 0)}
          style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
        >
          <option value="0">{t('auto')}</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    </CollapsibleSection>
  );
}
