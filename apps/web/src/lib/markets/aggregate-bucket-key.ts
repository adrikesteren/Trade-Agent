import type { ChartTimeframe } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { candleTimeToUnixSeconds } from "@/lib/agents/ingest/services/candle-time.service";

export const TIMEFRAME_MINUTES: Record<ChartTimeframe, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

const SOURCE_TIMEFRAME = CATALOG_STORAGE_TIMEFRAME as ChartTimeframe;

/**
 * Floor an epoch ms to the start of its `target` timeframe bucket. Buckets are epoch-aligned
 * (e.g. 1h = floor to multiples of 3_600_000 ms), matching `aggregateOhlcvToTarget`.
 */
export function bucketStartMs(epochMs: number, target: ChartTimeframe): number {
  const periodMs = TIMEFRAME_MINUTES[target] * 60_000;
  return Math.floor(epochMs / periodMs) * periodMs;
}

/**
 * Map a 15m source bar's `open_time` (ISO) to the **openTime ISO of its aggregated bucket**
 * for `target`. Returns `null` on unparseable input. When `target === "15m"`, returns the
 * normalized ISO of the input.
 *
 * Stays aligned with `aggregateOhlcvToTarget` so chart markers land on the same bar as the
 * aggregated candle.
 */
export function bucketOpenTimeIso(sourceOpenTimeIso: string, target: ChartTimeframe): string | null {
  const sec = candleTimeToUnixSeconds(sourceOpenTimeIso);
  if (!Number.isFinite(sec)) return null;
  const ms = sec * 1000;
  if (target === SOURCE_TIMEFRAME) {
    return new Date(ms).toISOString();
  }
  return new Date(bucketStartMs(ms, target)).toISOString();
}
