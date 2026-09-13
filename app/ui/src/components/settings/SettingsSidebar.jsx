// The settings drawer itself: the backdrop, the close button, the two controls
// that sit ABOVE the collapsible groups (language, "Mode Dictee Medical"), and
// the footer buttons below them (dictation device, clear history, reset, about,
// version).
//
// The six collapsible groups arrive as `children` rather than as props. They are
// already components of their own (settings/*Section.jsx) and between them they
// take about 150 props; threading those through the shell would rebuild the
// monolith one level down and make this file change every time a single group
// gains a checkbox. The shell owns the chrome; App owns what goes in it.
//
// `onMedMode` is one callback for the same reason EngineSection takes
// `onAutoconfigure`: the click reruns the performance probe and can arm a model
// reload, and those rules belong next to the rest of the load machinery in App,
// not in a presentation component.
//
// Written with the help of Claude Code.
import { LanguageSwitcher } from '../../i18n.jsx';
import Banner from '../Banner.jsx';

/**
 * @param {object} props
 * @param {Function} props.t i18n lookup.
 * @param {Function} props.onClose Close the drawer (backdrop, × button).
 * @param {Function} props.onMedMode Apply the medical-dictation preset.
 * @param {boolean} props.medModeDisabled Locked while a model swap is unsafe or a probe runs.
 * @param {boolean} props.dictationEnabled Whether the SpeechMike feature is on.
 * @param {boolean} props.dictationSuspectedNoWebhid Show the no-WebHID warning above the button.
 * @param {string|null} props.dictationDevice Connected device name, if any.
 * @param {Function} props.onConnectDictationDevice WebHID picker (or the alert on Firefox/Safari).
 * @param {Function} props.onClearTranscriptions Drop the transcription history.
 * @param {boolean} props.clearDisabled True when there is no history to clear.
 * @param {Function} props.onResetAllData Wipe every setting and cached model.
 * @param {Function} props.onAbout Close the drawer and open the About modal.
 * @param {string} props.version App version, shown at the foot of the drawer.
 * @param {import('react').ReactNode} props.children The collapsible setting groups.
 */
export default function SettingsSidebar({
  t,
  onClose,
  onMedMode,
  medModeDisabled,
  dictationEnabled,
  dictationSuspectedNoWebhid,
  dictationDevice,
  onConnectDictationDevice,
  onClearTranscriptions,
  clearDisabled,
  onResetAllData,
  onAbout,
  version,
  children,
}) {
  return (
    <>
      {/* Backdrop overlay — click to close the sidebar */}
      <div className="settings-sidebar-overlay" onClick={onClose} />
      <div className="settings-sidebar">
        <button className="settings-sidebar-close" onClick={onClose} aria-label={t('closeSettings')}>×</button>
        <div className="settings-section">
          <div className="setting-row setting-row--language">
            <span className="setting-label">{t('language')}</span>
            <LanguageSwitcher />
          </div>

          {/* "Mode Dictee Medical": the same preset `?mode=med` applies, one click
              away. It sits ABOVE the collapsible groups rather than inside one
              because it is not a setting, it is a shortcut that rewrites a dozen
              of them across four different groups (model, precision, chunking,
              display, boosting, language), and burying it in any single group
              would misrepresent its reach. Locked while a model swap is unsafe,
              like every other model-defining control. */}
          <div className="setting-row setting-row--med-mode">
            <button
              type="button"
              className="primary med-mode-button"
              onClick={onMedMode}
              disabled={medModeDisabled}
              title={t('tooltipMedMode')}
              data-umami-event="med_mode_button"
            >
              {t('medMode')}
            </button>
            <p className="setting-hint">{t('medModeHint')}</p>
          </div>

          <div className="settings-content">
            {children}
          </div>

          {/* Dictation device (SpeechMike) connect button. The button itself
              is always shown when the feature is enabled: on Chromium it opens
              the WebHID picker; on Firefox/Safari clicking it shows an alert
              explaining the limitation (see connectDictationDevice). When we
              suspect a dictation device is plugged in on a non-WebHID browser
              we additionally render a Banner above it. */}
          {dictationEnabled && (
            <div className="setting-row" style={{ marginTop: '1rem' }}>
              {dictationSuspectedNoWebhid && (
                <Banner tone="warning" style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  {t('dictationSuspectedNoWebhid')}
                </Banner>
              )}
              <button
                onClick={onConnectDictationDevice}
                style={{ width: '100%' }}
                className="primary"
              >
                {dictationDevice
                  ? `${t('connectedDevice')}: ${dictationDevice}`
                  : t('connectDictationDevice')}
              </button>
              {dictationDevice && (
                <p style={{ fontSize: '0.8rem', color: '#16a34a', margin: '0.25rem 0 0' }}>
                  {t('dictationDeviceHint')}
                </p>
              )}
            </div>
          )}

          <button
            onClick={onClearTranscriptions}
            disabled={clearDisabled}
            style={{ marginTop: '1rem', width: '100%' }}
            className="primary"
          >
            {t('clearTranscriptionHistory')}
          </button>

          <button
            onClick={onResetAllData}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              background: '#dc2626',
              color: 'white'
            }}
            className="primary"
          >
            {t('resetAllSettingsAndData')}
          </button>

          <button
            onClick={onAbout}
            style={{ marginTop: '1rem', width: '100%' }}
            className="primary"
          >
            {t('about')}
          </button>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
            v{version}
          </p>
        </div>
      </div>
    </>
  );
}
