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
