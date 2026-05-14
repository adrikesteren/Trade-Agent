import "server-only";

import { ceilBarOpenMs, floorLastClosedCloseMs } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";

export type HistoricalWindowResult =
  | { kind: "empty"; reason: string }
  | { kind: "ok"; startOpenMs: number; endCloseMs: number; barCount: number };

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

  return { kind: "ok", startOpenMs, endCloseMs, barCount };
}
