import "server-only";

import { ceilBarOpenMs, floorLastClosedCloseMs } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";

export type HistoricalWindowResult =
  | { kind: "empty"; reason: string }
  | {
      kind: "ok";
      /** Start of the **replay** window — first bar's open time. Unchanged by `extraWarmupMs`. */
      startOpenMs: number;
      /** Close of the last replay bar. */
      endCloseMs: number;
      /** Bar count of the replay window only (excluding any extra warmup). */
      barCount: number;
      /**
       * Bitvavo fetch lower bound when the caller asked for extra warmup (e.g. so the
       * regime classifier's daily SMA(200) has enough history before the first replay bar).
       * Equals `startOpenMs` when `extraWarmupMs` is 0/unset.
       */
      ingestStartOpenMs: number;
      /** Bar count of `[ingestStartOpenMs, endCloseMs]` — what Bitvavo should be told to fetch. */
      ingestBarCount: number;
    };

function parseYmd(s: string): { y: number; mo: number; d: number } {
  const parts = s.trim().split("-");
  if (parts.length !== 3) throw new Error(`Invalid date "${s}" (expected YYYY-MM-DD).`);
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new Error(`Invalid date "${s}".`);
  }
  return { y, mo, d };
}

function utcStartOfDayMs(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
}

function utcEndOfDayMs(y: number, mo: number, d: number): number {
  return Date.UTC(y, mo - 1, d, 23, 59, 59, 999);
}

/**
 * Inclusive UTC calendar dates → first/last 15m (or `timeframe`) bar on the same grid as Bitvavo / `candle_timestamps`.
 */
export function computeHistoricalCandleWindow(args: {
  startDate: string;
  endDate: string;
  timeframe: string;
  /**
   * Extra Bitvavo-fetch leadtime (ms) to add **before** the replay window start. Used by
   * historical replay to pull enough bars for slow indicators (regime classifier needs ~200
   * daily ≈ 19_200 × 15m bars). Does not affect `startOpenMs` / `barCount` — those still
   * describe the replay window.
   */
  extraWarmupMs?: number;
}): HistoricalWindowResult {
  const stepMs = timeframeDurationMs(args.timeframe);
  const { y: ys, mo: ms, d: ds } = parseYmd(args.startDate);
  const { y: ye, mo: me, d: de } = parseYmd(args.endDate);
  if (args.startDate > args.endDate) {
    return { kind: "empty", reason: "start_date_after_end_date" };
  }

  const dayStartMs = utcStartOfDayMs(ys, ms, ds);
  const dayEndMs = utcEndOfDayMs(ye, me, de);

  const startOpenMs = ceilBarOpenMs(dayStartMs, stepMs);
  const endCloseMs = floorLastClosedCloseMs(dayEndMs, stepMs);

  if (!Number.isFinite(startOpenMs) || !Number.isFinite(endCloseMs)) {
    return { kind: "empty", reason: "invalid_bounds" };
  }
  if (startOpenMs + stepMs > endCloseMs) {
    return { kind: "empty", reason: "no_bars_in_range" };
  }

  const span = endCloseMs - startOpenMs;
  if (span % stepMs !== 0) {
    return { kind: "empty", reason: "range_not_aligned_to_timeframe_grid" };
  }
  const barCount = span / stepMs;
  if (!Number.isInteger(barCount) || barCount <= 0) {
    return { kind: "empty", reason: "invalid_bar_count" };
  }

  // Bitvavo fetch lower bound — replay start minus the requested warmup, snapped down to
  // the previous bar-open grid. If no warmup was requested, this is identical to startOpenMs.
  const extraWarmupMs = Math.max(0, Math.floor(args.extraWarmupMs ?? 0));
  let ingestStartOpenMs = startOpenMs;
  if (extraWarmupMs > 0) {
    const candidate = startOpenMs - extraWarmupMs;
    // Snap down to a bar-open boundary so the resulting span is a whole number of bars.
    ingestStartOpenMs = Math.floor(candidate / stepMs) * stepMs;
  }
  const ingestSpan = endCloseMs - ingestStartOpenMs;
  const ingestBarCount = ingestSpan % stepMs === 0 && ingestSpan > 0 ? ingestSpan / stepMs : barCount;

  return { kind: "ok", startOpenMs, endCloseMs, barCount, ingestStartOpenMs, ingestBarCount };
}
