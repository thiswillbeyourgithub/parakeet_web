import CollapsibleSection from '../CollapsibleSection.jsx';
import InfoTooltip from '../InfoTooltip.jsx';
import { BOOST_SOURCE_CUSTOM, BOOST_SOURCE_DISABLED } from '../../lib/boostConfig.js';
import { formatBoostConflict, MAX_PHRASE_WEIGHT } from '../../../../src/phraseBoost.js';

// The dashed hint panel under the phrase-boost controls. Three sibling branches
// render it and they differ only in text colour, so it lives here once: the
// copy-paste is how one of them ended up reading a surface token that is
// defined in no stylesheet, which left the panel near-white on a dark card
// with --text-muted (#c4c8de in dark) on top of it at about 1.4:1. Every colour
// here is a theme token for that reason.
const BOOST_HINT_PANEL_STYLE = {
  width: '100%', boxSizing: 'border-box',
  fontSize: '0.78rem', padding: '0.6rem 0.7rem',
  borderRadius: '4px', border: '1px dashed var(--border-strong)',
  background: 'var(--bg-subtle)', color: 'var(--text-muted)',
};

// The sidebar's Phrase boosting group: which list is loaded, its strength, the
// list itself, and the two advanced knobs.
//
// The phrase area has four mutually exclusive faces, which is why the branch
// chain reads the way it does: boosting off, a curated list too long to edit in
// place, the user's own list too long to edit in place (with an explicit "edit
// anyway" escape), or the editable textarea. Only the Custom slot is the user's
// own, so edits made while a curated file is selected live for the session and
// are never saved over it. The advanced knobs are hidden with no phrases
// loaded, because the trie is inert then and the numbers would mean nothing.
export default function BoostingSection({
  t,
  open,
  onToggle,
  boostFiles,
  boostSource,
  applyBoostSource,
  boostStrength,
  setBoostStrength,
  boostCollapsed,
  boostCustomOversize,
  boostEditorOpen,
  setBoostEditorOpen,
  boostLineCount,
  boostPhrases,
  setBoostPhrases,
  setBoostCustomText,
  boostPhraseCount,
  boostWarnings,
  boostConflicts,
  boostUnkWarnings,
  boostMinp,
  setBoostMinp,
  boostDepthScaling,
  setBoostDepthScaling,
}) {
  return (
    <CollapsibleSection id="boosting" title={t('settingsGroupBoosting')} open={open} onToggle={onToggle}>
      <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
        <span className="setting-label">
          {t('boostPhrases')}:
          <InfoTooltip text={t('tooltipBoost')} />
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          {boostFiles.length > 0 && (
            <select
              value={boostSource}
              onChange={e => applyBoostSource(e.target.value)}
              style={{ flex: '1 1 auto', minWidth: 0, padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
            >
              <option value={BOOST_SOURCE_DISABLED}>{t('boostSourceDisabled')}</option>
              <option value={BOOST_SOURCE_CUSTOM}>{t('boostSourceCustom')}</option>
              {boostFiles.map(f => (
                <option key={f} value={f}>{f.replace(/\.txt$/, '')}</option>
              ))}
            </select>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', marginLeft: boostFiles.length > 0 ? 0 : 'auto' }}>
            {t('boostStrength')}:
            <InfoTooltip text={t('tooltipBoostStrength')} />
            <input
              type="number"
              inputMode="decimal"
              min="-10"
              max="10"
              step="0.5"
              value={boostStrength}
              onChange={e => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setBoostStrength(Math.max(-10, Math.min(10, v)));
              }}
              style={{ width: '3.5rem' }}
            />
          </label>
        </div>
        {boostSource === BOOST_SOURCE_DISABLED ? (
          <div style={BOOST_HINT_PANEL_STYLE}>
            {t('boostDisabledHint')}
          </div>
        ) : boostCollapsed ? (
          <div style={{ ...BOOST_HINT_PANEL_STYLE, color: 'var(--warning-soft-text)' }}>
            <div style={{ fontWeight: 600 }}>
              {t('boostCuratedLoaded').replace('{name}', boostSource.replace(/\.txt$/, ''))}
            </div>
            <div>{t('boostCuratedEditHint')}</div>
          </div>
        ) : (boostCustomOversize && !boostEditorOpen) ? (
          <div style={BOOST_HINT_PANEL_STYLE}>
            <div style={{ fontWeight: 600, color: 'var(--warning-soft-text)' }}>
              {t('boostCustomLarge').replace('{n}', boostLineCount)}
            </div>
            <div>{t('boostCustomLargeHint')}</div>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setBoostEditorOpen(true)}>
                {t('boostCustomEdit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(t('boostCustomClearConfirm'))) return;
                  setBoostPhrases('');
                  setBoostCustomText('');
                  setBoostEditorOpen(false);
                }}
              >
                {t('boostCustomClear')}
              </button>
            </div>
          </div>
        ) : (
          <textarea
            value={boostPhrases}
            onChange={e => {
              const v = e.target.value;
              setBoostPhrases(v);
              // Only the Custom slot is the user's own; edits while a file
              // is selected stay in this session and aren't saved as custom.
              if (boostSource === BOOST_SOURCE_CUSTOM) setBoostCustomText(v);
            }}
            placeholder={t('boostPhrasesPlaceholder')}
            rows={4}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.4rem',
              borderRadius: '4px', border: '1px solid var(--border-strong)',
              background: 'var(--bg-card)', color: 'var(--text)',
            }}
          />
        )}
        {boostWarnings.length > 0 && (
          <p style={{
            fontSize: '0.78rem', color: 'var(--warning-soft-text)', margin: 0,
            overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}>
            {t('boostWeightWarning').replace('{max}', MAX_PHRASE_WEIGHT)}{' '}
            {boostWarnings.map(w => w.phrase).join(', ')}
          </p>
        )}
        {boostConflicts.length > 0 && (
          <p style={{
            fontSize: '0.78rem', color: 'var(--warning-soft-text)', margin: 0,
            overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}>
            {t('boostConflictWarning')}{' '}
            {boostConflicts.map(formatBoostConflict).join('; ')}
          </p>
        )}
        {boostPhrases.trim() && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
            {t('boostPhrasesLoaded').replace('{n}', boostPhraseCount)}
          </p>
        )}
        {boostUnkWarnings.length > 0 && (
          <details style={{ fontSize: '0.78rem', color: 'var(--warning-soft-text)' }}>
            <summary style={{ cursor: 'pointer' }}>
              {t('boostUnkSummary').replace('{n}', boostUnkWarnings.length)}
            </summary>
            <p style={{ margin: '0.4rem 0' }}>{t('boostUnkWarning')}</p>
            <textarea
              readOnly
              value={boostUnkWarnings.join('\n')}
              rows={Math.min(8, boostUnkWarnings.length)}
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.4rem',
                borderRadius: '4px', border: '1px solid var(--border-strong)',
                background: 'var(--bg-card)', color: 'var(--text)',
              }}
            />
          </details>
        )}
      </div>

      {/* Advanced boost knobs (the CLI's --boost-minp / --depth-scaling),
          presented like the MAES rows above. Only meaningful when a
          phrase list is loaded (with no phrases the trie is inert), so
          hide them otherwise, mirroring the beamWidth>1 gate on MAES. */}
      {boostPhrases.trim() && (
        <>
          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('boostMinp')}:
              <InfoTooltip text={t('tooltipBoostMinp')} />
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="1"
              step="0.01"
              placeholder={t('boostMinpOff')}
              value={boostMinp ?? ''}
              onChange={e=>{
                const raw = e.target.value;
                // Blank field = off (each phrase keeps its own gate); a
                // number in [0,1] = the global gate (0 = boost all, 1 = off).
                if (raw === '') { setBoostMinp(null); return; }
                const v = Number(raw);
                if (Number.isFinite(v)) setBoostMinp(Math.max(0, Math.min(1, v)));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>

          <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <span className="setting-label" style={{ flex: '1 1 auto' }}>
              {t('boostDepthScaling')}:
              <InfoTooltip text={t('tooltipBoostDepthScaling')} />
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="5"
              step="0.1"
              value={boostDepthScaling}
              onChange={e=>{
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setBoostDepthScaling(Math.max(0, Math.min(5, v)));
              }}
              style={{ width: '4.5rem' }}
            />
          </div>
        </>
      )}

    </CollapsibleSection>
  );
}
