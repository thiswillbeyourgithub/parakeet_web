/**
 * Format an elapsed seconds value as `m:ss` (e.g. 65 -> "1:05").
 */
export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Format a duration in seconds as the shortest sensible `h/m/s` string.
 * Leading zero units are dropped; once a larger unit appears, smaller
 * units are integers. Below one minute we keep one decimal place since
 * sub-second granularity is useful for short ETAs.
 *
 * Examples: 0.5 -> "0.5s", 30 -> "30.0s", 90 -> "1m30s",
 *           3725 -> "1h2m5s", 3600 -> "1h0m0s".
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  return `${m}m${s}s`;
}

/**
 * Coarse "how long ago" of an ISO timestamp, as a { value, unit } pair so the
 * caller can localize the unit word. `unit` is one of 'justNow' | 'minute' |
 * 'hour' | 'day'; under a minute returns { value: 0, unit: 'justNow' }. Picks
 * the largest sensible unit (days at >= 24h, hours at >= 60min, else minutes).
 * Returns null when the input is not a parseable timestamp.
 */
export function relativeAge(fromIso, nowMs = Date.now()) {
  const then = Date.parse(fromIso);
  if (!Number.isFinite(then)) return null;
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 60) return { value: 0, unit: 'justNow' };
  const min = Math.floor(sec / 60);
  if (min < 60) return { value: min, unit: 'minute' };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { value: hr, unit: 'hour' };
  return { value: Math.floor(hr / 24), unit: 'day' };
}

/**
 * Format a byte count as a short human-readable string (KB/MB/GB, base 1024).
 * One decimal for MB/GB, integer for KB and B.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Format a transfer rate (bytes/second) as a short `<size>/s` string, reusing
 * the same units as formatBytes. Returns '' for a non-positive/unknown rate so
 * callers can omit it from the status line until a real measurement exists.
 */
export function formatRate(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Format a remaining-time estimate (seconds) as zero-padded `MM:SS`. Hours roll
 * up into the minutes field (e.g. 3725 -> "62:05"). Returns '' for an unknown
 * or non-finite ETA so the caller can drop it from the status line.
 */
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Build the multi-line tooltip (native `title`) shown when hovering a
 * transcription's timestamp: encode time, decode time, the decode/duration and
 * (encode+decode)/duration ratios, and total processing time. Pure: `labels`
 * carries the already-translated strings (encode, decode, decodePerDur,
 * encodeDecodePerDur, total) so this stays i18n-agnostic and unit-testable.
 *
 * Times come from the engine's metrics object (ms). The ratios are only emitted
 * when `durationSec > 0` (a known audio length). Returns '' when there are no
 * metrics (e.g. a reloaded entry whose in-memory timings were dropped), so the
 * caller can leave the `title` attribute off.
 */
export function formatMetricsTooltip(metrics, durationSec, labels) {
  if (!metrics) return '';
  const encS = (metrics.encode_ms ?? 0) / 1000;
  const decS = (metrics.decode_ms ?? 0) / 1000;
  const totS = (metrics.total_ms ?? 0) / 1000;
  const lines = [
    `${labels.encode}: ${encS.toFixed(2)} s`,
    `${labels.decode}: ${decS.toFixed(2)} s`,
  ];
  if (durationSec > 0) {
    lines.push(`${labels.decodePerDur}: ${(decS / durationSec).toFixed(2)}`);
    lines.push(`${labels.encodeDecodePerDur}: ${((encS + decS) / durationSec).toFixed(2)}`);
  }
  lines.push(`${labels.total}: ${totS.toFixed(2)} s`);
  return lines.join('\n');
}

/**
 * Exponential-moving-average tracker for download speed and ETA. It is pure:
 * pass the previous `state` (or `null` to start) and the latest byte-progress
 * sample, and it returns `{ state, rate, eta }` where `rate` is bytes/second
 * and `eta` is the estimated seconds left for the current file (both `null`
 * until enough data exists).
 *
 * Re-anchors whenever the `file` changes or `loaded` goes backwards (a resume
 * or retry resets the per-file counter), so a counter reset never reads as a
 * negative delta. To keep the rate stable against the very frequent progress
 * ticks, a fresh sample is only folded into the EMA once at least
 * `minIntervalMs` has elapsed since the last anchor; in between we keep the
 * last smoothed rate and just recompute the ETA against the current position so
 * it keeps ticking down smoothly.
 */
export function updateDownloadRate(state, { file, loaded, total, now }, opts = {}) {
  const minIntervalMs = opts.minIntervalMs ?? 300;
  const alpha = opts.alpha ?? 0.3;
  const etaFor = (rate) =>
    rate > 0 && total > 0 && total > loaded ? (total - loaded) / rate : null;

  if (!state || state.file !== file || loaded < state.anchorLoaded) {
    const next = { file, anchorTime: now, anchorLoaded: loaded, rate: null };
    return { state: next, rate: null, eta: null };
  }

  const dt = now - state.anchorTime;
  if (dt < minIntervalMs) {
    return { state, rate: state.rate, eta: etaFor(state.rate) };
  }

  const dBytes = loaded - state.anchorLoaded;
  const instant = dBytes > 0 ? (dBytes / dt) * 1000 : 0;
  const rate = state.rate == null ? instant : alpha * instant + (1 - alpha) * state.rate;
  const next = { file, anchorTime: now, anchorLoaded: loaded, rate };
  return { state: next, rate, eta: etaFor(rate) };
}
