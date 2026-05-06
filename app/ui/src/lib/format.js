/**
 * Format an elapsed seconds value as `m:ss` (e.g. 65 -> "1:05").
 */
export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
