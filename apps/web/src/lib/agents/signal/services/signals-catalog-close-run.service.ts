import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { barsForIncrementalFetchWindow } from "@/lib/agents/ingest/services/candle-retention.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import { enqueueMediatorCatalogCloseAfterSignals } from "@/lib/agents/trade-mediator/services/mediator-catalog-close-enqueue.service";
import { closeTimesMatch } from "@/lib/trading/close-time-match";

import { evaluateMaCrossAtClose, type MaCrossBar } from "./ma-cross-eval.service";
import { evaluateRsiReversionAtClose } from "./rsi-reversion-eval.service";
import { evaluateBreakoutAtrAtClose } from "./breakout-atr-eval.service";
import { evaluateRegimeAtClose } from "./regime-classifier-eval.service";
import { evaluateMultiTfConfluenceAtClose } from "./multi-timeframe-confluence-eval.service";
import { filterSignalUserIdsToExistingAuthUsers, getCatalogPipelineUserIds } from "./signal-user-ids.service";
import { aggregateReplayBarsToTimeframe } from "@/lib/markets/aggregate-replay-bars";

import * as CandlesSelector from "@/lib/selectors/candles-selector";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import * as SignalAgentsSelector from "@/lib/selectors/signal-agents-selector";
import * as SignalsSelector from "@/lib/selectors/signals-selector";

/**
 * P3: parse a "min/max ATR pct" entry from `signal_agents.config` JSON.
 * Accepts numbers; returns null for missing / non-finite values so the
 * eval services treat the bound as not-configured (no-op gate).
 */
