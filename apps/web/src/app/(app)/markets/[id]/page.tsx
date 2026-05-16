import { MarketBackfillCandlesDialog } from "@/app/(app)/markets/[id]/market-backfill-candles-dialog";
import { MarketBackfillSignalsButton } from "@/app/(app)/markets/[id]/market-backfill-signals-button";
import { MarketCandleChart } from "@/components/market-candle-chart";
import { RecordPageTabs } from "@/components/record-page-tabs";
import { RecordTasksRelatedCard } from "@/components/record-tasks-related-card";
import { formatDatetime, formatDecimal } from "@/lib/locale/format";
import { getUserLocalePreferences } from "@/lib/locale/get-user-locale-preferences";
import { resolveChartDisplayIana, userTimezoneToIana } from "@/lib/locale/timezones";
import { aggregateOhlcvToTarget } from "@/lib/markets/aggregate-ohlcv";
import type { CandleRowJson } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { fetchAllMarketStorageCandles, mapCatalogCandleRowToJson } from "@/lib/markets/fetch-market-chart-candles";
import { objectRegistry } from "@/lib/objects/registry";
import { createClient } from "@/lib/supabase/server";
import {
  DetailPageLayout,
  ListViewObjectIcon,
  Output,
  RecordPageCard,
  RecordPageGrid,
  RecordPageSection,
  RecordRelatedList,
} from "@adrikesteren/adricore/blocks";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = { params: Promise<{ id: string }> };

const CHART_DEFAULT_TF = "15m" as const;

