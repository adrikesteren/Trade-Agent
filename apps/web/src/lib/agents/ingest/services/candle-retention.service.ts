/**
 * Incremental-sync configuration for `catalog.candles` ingest.
 *
 * **Naming clarification:** these constants control how *far back* an incremental sync looks
 * when it runs (a fetch-window cap) — they do **not** delete or expire any rows. We keep all
 * historical candles in `catalog.candles` indefinitely (no TTL pruning anymore — see the
 * companion migration for the "removed deleteExpiredCandleTimestamps" cleanup).
 *
 * If you want a sync to backfill a specific historical date range, use the historical
 * ingest path (`historical-candles-ingest.service.ts` / "Backfill candles" action) — that's
 * unbounded and not capped by these constants.
 */

/**
 * Per-call fetch window for incremental syncs ("how many recent bars do we ask Bitvavo
 * for on each sweep?"). Bitvavo's REST API caps a single call at 1440 candles, so for
 * 15m we max out at 1440 × 15min = 21,600 minutes = 360 hours = 15 days. This default
 * leaves a comfortable buffer; bumping it past the cap is a no-op (`barsForIncrementalFetchWindow`
 * clamps to 1440).
 *
 * Was historically named `CANDLE_RETENTION_HOURS = 72` (3 days), suggesting it
 * controlled deletion. It never did — see the file-level note above.
 */
export const CANDLE_INCREMENTAL_FETCH_WINDOW_HOURS = 360;

/**
 * Seed window for the very first EUR-sweep prepare on an empty `catalog.candle_timestamps`.
 * Used only on the first run; subsequent runs incrementally extend forward from the latest
 * recorded bucket.
 */
export const CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS = 5 * 24;

/** Bitvavo allows at most 1440 candles per REST call. */
const BITVAVO_MAX_LIMIT = 1440;

/** Bar length in minutes for supported timeframes (must match @repo/exchange BitvavoAdapter). */
const TF_MINUTES: Record<string, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/**
 * Number of bars to fetch on a single incremental sync call, derived from
 * {@link CANDLE_INCREMENTAL_FETCH_WINDOW_HOURS} and clamped to Bitvavo's per-call cap.
 *
 * This is **only a fetch-window size**: bars older than the window stay in the DB; they
 * just won't be re-fetched on the next sweep.
 */
export function barsForIncrementalFetchWindow(
  timeframe: string,
  windowHours = CANDLE_INCREMENTAL_FETCH_WINDOW_HOURS,
): number {
  const m = TF_MINUTES[timeframe];
  if (!m) {
    throw new Error(`Unknown timeframe for incremental fetch window: ${timeframe}`);
  }
  const windowMinutes = windowHours * 60;
  const bars = Math.ceil(windowMinutes / m);
  return Math.min(Math.max(bars, 1), BITVAVO_MAX_LIMIT);
}
