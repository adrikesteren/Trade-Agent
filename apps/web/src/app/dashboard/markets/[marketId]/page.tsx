import { MarketCandleChart } from "@/components/market-candle-chart";
import { getChartDisplayTimeZone } from "@/lib/markets/chart-display-timezone";
import { aggregateOhlcvToTarget } from "@/lib/markets/aggregate-ohlcv";
import type { CandleRowJson } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ marketId: string }> };

const CHART_DEFAULT_TF = "5m" as const;

function mapCandleRow(r: {
  open_time: string;
  close_time: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}): CandleRowJson {
  return {
    openTime: r.open_time,
    closeTime: r.close_time,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

export default async function MarketDetailPage({ params }: PageProps) {
  const { marketId } = await params;
  const supabase = await createClient();

  const { data: market, error } = await supabase
    .schema("catalog")
    .from("markets")
    .select(
      `
      id,
      market_symbol,
      quote_code,
      status,
      metadata,
      created_at,
      exchange_id,
      asset_id,
      assets ( id, code, kind, name ),
      exchanges ( id, code, name )
    `,
    )
    .eq("id", marketId)
    .maybeSingle();

  if (error || !market) {
    notFound();
  }

  const rawA = market.assets as unknown;
  const rawE = market.exchanges as unknown;
  const asset = (Array.isArray(rawA) ? rawA[0] : rawA) as {
    id?: string;
    code?: string;
    kind?: string;
    name?: string;
  } | null;
  const ex = (Array.isArray(rawE) ? rawE[0] : rawE) as {
    id?: string;
    code?: string;
    name?: string;
  } | null;

  const { data: candleRows } = await supabase
    .schema("catalog")
    .from("candles")
    .select("open_time, close_time, open, high, low, close, volume")
    .eq("market_id", marketId)
    .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
    .order("close_time", { ascending: true })
    .limit(1500);

  const baseCandles = (candleRows ?? []).map(mapCandleRow);
  const initialCandles = aggregateOhlcvToTarget(baseCandles, CHART_DEFAULT_TF);
  const chartDisplayTz = getChartDisplayTimeZone();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1">
      <nav className="text-xs text-zinc-500">
        <Link href="/dashboard/markets" className="underline-offset-2 hover:underline">
          Markets
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-700 dark:text-zinc-300">Pair</span>
      </nav>

      <div>
        <h1 className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {market.market_symbol}
        </h1>
        <p className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          {ex?.id ? (
            <span>
              Exchange:{" "}
              <Link
                href={`/dashboard/exchanges/${ex.id}`}
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
              >
                {ex.name ?? ex.code}
              </Link>
            </span>
          ) : null}
          {asset?.id ? (
            <span>
              Base asset:{" "}
              <Link
                href={`/dashboard/assets/${asset.id}`}
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
              >
                {asset.code} ({asset.kind})
              </Link>
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Quote: {market.quote_code ?? "—"} · Status: {market.status} · id: {market.id}
        </p>
      </div>

      <MarketCandleChart
        marketId={marketId}
        initialTimeframe={CHART_DEFAULT_TF}
        initialCandles={initialCandles}
      />
      <p className="text-xs text-zinc-500">
        Timeframe buttons load aggregated OHLCV for this market. Axis, crosshair, and hover labels use{" "}
        <strong className="font-mono text-zinc-600 dark:text-zinc-400">{chartDisplayTz}</strong> (
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE</code>
        , default Europe/Amsterdam). Bars stay the same UTC instants as Supabase{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">open_time</code> /{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">close_time</code>. If the chart is empty, refresh
        listings from{" "}
        <Link href="/dashboard/markets" className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
          Markets
        </Link>
        . Gaps usually mean no row for that 5m slot; in the SQL editor, compare consecutive{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">close_time</code> values (difference{">"} 6 minutes)
        to find missing bars.
      </p>
    </div>
  );
}
