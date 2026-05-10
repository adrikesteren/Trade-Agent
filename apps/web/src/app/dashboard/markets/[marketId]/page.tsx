import { MarketCandleChart } from "@/components/market-candle-chart";
import { RecordDetailTabs } from "@/components/record-detail-tabs";
import { formatDatetime } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { resolveChartDisplayIana, userTimezoneToIana } from "@/lib/locale/timezones";
import { aggregateOhlcvToTarget } from "@/lib/markets/aggregate-ohlcv";
import type { CandleRowJson } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { createClient } from "@/lib/supabase/server";
import {
  Breadcrumbs,
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  PageHeader,
  RecordDetailCard,
  RecordDetailGrid,
  RecordDetailSection,
} from "@repo/blocks";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ marketId: string }> };

const CHART_DEFAULT_TF = "5m" as const;

function mapCandleRow(r: {
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  candle_timestamps: unknown;
}): CandleRowJson | null {
  const rawTs = r.candle_timestamps;
  const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as
    | { open_time: string; close_time: string }
    | null
    | undefined;
  if (!ts?.open_time || !ts?.close_time) return null;
  return {
    openTime: ts.open_time,
    closeTime: ts.close_time,
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
  const prefs = await getUserLocalePreferences();
  const formatDt = (v: string | number | Date) => formatDatetime(v, prefs);
  const chartDisplayIana = resolveChartDisplayIana(userTimezoneToIana(prefs.timezone));

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
    .select("open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", marketId)
    .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
    .limit(1500);

  const baseCandles = (candleRows ?? [])
    .map(mapCandleRow)
    .filter((c): c is CandleRowJson => c != null)
    .sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));
  const initialCandles = aggregateOhlcvToTarget(baseCandles, CHART_DEFAULT_TF);

  const metadataJson =
    market.metadata && typeof market.metadata === "object"
      ? JSON.stringify(market.metadata, null, 2)
      : market.metadata == null
        ? "—"
        : String(market.metadata);

  const exchangeName = ex?.name?.trim() ? ex.name : (ex?.code ?? "—");
  const assetName = asset?.name?.trim() ? asset.name : (asset?.code ?? "—");

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg px-1"
      header={
        <PageHeader
          variant="detail"
          icon={<ListViewObjectIcon letter="M" />}
          breadcrumb={<Breadcrumbs items={[{ label: "Markets", href: "/dashboard/markets" }, { label: "Pair" }]} />}
          back={{ href: "/dashboard/markets", label: "← All markets" }}
          eyebrow="Market"
          title={market.market_symbol}
          titleClassName="font-mono"
          highlights={
            <>
              {ex?.id ? (
                <Output
                  label="Exchange"
                  record={{ pathPrefix: "/dashboard/exchanges", id: ex.id, name: exchangeName }}
                />
              ) : (
                <Output label="Exchange" type="text" value="—" />
              )}
              {asset?.id ? (
                <Output
                  label="Base asset"
                  record={{ pathPrefix: "/dashboard/assets", id: asset.id, name: assetName }}
                />
              ) : (
                <Output label="Base asset" type="text" value="—" />
              )}
            </>
          }
          subtitle={
            <>
              Quote <span className="font-mono">{market.quote_code ?? "—"}</span> · Status {market.status ?? "—"}
            </>
          }
          meta={`id: ${market.id}`}
        />
      }
      content={
        <RecordDetailTabs
          details={
            <div className="bk-stack bk-stack_gap-md">
              <RecordDetailCard>
                <RecordDetailSection title="Details">
                  <RecordDetailGrid>
                    <Output label="Record ID" type="text" value={market.id} span="full" />
                    <Output label="Symbol" type="text" value={market.market_symbol} />
                    <Output label="Quote" type="text" value={market.quote_code ?? "—"} />
                    <Output label="Status" type="text" value={market.status ?? "—"} />
                    <Output label="Created" type="datetime" value={market.created_at} formatDatetime={formatDt} />
                    {ex?.id ? (
                      <Output
                        label="Exchange"
                        record={{ pathPrefix: "/dashboard/exchanges", id: ex.id, name: exchangeName }}
                      />
                    ) : (
                      <Output label="Exchange" type="text" value="—" />
                    )}
                    {asset?.id ? (
                      <Output
                        label="Base asset"
                        record={{ pathPrefix: "/dashboard/assets", id: asset.id, name: assetName }}
                      />
                    ) : (
                      <Output label="Base asset" type="text" value="—" />
                    )}
                    <Output label="Metadata" type="codeblock" value={metadataJson} span="full" />
                  </RecordDetailGrid>
                </RecordDetailSection>
              </RecordDetailCard>

              <MarketCandleChart
                marketId={marketId}
                initialTimeframe={CHART_DEFAULT_TF}
                initialCandles={initialCandles}
                chartDisplayIana={chartDisplayIana}
                userTimezone={prefs.timezone}
                decimalFormat={prefs.decimal_format}
                dateFormat={prefs.date_format}
                timeFormat={prefs.time_format}
              />
            </div>
          }
          related={<p className="bk-text-muted text-sm">No related lists for this market record yet.</p>}
        />
      }
    />
  );
}
