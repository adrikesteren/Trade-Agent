import "server-only";

/** Bar length in ms (must match @repo/exchange BitvavoAdapter / `candle-retention` TF minutes). */
const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

/**
 * Unix ms for Bitvavo REST `end`: **close time of the last fully closed bar** at `nowMs`
 * (floor to the catalog bar grid so an in-progress bar is never the fetch anchor).
 *
 * Examples (5m): 00:58 → close 00:55; 01:03 → close 01:00.
 */
export function bitvavoListCandlesEndMs(nowMs: number, timeframe: string): number {
  const intervalMs = TIMEFRAME_MS[timeframe];
  if (!intervalMs || !Number.isFinite(nowMs)) {
    throw new Error(`bitvavoListCandlesEndMs: unsupported timeframe or invalid now: ${timeframe}`);
  }
  const openOfBarContainingNow = Math.floor(nowMs / intervalMs) * intervalMs;
  const closeOfBarContainingNow = openOfBarContainingNow + intervalMs;
  if (nowMs < closeOfBarContainingNow) {
    return openOfBarContainingNow;
  }
  return closeOfBarContainingNow;
}