type MarketRelatedSignal = {
  id: string;
  signal_agent_id: string;
  close_time: string;
  intent: string;
  timeframe: string;
  confidence: number | string | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

type MarketRelatedSignalRaw = {
  id: string;
  signal_agent_id: string;
  intent: string;
  confidence: number | string | null;
  created_at: string;
  candle_id: string;
  signal_agents: MarketRelatedSignal["signal_agents"];
};

function unwrapMarketSignal<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function normalizeMarketRelatedSignal(
  r: MarketRelatedSignalRaw,
  metaByCandleId: Map<string, { close_time: string; timeframe: string }>,
): MarketRelatedSignal {
  const cid = String(r.candle_id ?? "").trim();
  const meta = cid ? metaByCandleId.get(cid) : undefined;
  const bar = meta?.close_time && meta.close_time.trim() ? meta.close_time.trim() : r.created_at;
  return {
    id: r.id,
    signal_agent_id: r.signal_agent_id,
    close_time: bar,
    intent: r.intent,
    timeframe: meta?.timeframe ? meta.timeframe.trim() || "—" : "—",
    confidence: r.confidence,
    signal_agents: r.signal_agents,
  };
}

function agentSlugFromSignal(row: MarketRelatedSignal): string {
  const rel = row.signal_agents;
  const first = Array.isArray(rel) ? rel[0] : rel;
  const slug = first?.agent_id;
  return typeof slug === "string" && slug.trim() ? slug.trim() : row.signal_agent_id.slice(0, 8) + "…";
}

/** Lower = earlier in list when `close_time` ties (ENTER on top, then EXIT, then the rest). */
function intentRankForSort(intent: string): number {
  if (intent === "ENTER") return 0;
  if (intent === "EXIT") return 1;
  if (intent === "ADD") return 2;
  if (intent === "REDUCE") return 3;
  return 4;
}

function intentRowClass(intent: string): string {
  if (intent === "ENTER") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (intent === "EXIT") return "font-medium text-red-700 dark:text-red-400";
  if (intent === "HOLD") return "bk-text-muted";
  return "";
}

/** One row per `signal_agent_id`: latest `close_time`, tie-break ENTER → EXIT → other. */
function pickLatestSignalPerAgent(rows: MarketRelatedSignal[]): MarketRelatedSignal[] {
  const byAgent = new Map<string, MarketRelatedSignal[]>();
  for (const r of rows) {
    const aid = r.signal_agent_id;
    if (!byAgent.has(aid)) byAgent.set(aid, []);
    byAgent.get(aid)!.push(r);
  }
  const out: MarketRelatedSignal[] = [];
  for (const list of byAgent.values()) {
    const best = list.reduce((a, b) => {
      const dc = Date.parse(b.close_time) - Date.parse(a.close_time);
      if (dc > 0) return b;
      if (dc < 0) return a;
      return intentRankForSort(b.intent) < intentRankForSort(a.intent) ? b : a;
    });
    out.push(best);
  }
  return out;
}

/** List order: `close_time` desc, then ENTER, EXIT, other. */
function sortMarketRelatedSignals(rows: MarketRelatedSignal[]): MarketRelatedSignal[] {
  return [...rows].sort((a, b) => {
    const dt = Date.parse(b.close_time) - Date.parse(a.close_time);
    if (dt !== 0) return dt;
    return intentRankForSort(a.intent) - intentRankForSort(b.intent);
  });
}

export default async function MarketDetailPage({ params }: PageProps) {
  const { id } = await params;
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
      quote_asset_id,
      status,
      metadata,
      created_at,
      exchange_id,
      asset_id,
      assets!markets_asset_id_fkey ( id, code, kind, name ),
      quote_asset:assets!markets_quote_asset_id_fkey ( id, code, kind, name ),
      exchanges ( id, code, name )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !market) {
    notFound();
  }

  const rawQ = market.quote_asset as unknown;
  const quoteAsset = (Array.isArray(rawQ) ? rawQ[0] : rawQ) as {
    id?: string;
    code?: string;
    kind?: string;
    name?: string;
  } | null;
  const quoteCode = quoteAsset?.code ?? "—";
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

  let candleRows: CandleRowJson[] = [];
  try {
    const { rows } = await fetchAllMarketStorageCandles(supabase, {
      marketId: id,
      storageTimeframe: CATALOG_STORAGE_TIMEFRAME,
    });
    candleRows = rows.map(mapCatalogCandleRowToJson).filter((c): c is CandleRowJson => c != null);
  } catch (e) {
    console.error("market detail: candles fetch:", e);
  }

  const baseCandles = [...candleRows].sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));
  const initialCandles = aggregateOhlcvToTarget(baseCandles, CHART_DEFAULT_TF);

  const metadataJson =
    market.metadata && typeof market.metadata === "object"
      ? JSON.stringify(market.metadata, null, 2)
      : market.metadata == null
        ? "—"
        : String(market.metadata);

  const metaByCandleId = new Map<string, { close_time: string; timeframe: string }>();
  const { data: barRowsForSignals } = await supabase
    .schema("catalog")
    .from("candles")
    .select("id, timeframe, candle_timestamps ( close_time )")
    .eq("market_id", id)
    .order("close_time", { ascending: false, foreignTable: "candle_timestamps" })
    .limit(2500);
  for (const br of barRowsForSignals ?? []) {
    const bid = String((br as { id: string }).id ?? "").trim();
    if (!bid) continue;
    const ct = unwrapMarketSignal((br as { candle_timestamps?: unknown }).candle_timestamps);
    const closeRaw = ct && typeof (ct as { close_time?: unknown }).close_time === "string" ? (ct as { close_time: string }).close_time : "";
    metaByCandleId.set(bid, {
      close_time: String(closeRaw).trim(),
      timeframe: String((br as { timeframe?: string }).timeframe ?? "").trim(),
    });
  }
  const candleIdsForSignals = [...metaByCandleId.keys()];
  const signalRowsRaw: MarketRelatedSignalRaw[] = [];
  const SIGNAL_IN_CHUNK = 100;
  for (let i = 0; i < candleIdsForSignals.length; i += SIGNAL_IN_CHUNK) {
    const chunk = candleIdsForSignals.slice(i, i + SIGNAL_IN_CHUNK);
    const { data: sigPart, error: sigPartErr } = await supabase
      .schema("trading")
      .from("signals")
      .select("id, signal_agent_id, created_at, intent, confidence, candle_id, signal_agents ( agent_id )")
      .in("candle_id", chunk);
    if (sigPartErr) {
      console.error("market detail: signals by candle_id batch:", sigPartErr.message);
      continue;
    }
    signalRowsRaw.push(...((sigPart ?? []) as MarketRelatedSignalRaw[]));
  }

  const relatedSignals = sortMarketRelatedSignals(
    pickLatestSignalPerAgent(
      signalRowsRaw.map((row) => normalizeMarketRelatedSignal(row, metaByCandleId)),
    ),
  );

  const exchangeName = ex?.name?.trim() ? ex.name : (ex?.code ?? "—");
  const assetName = asset?.name?.trim() ? asset.name : (asset?.code ?? "—");
  const fmtConfidence = (v: number | string | null | undefined) =>
    formatDecimal(v, prefs, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <DetailPageLayout
      className="bk-container bk-container_lg px-1"
      header={objectRegistry.registrations.get("markets")!.CreateDetailPageHeader({
        record: market as Record<string, unknown>,
        title: market.market_symbol,
        titleClassName: "font-mono",
        highlights: (
          <>
            {ex?.id ? (
              <Output
                label="Exchange"
                record={{ pathPrefix: "/exchanges", id: ex.id, name: exchangeName }}
              />
            ) : (
              <Output label="Exchange" type="text" value="—" />
            )}
            {asset?.id ? (
              <Output
                label="Base asset"
                record={{
                  pathPrefix: "/assets",
                  id: encodeURIComponent(String(asset.code ?? "")),
                  name: assetName,
                }}
              />
            ) : (
              <Output label="Base asset" type="text" value="—" />
            )}
          </>
        ),
        subtitle: (
          <>
            Quote <span className="font-mono">{quoteCode}</span> · Status {market.status ?? "—"}
          </>
        ),
        actions: (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <MarketBackfillCandlesDialog marketId={id} marketSymbol={market.market_symbol} />
            <MarketBackfillSignalsButton marketId={id} />
          </div>
        ),
      })}
      content={
        <RecordPageTabs
          defaultTab="related"
          details={
            <div className="bk-stack bk-stack_gap-md">
              <RecordPageCard>
                <RecordPageSection title="Details">
                  <RecordPageGrid>
                    <Output label="Record ID" type="text" value={market.id} span="full" />
                    <Output label="Symbol" type="text" value={market.market_symbol} />
                    {quoteAsset?.id ? (
                      <Output
                        label="Quote asset"
                        record={{
                          pathPrefix: "/assets",
                          id: encodeURIComponent(String(quoteAsset.code ?? "")),
                          name: quoteAsset.name?.trim() ? quoteAsset.name : quoteCode,
                        }}
                      />
                    ) : (
                      <Output label="Quote" type="text" value={quoteCode} />
                    )}
                    <Output label="Status" type="text" value={market.status ?? "—"} />
                    <Output label="Created" type="datetime" value={market.created_at} formatDatetime={formatDt} />
                    {ex?.id ? (
                      <Output
                        label="Exchange"
                        record={{ pathPrefix: "/exchanges", id: ex.id, name: exchangeName }}
                      />
                    ) : (
                      <Output label="Exchange" type="text" value="—" />
                    )}
                    {asset?.id ? (
                      <Output
                        label="Base asset"
                        record={{
                          pathPrefix: "/assets",
                          id: encodeURIComponent(String(asset.code ?? "")),
                          name: assetName,
                        }}
                      />
                    ) : (
                      <Output label="Base asset" type="text" value="—" />
                    )}
                    <Output label="Metadata" type="codeblock" value={metadataJson} span="full" />
                  </RecordPageGrid>
                </RecordPageSection>
              </RecordPageCard>
            </div>
          }
          related={
            <div className="bk-stack bk-stack_gap-md">
              <RecordRelatedList
                title="Signals"
                icon={<ListViewObjectIcon letter="S" />}
                description={
                  <>
                    Latest bar per signal agent for this market (RLS: your user). Sorted by bar{" "}
                    <span className="font-mono">close_time</span> descending, then{" "}
                    <span className="font-mono">ENTER</span> → <span className="font-mono">EXIT</span> → other
                    intents.
                  </>
                }
                items={relatedSignals}
                getKey={(s) => s.id}
                previewLimit={24}
                totalCount={relatedSignals.length}
                viewAllHref={relatedSignals.length > 0 ? "/signals" : undefined}
                emptyMessage="No signals for this market yet (or none visible for your account)."
                renderRow={(s) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/signals/${s.id}`} className="bk-link font-mono truncate" title={s.id}>
                        {agentSlugFromSignal(s)}
                      </Link>
                      <span className="bk-text-muted font-mono text-xs">
                        {s.timeframe} · {formatDt(s.close_time)}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                      <span className={intentRowClass(s.intent)}>{s.intent}</span>
                      <span className="bk-text-muted font-mono">{fmtConfidence(s.confidence)}</span>
                    </div>
                  </div>
                )}
              />
            </div>
          }
        />
      }
      sidebar={
        <div className="bk-stack bk-stack_gap-md">
          <RecordTasksRelatedCard relatedSchema="catalog" relatedTable="markets" relatedId={id} />
          <MarketCandleChart
            marketId={id}
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
    />
  );
}
