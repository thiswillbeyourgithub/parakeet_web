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
