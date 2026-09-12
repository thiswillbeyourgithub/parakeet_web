import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';

// The sidebar's Recording group: what the browser does to the microphone
// signal, the remote-mic gain (shown only when a phone is acting as the mic),
// and live transcription with its context window.
//
// The capture-shaping controls are disabled DURING a recording rather than
// hidden: they are applied when the stream is opened, so changing one mid-take
// would say something the running capture is not doing.
export default function RecordingSection({
  t,
  open,
  onToggle,
  isRecording,
  noiseSuppression,
  setNoiseSuppression,
  autoGainControl,
  setAutoGainControl,
  isRemoteMic,
  remoteMicGain,
  setRemoteMicGain,
  liveTranscriptionEnabled,
  setLiveTranscriptionEnabled,
  liveContextWindow,
  setLiveContextWindow,
}) {
  return (
    <CollapsibleSection id="recording" title={t('settingsGroupRecording')} open={open} onToggle={onToggle}>
      <div className="setting-row">
        <span className="setting-label">
          {t('audioProcessing')}:
        </span>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={e => setNoiseSuppression(e.target.checked)}
              disabled={isRecording}
            />
            {t('noiseSuppression')}
            <InfoTooltip text={t('tooltipNoiseSuppression')} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoGainControl}
              onChange={e => setAutoGainControl(e.target.checked)}
              disabled={isRecording}
            />
            {t('autoGainControl')}
            <InfoTooltip text={t('tooltipAutoGainControl')} />
          </label>
        </div>
      </div>

      {isRemoteMic && (
        <div className="setting-row">
          <span className="setting-label" style={{ flex: '1 1 auto' }}>
            {t('remoteMicGain')}:
            <InfoTooltip text={t('tooltipRemoteMicGain')} />
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0.5"
            max="5"
            step="0.1"
            value={remoteMicGain}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setRemoteMicGain(Math.max(0.5, Math.min(5, v)));
            }}
            style={{ width: '5rem' }}
          />
        </div>
      )}

      <div className="setting-row">
        <label>
          <input
            type="checkbox"
            checked={liveTranscriptionEnabled}
            onChange={e => setLiveTranscriptionEnabled(e.target.checked)}
            disabled={isRecording}
          />
          {t('liveTranscription')}
          <InfoTooltip text={t('tooltipLiveTranscription')} />
        </label>
        {liveTranscriptionEnabled && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="setting-label">
              {t('liveContextWindow')}:
              <InfoTooltip text={t('tooltipLiveContextWindow')} />
            </span>
            <select
              value={liveContextWindow}
              onChange={e => setLiveContextWindow(e.target.value)}
              disabled={isRecording}
            >
              <option value="auto">{t('liveContextAuto')}</option>
              <option value="10">10s</option>
              <option value="15">15s</option>
              <option value="20">20s</option>
              <option value="30">30s</option>
              <option value="45">45s</option>
              <option value="60">60s</option>
            </select>
          </div>
        )}
        {liveTranscriptionEnabled && (
          <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0.25rem 0 0' }}>
            {t('liveStreamingNote')}
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
}
