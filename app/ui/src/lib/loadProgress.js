// Turn one hub progress event into what the load UI should show.
//
// The hub reports two unrelated kinds of event through the same callback:
// ATTEMPT events, which fire before any bytes flow so a stalled connection
// still shows "Retry 2/3", and BYTE events, which carry loaded/total for one
// file. They produce different text, touch the progress bar differently, and
// only one of them is proof that anything was downloaded.
//
// This was an inline closure over four refs and five formatters, so the line
// the visitor actually reads during a multi-minute 2.4 GB download had no test
// at all: the individual formatters were covered, their assembly was not, and
// neither were the two rules that are easy to get subtly wrong (what counts as
// a network byte on a RESUMED download, and when the app may claim to be
// downloading). It is pure here, and the caller keeps the refs.

import { formatBytes, formatRate, formatEta, updateDownloadRate } from './format.js';

/**
 * @param {object} event one hub progress event
 * @param {number} [event.loaded]     bytes of the FILE in hand (includes a resumed prefix)
 * @param {number} [event.total]      the file's full size, 0/absent when unknown
 * @param {string} event.file         the file the event is about
 * @param {boolean} [event.resumed]   this download continued a cached prefix
 * @param {number} [event.resumedFrom] how many bytes that prefix held
 * @param {number} [event.attempt]    present ONLY on attempt events
 * @param {number} [event.maxAttempts]
 * @param {object} ctx
 * @param {(key: string) => string} ctx.t   the i18n lookup
 * @param {number} ctx.now                  a monotonic timestamp, supplied so this stays pure
 * @param {object|null} ctx.rateState       the trailing-window rate state to carry forward
 * @param {number} [ctx.previousTransferred] network bytes already credited to this file
 * @returns {{progressText: string|null, progressPct: number|null, downloading: boolean,
 *            fileTransferredBytes: number|null, rateState: object|null}}
 *   `null` on progressText / progressPct / rateState / fileTransferredBytes means
 *   "leave what is there alone"; the caller must not write those.
 */
export function planLoadProgress(
  { loaded, total, file, resumed, resumedFrom, attempt, maxAttempts } = {},
  { t, now, rateState = null, previousTransferred = 0 } = {},
) {
  const plan = {
    progressText: null,
    progressPct: null,
    downloading: false,
    fileTransferredBytes: null,
    rateState: null,
  };

  // Attempt event. Silent on a single-attempt download: announcing "Retry 1/1"
  // would make an ordinary first try look like a recovery.
  if (attempt !== undefined) {
    if (maxAttempts > 1) {
      plan.progressText = t('retryingDownload')
        .replace('{n}', attempt)
        .replace('{total}', maxAttempts)
        .replace('{file}', file);
      // Only the FIRST attempt rewinds the bar. A later retry leaves it where
      // it was, because a resumed download picks up from that prefix and
      // dropping to 0% would read as losing the bytes already on disk.
      if (attempt === 1) plan.progressPct = 0;
    }
    return plan;
  }

  // Byte event. `loaded` is how much of the FILE is in hand, which on a resumed
  // download starts at whatever was already cached, so the resumed part comes
  // back off: this number is what the CONNECTION was asked for, and it feeds
  // the "downloaded N MB" accounting. The progress BAR wants the whole file, so
  // it reads `loaded` directly. Monotonic per file, so a retry that restarts a
  // stream cannot make the total shrink.
  const transferred = Math.max(0, (loaded || 0) - (resumedFrom || 0));
  plan.fileTransferredBytes = Math.max(previousTransferred || 0, transferred);

  // A byte event is also the only honest moment to say "downloading". The phase
  // cannot be announced up front: a load answered entirely from IndexedDB
  // streams nothing and would then claim a download it never made.
  plan.downloading = true;

  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const prefix = resumed ? `${t('resuming')} ` : '';
  const sizes = total > 0 ? ` ${formatBytes(loaded)} / ${formatBytes(total)}` : '';
  // Transfer rate averaged over the trailing 10 s window + MM:SS ETA.
  const { state, rate, eta } = updateDownloadRate(rateState, { file, loaded, total, now });
  plan.rateState = state;
  const etaStr = formatEta(eta);
  const stats = [formatRate(rate), etaStr ? `${etaStr} ${t('etaRemaining')}` : ''].filter(Boolean).join(', ');
  plan.progressText = `${prefix}${file}:${sizes} (${pct}%)${stats ? ` (${stats})` : ''}`;
  plan.progressPct = pct;
  return plan;
}
