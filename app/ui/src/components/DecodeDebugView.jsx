import { useState, useMemo } from 'react';
import { tokenRewrites } from '../lib/decodeDebugRewrites.js';

// Per-entry decode-debug view (the "Debug" base mode next to Raw/Speakers):
// renders every decoded token as a clickable pill; clicking one opens an
// inline card with the decoder's evidence for that emission (true logit,
// log-prob, phrase-boost bonus, TDT duration, confidence) plus the top-k
// alternatives it beat, and, for beam runs, the surviving beam at that frame
// from the MAES timeline. Data comes from transcribe()'s opt-in
// `collectDecodeDebug` payload (in-memory only, never persisted).
// When the drug/term layer is on for the entry (`drugRules`), the tokens a
// rule rewrote are grouped under a label showing what they became, so a
// misheard word and its fix read together.
// Built with Claude Code.

// Values arrive pre-rounded by the decoder; `null` means "not recorded".
const fmt = (v, digits = 2) =>
    (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(digits) : '·';

function confClass(conf) {
    if (typeof conf !== 'number') return '';
    if (conf >= 0.8) return ' debug-pill--conf-high';
    if (conf >= 0.5) return ' debug-pill--conf-mid';
    return ' debug-pill--conf-low';
}

// SentencePiece pieces mark a word start with '▁'; strip it for display (the
// pill gets a word gap via CSS) and keep a visible glyph for a bare '▁'.
const pieceLabel = (piece) => {
    const stripped = String(piece ?? '').replace(/▁/g, '');
    return stripped === '' ? '␣' : stripped;
};

function TokenCard({ chunk, tok, rewrite, layerName, t }) {
    const metrics = [
        [t('dbgToken'), `${pieceLabel(tok.piece)} (#${tok.id})`],
        [t('dbgTime'), tok.start == null ? '·' : `${fmt(chunk.startSec + tok.start, 2)} s`],
        [t('dbgFrame'), tok.frame ?? '·'],
        [t('dbgDurationFrames'), tok.duration ?? '·'],
        [t('dbgConfidence'), fmt(tok.conf, 3)],
        [t('dbgLogit'), fmt(tok.logit, 3)],
        [t('dbgLogProb'), fmt(tok.logp, 3)],
        [t('dbgBoostBonus'), fmt(tok.boostBonus, 3)],
    ];
    // The joint token+duration rank score only exists on beam runs.
    if (tok.score != null) metrics.push([t('dbgJointScore'), fmt(tok.score, 3)]);

    // Beam runs: the kept beam right after this token's frame was worked.
    const beamFrame = (chunk.beamTimeline && tok.frame != null)
        ? chunk.beamTimeline.find(f => f.frame === tok.frame)
        : null;

    return (
        <div className="decode-debug__card">
            {rewrite && (
                <div className="decode-debug__rewrite-note">
                    {t('dbgRewrittenBy')} <strong>{layerName}</strong>: «{rewrite.from}» → «{rewrite.to}»
                    {' '}({t('dbgRules')} {rewrite.rules.map(r => `#${r}`).join(', ')})
                </div>
            )}
            <div className="decode-debug__metrics">
                {metrics.map(([label, value]) => (
                    <div key={label} className="decode-debug__metric">
                        <span className="decode-debug__metric-label">{label}</span>
                        <span className="decode-debug__metric-value">{value}</span>
                    </div>
                ))}
            </div>

            <div className="decode-debug__subtitle">{t('dbgAlternatives')}</div>
            <div className="decode-debug__table-wrap">
                <table className="decode-debug__table">
                    <thead>
                        <tr>
                            <th>{t('dbgToken')}</th>
                            <th>id</th>
                            <th>{t('dbgLogit')}</th>
                            <th>{t('dbgLogProb')}</th>
                            <th>{t('dbgBoostBonus')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tok.alternatives.map((a, i) => (
                            <tr key={i} className={a.id === tok.id ? 'decode-debug__row--chosen' : ''}>
                                <td>{pieceLabel(a.piece)}{a.id === tok.id ? ` ${t('dbgChosen')}` : ''}</td>
                                <td>{a.id}</td>
                                <td>{fmt(a.logit, 3)}</td>
                                <td>{fmt(a.logp, 3)}</td>
                                <td>{a.boostBonus ? fmt(a.boostBonus, 3) : '·'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {beamFrame && (
                <>
                    <div className="decode-debug__subtitle">
                        {t('dbgBeamAtFrame')} {beamFrame.frame} ({fmt(chunk.startSec + beamFrame.time, 2)} s)
                        {beamFrame.merged > 0 && ` · ${beamFrame.merged} ${t('dbgMerged')}`}
                    </div>
                    <div className="decode-debug__table-wrap">
                        <table className="decode-debug__table">
                            <thead>
                                <tr>
                                    <th>{t('dbgScore')}</th>
                                    <th>{t('dbgNormScore')}</th>
                                    <th>{t('dbgEmitted')}</th>
                                    <th>{t('dbgTail')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {beamFrame.hyps.map((h, i) => (
                                    <tr key={i}>
                                        <td>{fmt(h.score, 3)}</td>
                                        <td>{fmt(h.normScore, 3)}</td>
                                        <td>{h.numEmitted}</td>
                                        <td className="decode-debug__tail">
                                            …{h.tailPieces.map(p => String(p ?? '').replace(/▁/g, ' ')).join('')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

export default function DecodeDebugView({ debug, drugRules = null, layerName = '', t }) {
    // One selected pill across all chunks: "chunkIdx:tokenIdx".
    const [selected, setSelected] = useState(null);

    const chunks = debug?.chunks || [];
    // Per chunk: the rewrites, and which one (if any) each token belongs to.
    const rewritesByChunk = useMemo(() => chunks.map((c) => {
        const rewrites = tokenRewrites(c.tokens, drugRules);
        const ofToken = new Map();
        for (const rw of rewrites) for (let i = rw.first; i <= rw.last; i++) ofToken.set(i, rw);
        return { rewrites, ofToken };
    }), [chunks, drugRules]);
    if (chunks.length === 0) return null;
    const rewriteCount = rewritesByChunk.reduce((n, c) => n + c.rewrites.length, 0);

    const allTokens = chunks.flatMap(c => c.tokens || []);
    const boosted = allTokens.filter(tk => (tk.boostBonus || 0) > 0);
    const boostSum = boosted.reduce((s, tk) => s + tk.boostBonus, 0);
    const { strategy, beamWidth } = chunks[0];

    return (
        <div className="decode-debug">
            <div className="decode-debug__summary">
                {t('dbgDecoder')}: <strong>{strategy === 'beam' ? `${t('dbgBeam')} (${beamWidth})` : t('dbgGreedy')}</strong>
                {' · '}{allTokens.length} {t('dbgTokens')}
                {boosted.length > 0 && <> {' · '}{boosted.length} {t('dbgBoostedTokens')} (Σ +{fmt(boostSum, 1)})</>}
                {rewriteCount > 0 && <> {' · '}{rewriteCount} {t('dbgRewrites')} <strong>{layerName}</strong></>}
            </div>

            {chunks.map((chunk, ci) => {
                const selTok = selected != null && Number(selected.split(':')[0]) === ci
                    ? chunk.tokens[Number(selected.split(':')[1])]
                    : null;
                return (
                    <div key={ci}>
                        {chunks.length > 1 && (
                            <div className="decode-debug__chunk-header">
                                {t('dbgChunk')} {chunk.chunkNum}/{chunks.length} · {fmt(chunk.startSec, 1)}–{fmt(chunk.endSec, 1)} s
                            </div>
                        )}
                        <div className="decode-debug__pills">
                            {(() => {
                                const { ofToken } = rewritesByChunk[ci];
                                const pill = (tok, ti) => {
                                    const key = `${ci}:${ti}`;
                                    const wordStart = String(tok.piece ?? '').startsWith('▁');
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            className={
                                                'debug-pill'
                                                + confClass(tok.conf)
                                                + (wordStart ? ' debug-pill--wordstart' : '')
                                                + ((tok.boostBonus || 0) > 0 ? ' debug-pill--boosted' : '')
                                                + (ofToken.has(ti) ? ' debug-pill--rewritten' : '')
                                                + (selected === key ? ' active' : '')
                                            }
                                            aria-pressed={selected === key}
                                            onClick={() => setSelected(selected === key ? null : key)}
                                        >
                                            {pieceLabel(tok.piece)}
                                        </button>
                                    );
                                };
                                const tokens = chunk.tokens || [];
                                const out = [];
                                for (let ti = 0; ti < tokens.length; ti++) {
                                    const rw = ofToken.get(ti);
                                    if (!rw) { out.push(pill(tokens[ti], ti)); continue; }
                                    // The rewritten run: its pills under a label with the fix.
                                    const startsWord = String(tokens[rw.first].piece ?? '').startsWith('▁');
                                    out.push(
                                        <span
                                            key={`rw-${ci}:${rw.first}`}
                                            className={'debug-rewrite' + (startsWord && rw.first > 0 ? ' debug-rewrite--wordstart' : '')}
                                            title={`${layerName}: «${rw.from}» → «${rw.to}»`}
                                        >
                                            <span className="debug-rewrite__label">→ {rw.to}</span>
                                            <span className="debug-rewrite__pills">
                                                {tokens.slice(rw.first, rw.last + 1).map((tok, k) => pill(tok, rw.first + k))}
                                            </span>
                                        </span>,
                                    );
                                    ti = rw.last;
                                }
                                return out;
                            })()}
                        </div>
                        {selTok && (
                            <TokenCard
                                chunk={chunk}
                                tok={selTok}
                                rewrite={rewritesByChunk[ci].ofToken.get(Number(selected.split(':')[1])) || null}
                                layerName={layerName}
                                t={t}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
