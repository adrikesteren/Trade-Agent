import { isChartTimeframe, type ChartTimeframe } from "@/lib/markets/chart-types";
import { fetchMarketChartSignalsAndRegime } from "@/lib/markets/fetch-market-chart-signals";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Signal markers (`intent != HOLD`) **plus regime classifier switches** for a market,
 * bucketed to a chart timeframe. Used by `MarketCandleChart` on TF change. Uses the same
 * RLS-aware Supabase client as the SSR page, so per-user visibility matches the Signals
 * related list.
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

  try {
    const { signals, regimeChanges, regimeInsufficient } = await fetchMarketChartSignalsAndRegime(
      supabase,
      { marketId, timeframe: requested },
    );
    return NextResponse.json({
      timeframe: requested,
      signals,
      regimeChanges,
      regimeInsufficient,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
