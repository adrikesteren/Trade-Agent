import type { SupabaseClient } from "@supabase/supabase-js";

/** How far back we keep closed candles (wall clock, UTC). */
export const CANDLE_RETENTION_HOURS = 72; // 3 days — lighter on DB/disk for dev

/** Bitvavo allows at most 1440 candles per REST call. */
const BITVAVO_MAX_LIMIT = 1440;

/** Bar length in minutes for supported timeframes (must match @repo/exchange BitvavoAdapter). */
const TF_MINUTES: Record<string, number> = {
  "5m": 5,
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
 * Deletes `catalog.candle_timestamps` whose bar has fully ended before the retention cutoff.
 * Related `catalog.candles` rows are removed via ON DELETE CASCADE.
 */
export async function deleteExpiredCandleTimestamps(
  supabase: SupabaseClient,
  retentionHours = CANDLE_RETENTION_HOURS,
): Promise<void> {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .schema("catalog")
    .from("candle_timestamps")
    .delete()
    .lt("close_time", cutoff);

  if (error) {
    throw new Error(error.message);
  }
}
