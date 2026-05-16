import type { SupabaseClient } from "@supabase/supabase-js";

import * as CandleTimestampsSelector from "@/lib/selectors/candle-timestamps-selector";

/** How far back we keep closed candles (wall clock, UTC) for bar counts / non-empty sync floors. */
export const CANDLE_RETENTION_HOURS = 72; // 3 days — lighter on DB/disk for dev

/**
 * When `catalog.candle_timestamps` is empty (or latest row has no close), the EUR sweep seeds
 * this much history on first prepare — 5d at 15m = 480 bars.
 */
export const CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS = 5 * 24;

/** Delete `catalog.candle_timestamps` rows whose bar has fully ended before this age (wall clock). */
export const CANDLE_TIMESTAMP_TTL_HOURS = 365 * 24;

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
 * Number of bars needed to cover the retention window (ceiling), capped for Bitvavo API.
 */
export function barsForRetention(timeframe: string, retentionHours = CANDLE_RETENTION_HOURS): number {
  const m = TF_MINUTES[timeframe];
  if (!m) {
    throw new Error(`Unknown timeframe for retention: ${timeframe}`);
  }
  const retentionMinutes = retentionHours * 60;
  const bars = Math.ceil(retentionMinutes / m);
  return Math.min(Math.max(bars, 1), BITVAVO_MAX_LIMIT);
}

/**
 * Deletes `catalog.candle_timestamps` whose `close_time` is older than `maxAgeHours` (UTC wall clock).
 * Related `catalog.candles` rows are removed via ON DELETE CASCADE.
 */
export async function deleteExpiredCandleTimestamps(
  supabase: SupabaseClient,
  maxAgeHours = CANDLE_TIMESTAMP_TTL_HOURS,
): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  await CandleTimestampsSelector.deleteOlderThanCloseTime(supabase, cutoff);
}
