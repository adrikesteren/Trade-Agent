import { aggregateOhlcvToTarget } from "@/lib/markets/aggregate-ohlcv";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  CATALOG_STORAGE_TIMEFRAME,
  isChartTimeframe,
  type ChartTimeframe,
} from "@/lib/markets/chart-types";

/**
 * OHLCV for a market + timeframe (ascending by bar time). Used by the market detail chart.
 * Data is stored at `CATALOG_STORAGE_TIMEFRAME`; other intervals are aggregated from those rows.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const marketId = url.searchParams.get("marketId");
  const timeframe = url.searchParams.get("timeframe") ?? "15m";

  if (!marketId) {
    return NextResponse.json({ error: "missing_marketId" }, { status: 400 });
  }

  if (!isChartTimeframe(timeframe)) {
    return NextResponse.json({ error: "invalid_timeframe" }, { status: 400 });
  }

  const requested = timeframe as ChartTimeframe;

  const { data: rows, error } = await supabase
    .schema("catalog")
    .from("candles")
    .select("open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", marketId)
    .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
    .limit(1500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseCandles = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as
        | { open_time: string; close_time: string }
        | null
        | undefined;
      if (!ts?.open_time || !ts?.close_time) return null;
      return {
        openTime: ts.open_time as string,
        closeTime: ts.close_time as string,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));

  const candles = aggregateOhlcvToTarget(baseCandles, requested);

  let changePct: number | null = null;
  if (candles.length >= 2) {
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    if (first.open > 0) {
      changePct = ((last.close - first.open) / first.open) * 100;
    }
  }

  return NextResponse.json({ timeframe: requested, candles, changePct });
}