function parseGateNumber(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

export type SignalsCatalogCloseBody = {
  closeTimeIso: string;
  timeframe?: string;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  candleSyncRunId?: string | null;
  /** `automation.sync_runs.id` for this signals_catalog_close job (set by the sync-run orchestrator). */
  signalsSyncRunId?: string | null;
  /** When set, process only this `catalog.markets.id` (single batch; Bitvavo catalog-close only). */
  onlyMarketId?: string | null;
  /** When true, do not enqueue full-catalog mediator HTTP job after the last batch. */
  disableDownstreamEnqueue?: boolean;
  /** When set, use these user ids instead of the default catalog pipeline users (historical replay for executor owner). */
  signalUserIdsOverride?: string[] | null;
};

export type RunSignalsCatalogCloseResult = {
  ok: true;
  marketsProcessed: number;
  signalsUpserted: number;
  nextMarketOffset: number | null;
  totalMarkets: number;
  skippedReason?: string;
};

function signalMarketBatchSize(): number {
  const n = Number(process.env.SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

function signalMaxTotalMarkets(): number | null {
  const raw = process.env.SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

type CandleRow = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps: { close_time: string; open_time: string } | { close_time: string; open_time: string }[] | null;
};

function mapCandleRows(rows: CandleRow[]): {
  id: string;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTimeIso: string;
}[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return {
        id: r.id,
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
        closeTimeIso: closeTime,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

async function fetchCandlesForMarket(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; barLimit: number },
): Promise<CandleRow[]> {
  // Newest bars first, then cap — unbounded LIMIT without ORDER can omit the latest close (wrong eval / missing target bar).
  const data = await CandlesSelector.selectOhlcvWithOpenCloseInnerOrderedDescForMarket(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    limit: args.barLimit,
  });
  return data as CandleRow[];
}

export async function runSignalsCatalogClose(body: SignalsCatalogCloseBody): Promise<RunSignalsCatalogCloseResult> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSize = Math.min(Math.max(body.marketBatchSize ?? signalMarketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;
  const onlyMarketId = body.onlyMarketId != null && String(body.onlyMarketId).trim() !== "" ? String(body.onlyMarketId).trim() : null;
  const disableDownstreamEnqueue = body.disableDownstreamEnqueue === true;

  const override = body.signalUserIdsOverride?.filter((x) => String(x ?? "").trim() !== "") ?? null;
  const configuredUserIds = override?.length ? override : await getCatalogPipelineUserIds(admin);
  if (!configuredUserIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "no_signal_user_ids",
    };
  }

  const exchangeId = await ExchangesSelector.selectIdByCode(admin, "bitvavo");

  const quoteNorm = quote != null && String(quote).trim() !== "" ? String(quote).trim().toUpperCase() : null;
  const quoteAssetIdFilter = quoteNorm ? await resolveQuoteAssetId(admin, quoteNorm) : null;
  if (quoteNorm && !quoteAssetIdFilter) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "unknown_quote_asset",
    };
  }

  let effectiveTotal: number;
  let rows: { id: string; market_symbol: string }[];

  if (onlyMarketId) {
    const mrow = await MarketsSelector.selectIdSymbolExchangeById(admin, onlyMarketId);
    if (!mrow) {
      return {
        ok: true,
        marketsProcessed: 0,
        signalsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: 0,
        skippedReason: "only_market_not_found",
      };
    }
    if (String(mrow.exchange_id) !== exchangeId) {
      throw new Error("signals_catalog_close: onlyMarketId must be a Bitvavo catalog market");
    }
    effectiveTotal = 1;
    rows = [{ id: mrow.id as string, market_symbol: String(mrow.market_symbol) }];
    if (marketOffset > 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        signalsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: 1,
        skippedReason: "market_offset_past_end",
      };
    }
  } else {
    const total = await MarketsSelector.countByExchangeAndOptionalQuote(admin, {
      exchangeId,
      quoteAssetId: quoteAssetIdFilter,
    });
    const maxTotal = signalMaxTotalMarkets();
    effectiveTotal = maxTotal != null ? Math.min(total, maxTotal) : total;

    if (marketOffset >= effectiveTotal || effectiveTotal === 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        signalsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: marketOffset >= effectiveTotal ? "market_offset_past_end" : undefined,
      };
    }

    const quoteArg = quoteNorm;
    const { data: markets, error: listErr } = await admin.schema("catalog").rpc("bitvavo_markets_for_candle_sync_slice", {
      p_exchange_id: exchangeId,
      p_quote: quoteArg,
      p_offset: marketOffset,
      p_limit: marketBatchSize,
    });
    if (listErr) throw new Error(listErr.message);
    const rowsRaw = (markets ?? []) as { id: string; market_symbol: string }[];
    const remainingBudget = Math.max(effectiveTotal - marketOffset, 0);
    rows = remainingBudget < rowsRaw.length ? rowsRaw.slice(0, remainingBudget) : rowsRaw;
  }

  if (rows.length === 0) {
    return {
      ok: true,
      marketsProcessed: 0,
      signalsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: effectiveTotal,
      skippedReason: "no_market_rows",
    };
  }

  const agents = await SignalAgentsSelector.selectActiveWithConfig(admin);

  const activeAgents = agents.filter((a) => {
    const tf = a.allowed_timeframes;
    if (!tf || tf.length === 0) return true;
    return tf.includes(timeframe);
  });

  const signalUserIds = await filterSignalUserIdsToExistingAuthUsers(admin, configuredUserIds);
  if (!signalUserIds.length && configuredUserIds.length > 0) {
    console.warn(
      "[signals-catalog-close] No catalog pipeline user ids resolved (automated_process missing in automation_actor / user_profiles, or auth user missing). Skipping signal upserts for this batch; remaining market batches still advance.",
    );
  }

  const barLimit = barsForIncrementalFetchWindow(timeframe);
  let signalsUpserted = 0;

  const noAgentsForTf = activeAgents.length === 0 && rows.length > 0;

  if (signalUserIds.length > 0) {
    for (const m of rows) {
      const marketId = m.id as string;
      const raw = await fetchCandlesForMarket(admin, { marketId, timeframe, barLimit });
      const sorted = mapCandleRows(raw);
      const barsAsc: MaCrossBar[] = sorted.map((r) => ({
        close: r.close,
        closeTimeIso: r.closeTimeIso,
        high: r.high,
        low: r.low,
      }));
      const targetRow = sorted.find((r) => closeTimesMatch(r.closeTimeIso, closeTimeIso));
      const candleId = targetRow?.id ?? null;

      for (const agent of activeAgents) {
        const cfg = (agent.config ?? {}) as Record<string, unknown>;
        const minAtrPct = parseGateNumber(cfg.minAtrPct);
        const maxAtrPct = parseGateNumber(cfg.maxAtrPct);
        let ev:
          | ReturnType<typeof evaluateMaCrossAtClose>
          | ReturnType<typeof evaluateRsiReversionAtClose>
          | ReturnType<typeof evaluateBreakoutAtrAtClose>
          | ReturnType<typeof evaluateRegimeAtClose>
          | ReturnType<typeof evaluateMultiTfConfluenceAtClose>;
        if (agent.agent_id === "ma-cross-15m-v1") {
          const fastPeriod = Math.floor(Number(cfg.fastPeriod ?? 9));
          const slowPeriod = Math.floor(Number(cfg.slowPeriod ?? 21));
          ev = evaluateMaCrossAtClose({
            barsAsc,
            targetCloseTimeIso: closeTimeIso,
            fastPeriod,
            slowPeriod,
            minAtrPct,
            maxAtrPct,
          });
        } else if (agent.agent_id === "rsi-reversion-15m-v1") {
          const rsiPeriod = Math.floor(Number(cfg.rsiPeriod ?? 14));
          const oversold = Number(cfg.oversold ?? 30);
          const overbought = parseGateNumber(cfg.overbought);
          const maxAdx = parseGateNumber(cfg.maxAdx);
          ev = evaluateRsiReversionAtClose({
            barsAsc,
            targetCloseTimeIso: closeTimeIso,
            rsiPeriod,
            oversold,
            overbought,
            minAtrPct,
            maxAtrPct,
            maxAdx,
          });
        } else if (agent.agent_id === "breakout-atr-15m-v1") {
          const lookbackBars = Math.floor(Number(cfg.lookbackBars ?? 20));
          const atrPeriod = Math.floor(Number(cfg.atrPeriod ?? 14));
          const atrMultiplier = Number(cfg.atrMultiplier ?? 1.2);
          const volumeConfirmationMultiplier = parseGateNumber(cfg.volumeConfirmationMultiplier);
          const volumeLookbackBars = parseGateNumber(cfg.volumeLookbackBars);
          const minAdx = parseGateNumber(cfg.minAdx);
          ev = evaluateBreakoutAtrAtClose({
            barsAsc: sorted.map((r) => ({
              high: r.high,
              low: r.low,
              close: r.close,
              closeTimeIso: r.closeTimeIso,
              volume: r.volume,
            })),
            targetCloseTimeIso: closeTimeIso,
            lookbackBars,
            atrPeriod,
            atrMultiplier,
            minAtrPct,
            maxAtrPct,
            volumeConfirmationMultiplier,
            ...(volumeLookbackBars != null
              ? { volumeLookbackBars: Math.max(2, Math.floor(volumeLookbackBars)) }
              : {}),
            minAdx,
          });
        } else if (agent.agent_id === "regime-classifier-15m-v1") {
          // P3 wireup: aggregate the 15m series to the configured trend timeframe
          // (default 4h, seeded value) in-memory, then evaluate the SMA(maPeriod)
          // classifier at the target close.
          // History needed = `maPeriod × trendTimeframeMinutes` of price data, so
          // 4h × 200 = ~33 days vs. daily × 200 = ~6.5 months. Bars are aggregated
          // from the 15m series the catalog stores; ingest already pre-loads enough
          // warmup for both live and historical-replay paths (see `computeWarmupBars`).
          const maPeriod = Math.floor(Number(cfg.maPeriod ?? 200));
          const slopeBars = Math.floor(Number(cfg.slopeLookback ?? 20));
          const trendTimeframeMinutes = Math.max(15, Math.floor(Number(cfg.trendTimeframeMinutes ?? 240)));
          const slopePctEps = parseGateNumber(cfg.slopePctEps) ?? undefined;
          const distancePctEps = parseGateNumber(cfg.distancePctEps) ?? undefined;
          const trendBars = aggregateReplayBarsToTimeframe(barsAsc, trendTimeframeMinutes);
          ev = evaluateRegimeAtClose({
            barsAsc: trendBars,
            targetCloseTimeIso: closeTimeIso,
            maPeriod,
            slopeBars,
            trendTimeframeMinutes,
            ...(slopePctEps != null ? { slopePctEps } : {}),
            ...(distancePctEps != null ? { distancePctEps } : {}),
          });
        } else if (agent.agent_id === "multi-tf-confluence-15m-v1") {
          // P3 wireup: 4h trend leg + 15m entry leg. The 4h bars are an
          // in-memory aggregation of the same 15m slice.
          const trendMa = Math.floor(Number(cfg.trendMa ?? 50));
          const entryRsiPeriod = Math.floor(Number(cfg.entryRsiPeriod ?? 14));
          const entryRsi = Number(cfg.entryRsi ?? 30);
          const trendBars = aggregateReplayBarsToTimeframe(barsAsc, 240);
          ev = evaluateMultiTfConfluenceAtClose({
            trendBarsAsc: trendBars,
            entryBarsAsc: barsAsc,
            targetCloseTimeIso: closeTimeIso,
            trendMa,
            entryRsiPeriod,
            entryRsi,
          });
        } else {
          continue;
        }

        for (const userId of signalUserIds) {
          if (!candleId) continue;
          const row = {
            user_id: userId,
            signal_agent_id: agent.id,
            candle_id: candleId,
            intent: ev.intent,
            signal_side: ev.signalSide ?? "long",
            confidence: ev.confidence,
            reasons: ev.reasons,
            metadata: {
              ...ev.metadata,
              market_symbol: m.market_symbol,
              agent_id: agent.agent_id,
              ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
              ...(body.signalsSyncRunId ? { signalsSyncRunId: body.signalsSyncRunId } : {}),
            },
          };

          try {
            await SignalsSelector.upsertOneByUserAgentCandle(admin, row);
          } catch (e) {
            throw new Error(`${m.market_symbol}: signals upsert: ${e instanceof Error ? e.message : String(e)}`);
          }
          signalsUpserted += 1;
        }
      }
    }
  }

  const nextOffset = onlyMarketId ? 1 : marketOffset + rows.length;
  const nextMarketOffset = nextOffset < effectiveTotal ? nextOffset : null;

  if (
    nextMarketOffset == null &&
    rows.length > 0 &&
    signalsUpserted > 0 &&
    !disableDownstreamEnqueue &&
    process.env.MEDIATOR_AFTER_SIGNALS_DISABLE !== "1" &&
    signalUserIds.length > 0
  ) {
    try {
      await enqueueMediatorCatalogCloseAfterSignals({
        closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
      });
    } catch (e) {
      console.error("enqueueMediatorCatalogCloseAfterSignals failed:", e);
    }
  }

  let skippedReason: RunSignalsCatalogCloseResult["skippedReason"];
  if (configuredUserIds.length > 0 && signalUserIds.length === 0) {
    skippedReason = "signal_user_ids_not_in_auth";
  } else if (noAgentsForTf) {
    skippedReason = "no_enabled_signal_agents_for_timeframe";
  }

  return {
    ok: true,
    marketsProcessed: rows.length,
    signalsUpserted,
    nextMarketOffset,
    totalMarkets: effectiveTotal,
    ...(skippedReason ? { skippedReason } : {}),
  };
}

