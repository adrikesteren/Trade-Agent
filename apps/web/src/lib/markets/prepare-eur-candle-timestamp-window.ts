import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  const { count, error: cntErr } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .select("id", { count: "exact", head: true });

  if (cntErr) throw new Error(`candle_timestamps: ${cntErr.message}`);
  if ((count ?? 0) === 0) {
    return { mode: "full" };
  }

  const { data: lastRow, error: lastErr } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .select("close_time")
    .order("close_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) throw new Error(`candle_timestamps: ${lastErr.message}`);
  const lastCloseIso = lastRow?.close_time as string | undefined;
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

  const { data: upserted, error: upErr } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .upsert(
      { open_time: nextOpenIso, close_time: nextCloseIso },
      { onConflict: "open_time,close_time" },
    )
    .select("id")
    .single();

  if (upErr) throw new Error(`candle_timestamps: ${upErr.message}`);
  const id = upserted?.id as string | undefined;
  if (!id) throw new Error("candle_timestamps: upsert returned no id");

  return {
    mode: "incremental",
    candleTimestampId: id,
    openTime: nextOpenIso,
    closeTime: nextCloseIso,
  };
}
