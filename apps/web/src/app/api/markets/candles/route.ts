import { aggregateOhlcvToTarget } from "@/lib/markets/aggregate-ohlcv";
import {
  CATALOG_STORAGE_TIMEFRAME,
  isChartTimeframe,
  type ChartTimeframe,
} from "@/lib/markets/chart-types";
import { fetchAllMarketStorageCandles, mapCatalogCandleRowToJson } from "@/lib/markets/fetch-market-chart-candles";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

  let rows: Awaited<ReturnType<typeof fetchAllMarketStorageCandles>>["rows"] = [];
  try {
    rows = (
      await fetchAllMarketStorageCandles(supabase, {
        marketId,
        storageTimeframe: CATALOG_STORAGE_TIMEFRAME,
      })
    ).rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const baseCandles = rows
    .map(mapCatalogCandleRowToJson)
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