/** Process all market batches in-process for one catalog bar close. */
export async function runSignalsCatalogCloseDrain(body: SignalsCatalogCloseBody): Promise<RunSignalsCatalogCloseResult> {
  let offset = body.marketOffset ?? 0;
  let totalSignals = 0;
  let totalMarkets = 0;
  let last: RunSignalsCatalogCloseResult | null = null;
  let firstSkippedReason: RunSignalsCatalogCloseResult["skippedReason"];
  const maxIters = Number(process.env.SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS ?? 400);
  const cap = Math.min(Math.max(Math.floor(maxIters), 1), 2000);

  let marketsSum = 0;
  for (let i = 0; i < cap; i++) {
    last = await runSignalsCatalogClose({ ...body, marketOffset: offset });
    totalMarkets = last.totalMarkets;
    totalSignals += last.signalsUpserted;
    marketsSum += last.marketsProcessed;
    if (firstSkippedReason == null && last.skippedReason) {
      firstSkippedReason = last.skippedReason;
    }
    if (last.nextMarketOffset == null) break;
    offset = last.nextMarketOffset;
  }

  return {
    ok: true,
    marketsProcessed: marketsSum,
    signalsUpserted: totalSignals,
    nextMarketOffset: last?.nextMarketOffset ?? null,
    totalMarkets,
    ...(totalSignals === 0 && firstSkippedReason ? { skippedReason: firstSkippedReason } : {}),
  };
}
