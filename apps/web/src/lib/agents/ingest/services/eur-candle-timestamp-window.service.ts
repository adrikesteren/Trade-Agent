import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as CandleTimestampsSelector from "@/lib/selectors/candle-timestamps-selector";

/** Same bar lengths as BitvavoAdapter / retention. */
export function timeframeDurationMs(timeframe: string): number {
  const unit = timeframe.slice(-1);
  const n = Number(timeframe.slice(0, -1));
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  switch (unit) {
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return 60_000;
  }
}

export type EurCandleTimestampPrepare =
  | { mode: "full" }
  | { mode: "incremental"; candleTimestampId: string; openTime: string; closeTime: string }
  | { mode: "blocked_future_close"; reason: "Close Time Is In The Future" };

/**
 * Decides full catalog backfill vs one incremental bar, or blocks when the next bar has not closed yet.
 */
export async function prepareEurCandleTimestampWindow(
  admin: SupabaseClient,
  timeframe: string,
): Promise<EurCandleTimestampPrepare> {
  let count: number;
  try {
    count = await CandleTimestampsSelector.countAll(admin);
  } catch (e) {
    throw new Error(`candle_timestamps: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (count === 0) {
    return { mode: "full" };
  }

  let lastCloseIso: string | null;
  try {
    lastCloseIso = await CandleTimestampsSelector.selectLatestCloseTime(admin);
  } catch (e) {
    throw new Error(`candle_timestamps: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!lastCloseIso) {
    return { mode: "full" };
  }

  const lastCloseMs = Date.parse(lastCloseIso);
  if (!Number.isFinite(lastCloseMs)) {
    throw new Error("candle_timestamps: invalid close_time on latest row");
  }

  const step = timeframeDurationMs(timeframe);
  const nextOpenMs = lastCloseMs;
  const nextCloseMs = lastCloseMs + step;
  const nextCloseIso = new Date(nextCloseMs).toISOString();
  const nextOpenIso = new Date(nextOpenMs).toISOString();

  if (nextCloseMs > Date.now()) {
    return { mode: "blocked_future_close", reason: "Close Time Is In The Future" };
  }

  let id: string;
  try {
    id = await CandleTimestampsSelector.upsertOneReturningId(admin, {
      open_time: nextOpenIso,
      close_time: nextCloseIso,
    });
  } catch (e) {
    throw new Error(`candle_timestamps: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    mode: "incremental",
    candleTimestampId: id,
    openTime: nextOpenIso,
    closeTime: nextCloseIso,
  };
}
