import "server-only";

import { evaluateTradeDecision, type SignalIntent } from "@repo/trading";
import type { RiskStateSnapshot } from "@repo/risk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { enqueueExecutorCatalogCloseAfterMediator } from "@/lib/agents/executor/services/executor-catalog-close-enqueue.service";
import { closeTimesMatch } from "@/lib/trading/close-time-match";
import { fetchWalletBalanceForAsset } from "@/lib/agents/executor/services/executor-wallet.service";
import { fetchExecutorQuoteBudgetInQuoteUnits } from "@/lib/agents/executor/services/executor-quote-budget.service";
import { executorToMediatorRails } from "@/lib/agents/executor/services/executor-mediator-rails.service";
import { applyRegimeGating } from "./regime-gating.service";
import { evaluateAndEmitSar } from "./sar-mediator-run.service";
import {
  ensureDefaultExecutorsForUsers,
  executorAllowedSides,
  executorAllowsMarketAsset,
  fetchExecutorById,
  fetchExecutorsForUsers,
  fetchMarketAssetIds,
  type ExecutorRow,
} from "@/lib/agents/executor/services/executors-lookup.service";
import * as CandlesSelector from "@/lib/selectors/candles-selector";
import * as DecisionsSelector from "@/lib/selectors/decisions-selector";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import * as ExecutorMovingFloorsSelector from "@/lib/selectors/executor-moving-floors-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import * as PositionsSelector from "@/lib/selectors/positions-selector";
import * as SignalsSelector from "@/lib/selectors/signals-selector";

export type MediatorCatalogCloseBody = {
  closeTimeIso: string;
  timeframe?: string;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  /** `automation.sync_runs.id` for this mediator_catalog_close job (set by the sync-run orchestrator). */
  mediatorPipelineSyncRunId?: string | null;
  /** When set, process only this `catalog.markets.id` (single batch; Bitvavo catalog-close only). */
  onlyMarketId?: string | null;
  /** When true, do not enqueue full-catalog executor HTTP job after the last batch. */
  disableDownstreamEnqueue?: boolean;
  /** When set, only this executor is evaluated (used for historical replay). Catalog-close still skips other historical executors when unset. */
  onlyExecutorId?: string | null;
  /** When set, use these user ids instead of the default catalog pipeline users (historical replay). */
  signalUserIdsOverride?: string[] | null;
  /**
   * When set, read `trading.signals` for these `user_id`s (e.g. `automated_process`) while applying mediator rails
   * to executors resolved separately (e.g. single `onlyExecutorId` owned by a human).
   */
  signalQueryUserIds?: string[] | null;
  /**
   * Historical executor replay only: allow repeated ENTER signals to propose further buys while
   * already long (same risk gate as first entry). Live catalog-close must not set this.
   */
  historicalReplayScaleInEnter?: boolean;
};

export type RunMediatorCatalogCloseResult = {
  ok: true;
  marketsProcessed: number;
  decisionsUpserted: number;
  nextMarketOffset: number | null;
  totalMarkets: number;
  skippedReason?: string;
};

function marketBatchSize(): number {
  const n = Number(process.env.SIGNALS_CATALOG_CLOSE_MARKET_BATCH_SIZE ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(Math.max(Math.floor(n), 1), 120);
}

function maxTotalMarkets(): number | null {
  const raw = process.env.SIGNALS_CATALOG_CLOSE_MAX_TOTAL_MARKETS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function buildRiskSnapshot(
  riskRow: {
    equity_eur?: unknown;
    open_position_count?: unknown;
    exposure_by_market?: unknown;
    daily_pnl_eur?: unknown;
    max_drawdown_eur?: unknown;
    consecutive_losses?: unknown;
    kill_switch?: unknown;
  },
  marketId: string,
  marketSymbol: string,
): RiskStateSnapshot {
  const exposureRaw = (riskRow.exposure_by_market ?? {}) as Record<string, unknown>;
  const exposureBySymbolEur: Record<string, number> = {};
  for (const [k, v] of Object.entries(exposureRaw)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    exposureBySymbolEur[k] = n;
    if (k === marketId) exposureBySymbolEur[marketSymbol] = n;
  }
  return {
    equityEur: Number(riskRow.equity_eur ?? 0),
    openPositionCount: Math.floor(Number(riskRow.open_position_count ?? 0)),
    exposureBySymbolEur,
    dailyPnlEur: Number(riskRow.daily_pnl_eur ?? 0),
    maxDrawdownEur: Number(riskRow.max_drawdown_eur ?? 0),
    consecutiveLosses: Math.floor(Number(riskRow.consecutive_losses ?? 0)),
    killSwitch: Boolean(riskRow.kill_switch),
  };
}

type SignalRow = {
  id: string;
  intent: string;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

type CandleRow = {
  id: string;
  close: string | number;
  candle_timestamps: { close_time: string; open_time: string } | { close_time: string; open_time: string }[] | null;
};

type MovingFloorStateRow = {
  peak_price_since_entry: string | number;
  floor_price: string | number;
  activated_at: string | null;
};

function agentSlugFromRow(row: SignalRow): string {
  const raw = row.signal_agents as unknown;
  const one = (Array.isArray(raw) ? raw[0] : raw) as { agent_id?: string } | null | undefined;
  return one?.agent_id ?? "unknown";
}

function mapBarCandles(rows: CandleRow[]): { id: string; close: number; closeTimeIso: string }[] {
  const mapped = (rows ?? [])
    .map((r) => {
      const rawTs = r.candle_timestamps as unknown;
      const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as { close_time?: string } | null | undefined;
      const closeTime = ts?.close_time;
      if (!closeTime) return null;
      return { id: r.id, close: Number(r.close), closeTimeIso: closeTime };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  mapped.sort((a, b) => Date.parse(a.closeTimeIso) - Date.parse(b.closeTimeIso));
  return mapped;
}

/** Latest catalog bar for this close time: OHLC close + candle row id (signals FK). */
async function findBarCandle(
  admin: SupabaseClient,
  args: { marketId: string; timeframe: string; closeTimeIso: string },
): Promise<{ price: number; candleId: string } | null> {
  const data = await CandlesSelector.selectBarsWithOpenCloseForMarket(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    limit: 500,
  });
  const rows = mapBarCandles(data as CandleRow[]);
  const hit = rows.find((r) => closeTimesMatch(r.closeTimeIso, args.closeTimeIso));
  if (!hit || !Number.isFinite(hit.close) || hit.close <= 0) return null;
  return { price: hit.close, candleId: hit.id };
}

/**
 * Pure builder for the "no quote-asset budget configured" skip-decision row.
 * Extracted so it can be unit-tested independently of Supabase mocks.
 *
 * Persists `approved=false` with `reason_codes=["quote_asset_not_allowed"]` so the UI
 * can show why nothing was placed for this bar. The shape mirrors a normal decision
 * row except `proposedOrder` is null and `resolvedIntent` is forced to "HOLD".
 */
export function buildQuoteAssetNotAllowedSkipDecision(args: {
  ownerId: string;
  executor: { id: string; name: string; exchange_id: string };
  timeframe: string;
  primarySignalId: string;
  matched: { id: string; intent: string; agent_slug: string }[];
  marketSymbol: string;
  quoteAssetIdForMarket: string;
  closeTimeIso: string;
  riskSnap: RiskStateSnapshot;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  mediatorPipelineSyncRunId?: string | null;
}) {
  return {
    user_id: args.ownerId,
    executor_id: args.executor.id,
    timeframe: args.timeframe,
    signal_id: args.primarySignalId,
    approved: false,
    reason_codes: ["quote_asset_not_allowed"],
    risk_snapshot: args.riskSnap,
    position_side: "long" as const,
    decision_payload: {
      resolvedIntent: "HOLD" as const,
      policyVersion: "v1-priority",
      signalIds: args.matched.map((r) => r.id),
      signalsIn: args.matched.map((r) => ({
        id: r.id,
        intent: r.intent,
        agent_id: r.agent_slug,
      })),
      proposedOrder: null,
      market_symbol: args.marketSymbol,
      executorId: args.executor.id,
      executorName: args.executor.name,
      exchangeId: args.executor.exchange_id,
      movingFloor: null,
      barCloseTimeIso: args.closeTimeIso,
      quoteAssetId: args.quoteAssetIdForMarket,
      positionSide: "long",
      ...(args.candleSyncRunId ? { candleSyncRunId: args.candleSyncRunId } : {}),
      ...(args.signalsSyncRunId ? { signalsSyncRunId: args.signalsSyncRunId } : {}),
      ...(args.mediatorPipelineSyncRunId ? { mediatorSyncRunId: args.mediatorPipelineSyncRunId } : {}),
    },
  };
}

function computeMovingFloorDecision(args: {
  avgPrice: number;
  closePrice: number;
  prevPeak: number;
  prevFloor: number;
  wasActivated: boolean;
  trailPct: number;
  activationProfitPct: number;
}) {
  const activationPrice = args.avgPrice * (1 + args.activationProfitPct);
  const activated = args.wasActivated || args.closePrice >= activationPrice;
  const peak = Math.max(args.prevPeak, args.closePrice);
  const computedFloor = peak * (1 - args.trailPct);
  const floor = activated ? Math.max(args.prevFloor, computedFloor) : args.prevFloor;
  const triggerExit = activated && args.closePrice <= floor;
  return { peak, floor, activated, triggerExit };
}

export async function runMediatorCatalogClose(body: MediatorCatalogCloseBody): Promise<RunMediatorCatalogCloseResult> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSizeVal = Math.min(Math.max(body.marketBatchSize ?? marketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;
  const onlyMarketId = body.onlyMarketId != null && String(body.onlyMarketId).trim() !== "" ? String(body.onlyMarketId).trim() : null;
  const onlyExecutorId =
    body.onlyExecutorId != null && String(body.onlyExecutorId).trim() !== "" ? String(body.onlyExecutorId).trim() : null;
  const disableDownstreamEnqueue = body.disableDownstreamEnqueue === true;
  const historicalReplayScaleInEnter = body.historicalReplayScaleInEnter === true;

  const override = body.signalUserIdsOverride?.filter((x) => String(x ?? "").trim() !== "") ?? null;
  const userIds = override?.length ? override : await getCatalogPipelineUserIds(admin);

  const sqOverride = body.signalQueryUserIds?.map((x) => String(x ?? "").trim()).filter(Boolean) ?? null;
  const signalQueryUserIds = sqOverride?.length ? sqOverride : userIds;

  if (!signalQueryUserIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      decisionsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "no_signal_user_ids",
    };
  }

  if (!onlyExecutorId && !userIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      decisionsUpserted: 0,
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
      decisionsUpserted: 0,
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
        decisionsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: 0,
        skippedReason: "only_market_not_found",
      };
    }
    if (String(mrow.exchange_id) !== exchangeId) {
      throw new Error("mediator_catalog_close: onlyMarketId must be a Bitvavo catalog market");
    }
    effectiveTotal = 1;
    rows = [{ id: mrow.id as string, market_symbol: String(mrow.market_symbol) }];
    if (marketOffset > 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        decisionsUpserted: 0,
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
    const maxTotal = maxTotalMarkets();
    effectiveTotal = maxTotal != null ? Math.min(total, maxTotal) : total;

    if (marketOffset >= effectiveTotal || effectiveTotal === 0) {
      return {
        ok: true,
        marketsProcessed: 0,
        decisionsUpserted: 0,
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
      p_limit: marketBatchSizeVal,
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
      decisionsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: effectiveTotal,
      skippedReason: "no_market_rows",
    };
  }

  let executorRows: ExecutorRow[];
  if (onlyExecutorId) {
    const lone = await fetchExecutorById(admin, onlyExecutorId);
    if (!lone) {
      return {
        ok: true,
        marketsProcessed: 0,
        decisionsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: "only_executor_not_found",
      };
    }
    await ensureDefaultExecutorsForUsers(admin, [lone.user_id]);
    executorRows = [lone];
  } else {
    if (!userIds.length) {
      return {
        ok: true,
        marketsProcessed: 0,
        decisionsUpserted: 0,
        nextMarketOffset: null,
        totalMarkets: effectiveTotal,
        skippedReason: "no_signal_user_ids",
      };
    }
    await ensureDefaultExecutorsForUsers(admin, userIds);
    executorRows = await fetchExecutorsForUsers(admin, userIds);
  }

  const executorsByUser = new Map<string, ExecutorRow[]>();
  for (const ex of executorRows) {
    const cur = executorsByUser.get(ex.user_id) ?? [];
    cur.push(ex);
    executorsByUser.set(ex.user_id, cur);
  }
  for (const suid of signalQueryUserIds) {
    if (!executorsByUser.has(suid)) executorsByUser.set(suid, []);
  }

  const marketIdsForAssets = rows.map((r) => r.id as string);
  const assetIdByMarket = await fetchMarketAssetIds(admin, marketIdsForAssets);

  let decisionsUpserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const marketSymbol = m.market_symbol as string;
    const marketAssetId = assetIdByMarket.get(marketId) ?? null;

    const quoteAssetIdForMarket =
      String((await MarketsSelector.selectQuoteAssetIdById(admin, marketId)) ?? "").trim() || null;

    const bar = await findBarCandle(admin, { marketId, timeframe, closeTimeIso });
    if (!bar) continue;

    for (const signalUid of signalQueryUserIds) {
      let sigData: SignalsSelector.SignalForMediatorRow[];
      try {
        sigData = await SignalsSelector.selectForMediatorByUserAndCandle(admin, {
          userId: signalUid,
          candleId: bar.candleId,
        });
      } catch (e) {
        throw new Error(`${marketSymbol}: signals select: ${e instanceof Error ? e.message : String(e)}`);
      }

      const matched = sigData as SignalRow[];
      matched.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

      const executors = onlyExecutorId
        ? executorRows.filter(
            (e) =>
              e.enabled &&
              e.id === onlyExecutorId &&
              executorAllowsMarketAsset(e, marketAssetId) &&
              String(e.exchange_id) === exchangeId,
          )
        : (executorsByUser.get(signalUid) ?? []).filter((e) => e.enabled);
      for (const ex of executors) {
        if (ex.execution_mode === "historical" && (!onlyExecutorId || ex.id !== onlyExecutorId)) continue;
        if (!executorAllowsMarketAsset(ex, marketAssetId)) continue;
        if (String(ex.exchange_id) !== exchangeId) continue;

        // P2 sides framework: until P3 (regime + SAR) wires real shorts, the mediator
        // only ever proposes LONG entries. If this executor doesn't allow long, skip
        // it entirely — there's nothing the mediator can emit for it on this bar.
        const allowedSides = executorAllowedSides(ex);
        if (!allowedSides.includes("long")) {
          continue;
        }

        const ownerId = ex.user_id;

        const quoteBalance =
          quoteAssetIdForMarket != null
            ? await fetchWalletBalanceForAsset(admin, { executorId: ex.id, assetId: quoteAssetIdForMarket })
            : 0;
        const riskSnap = buildRiskSnapshot(
          {
            equity_eur: quoteBalance,
            open_position_count: ex.risk_open_position_count,
            exposure_by_market: ex.risk_exposure_by_market ?? {},
            daily_pnl_eur: ex.risk_daily_pnl_eur,
            max_drawdown_eur: ex.risk_runtime_max_drawdown_eur,
            consecutive_losses: ex.risk_consecutive_losses,
            kill_switch: ex.risk_kill_switch,
          },
          marketId,
          marketSymbol,
        );
        const rails = executorToMediatorRails(ex);

        // Quote-asset budget lookup (P1): every (executor, market quote) pair must have a row in
        // trading.executor_quote_asset_budget. Missing → skip with reason quote_asset_not_allowed.
        if (!quoteAssetIdForMarket) continue;
        const notionalSuggested = await fetchExecutorQuoteBudgetInQuoteUnits(admin, {
          executorId: ex.id,
          quoteAssetId: quoteAssetIdForMarket,
        });
        if (notionalSuggested == null || !Number.isFinite(notionalSuggested) || notionalSuggested <= 0) {
          if (matched.length && matched[0]?.id) {
            const skipRow = buildQuoteAssetNotAllowedSkipDecision({
              ownerId,
              executor: { id: ex.id, name: ex.name, exchange_id: ex.exchange_id },
              timeframe,
              primarySignalId: matched[0].id,
              matched: matched.map((r) => ({ id: r.id, intent: r.intent, agent_slug: agentSlugFromRow(r) })),
              marketSymbol,
              quoteAssetIdForMarket,
              closeTimeIso,
              riskSnap,
              candleSyncRunId: body.candleSyncRunId,
              signalsSyncRunId: body.signalsSyncRunId,
              mediatorPipelineSyncRunId: body.mediatorPipelineSyncRunId,
            });
            try {
              await DecisionsSelector.upsertOneByExecutorSignalSide(admin, skipRow);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              throw new Error(`${marketSymbol}: decisions skip upsert: ${msg}`);
            }
            decisionsUpserted += 1;
          }
          continue;
        }

        const posRow = await PositionsSelector.selectQtyAvgByTrio(admin, {
          userId: ownerId,
          executorId: ex.id,
          marketId,
        });
        const positionQty = Number(posRow?.quantity ?? 0);
        const avgPrice = Number(posRow?.avg_price ?? 0);
        const inPosition = positionQty > 0;
        const closePrice = bar.price;

        let forceExit = false;
        let movingFloorSnapshot: Record<string, unknown> | null = null;
        if (inPosition) {
          const floorRow = await ExecutorMovingFloorsSelector.selectByTrio(admin, {
            userId: ownerId,
            executorId: ex.id,
            marketId,
          });
          if (Number.isFinite(avgPrice) && avgPrice > 0 && rails.profitTakingEnabled) {
            const trailPct = Number(rails.movingFloorTrailPct ?? 0.15);
            const activationProfitPct = Number(rails.movingFloorActivationProfitPct ?? 0.05);
            const prevPeak = Math.max(Number(floorRow?.peak_price_since_entry ?? avgPrice), avgPrice);
            const prevFloor = Math.max(Number(floorRow?.floor_price ?? avgPrice), 0);
            const wasActivated = Boolean(floorRow?.activated_at);
            const next = computeMovingFloorDecision({
              avgPrice,
              closePrice,
              prevPeak,
              prevFloor,
              wasActivated,
              trailPct,
              activationProfitPct,
            });
            await ExecutorMovingFloorsSelector.upsertOneByTrio(admin, {
              user_id: ownerId,
              executor_id: ex.id,
              market_id: marketId,
              peak_price_since_entry: next.peak,
              floor_price: next.floor,
              activated_at: next.activated ? (floorRow?.activated_at ?? new Date().toISOString()) : null,
              updated_at: new Date().toISOString(),
            });
            forceExit = next.triggerExit;
            movingFloorSnapshot = {
              avgPrice,
              closePrice,
              peakPriceSinceEntry: next.peak,
              floorPrice: next.floor,
              activated: next.activated,
              trailPct,
              activationProfitPct,
              triggerExit: next.triggerExit,
            };
          }
        } else {
          await ExecutorMovingFloorsSelector.deleteByTrio(admin, {
            userId: ownerId,
            executorId: ex.id,
            marketId,
          });
        }

        // P3: regime gating. The mediator applies it before evaluating to
        // avoid emitting ENTER decisions in bear / unconfirmed-sideways regimes.
        const regimeGatingEnabled =
          (ex.mediator_rails_extra as Record<string, unknown> | null | undefined)?.regimeGating !== false;
        const regimeGate = applyRegimeGating({
          matched: matched.map((r) => ({
            id: r.id,
            intent: r.intent,
            agent_slug: agentSlugFromRow(r),
            metadata: r.metadata ?? null,
          })),
          regimeGatingEnabled,
        });

        const intents = regimeGate.effectiveIntents.map((i) => i as SignalIntent);
        const decision = evaluateTradeDecision({
          rails,
          risk: riskSnap,
          marketSymbol,
          signalIntents: intents,
          inPosition,
          positionQuantity: positionQty,
          marketPriceEur: closePrice,
          forceExit,
          notionalEurSuggested: notionalSuggested,
          enterScaleInWhenLong: historicalReplayScaleInEnter,
        });

        const primarySignalId = matched[0]?.id ?? null;
        if (!matched.length || !primarySignalId) continue;

        const signalsIn = matched.map((r) => ({
          id: r.id,
          intent: r.intent,
          agent_id: agentSlugFromRow(r),
        }));

        // P2 sides framework: every decision carries position_side. Until SAR (P3),
        // proposedOrder is always long; the column makes the future short rows
        // (and SAR's EXIT-long + ENTER-short pair) addressable in the unique key.
        const proposedOrderWithSide =
          decision.proposedOrder != null
            ? { ...decision.proposedOrder, positionSide: "long" as const }
            : null;
        const reasonCodesWithRegime = regimeGate.demotionReason
          ? [...decision.reasonCodes, regimeGate.demotionReason]
          : decision.reasonCodes;

        const decisionRow = {
          user_id: ownerId,
          executor_id: ex.id,
          timeframe,
          signal_id: primarySignalId,
          approved: decision.approved,
          reason_codes: reasonCodesWithRegime,
          risk_snapshot: decision.riskSnapshot,
          position_side: "long" as const,
          decision_payload: {
            resolvedIntent: decision.resolvedIntent,
            policyVersion: "v1-priority",
            signalIds: matched.map((r) => r.id),
            signalsIn,
            proposedOrder: proposedOrderWithSide,
            market_symbol: marketSymbol,
            executorId: ex.id,
            executorName: ex.name,
            exchangeId: ex.exchange_id,
            movingFloor: movingFloorSnapshot,
            barCloseTimeIso: closeTimeIso,
            positionSide: "long",
            ...(regimeGate.regime
              ? { regime: regimeGate.regime, regimeSignalSide: regimeGate.regimeSignalSide ?? null }
              : {}),
            ...(regimeGate.demotionReason ? { regimeDemotion: regimeGate.demotionReason } : {}),
            ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
            ...(body.signalsSyncRunId ? { signalsSyncRunId: body.signalsSyncRunId } : {}),
            ...(body.mediatorPipelineSyncRunId ? { mediatorSyncRunId: body.mediatorPipelineSyncRunId } : {}),
          },
        };

        try {
          await DecisionsSelector.upsertOneByExecutorSignalSide(admin, decisionRow);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`${marketSymbol}: decisions upsert: ${msg}`);
        }
        decisionsUpserted += 1;

        // P3: SAR (Stop-and-Reverse). Independent of the primary decision —
        // when the regime classifier signal for this bar confirms a flip
        // against t-1 and t-2, emit paired EXIT(old side) + ENTER(new side).
        const regimeSignal = matched.find((r) => agentSlugFromRow(r) === "regime-classifier-15m-v1");
        if (regimeGatingEnabled && regimeSignal) {
          try {
            const sarRes = await evaluateAndEmitSar({
              admin,
              userId: ownerId,
              executorId: ex.id,
              executorName: ex.name,
              exchangeId: ex.exchange_id,
              marketId,
              marketSymbol,
              timeframe,
              closeTimeIso,
              regimeSignalId: regimeSignal.id,
              regimeSignalMetadata: regimeSignal.metadata ?? null,
              allowedSides,
              notionalQuoteForEnter: notionalSuggested ?? null,
              candleSyncRunId: body.candleSyncRunId,
              signalsSyncRunId: body.signalsSyncRunId,
              mediatorPipelineSyncRunId: body.mediatorPipelineSyncRunId,
              riskSnapshot: decision.riskSnapshot as Record<string, unknown>,
            });
            decisionsUpserted += sarRes.decisionsUpserted;
          } catch (sarErr) {
            console.error(`[mediator/sar] ${marketSymbol} ${ex.name}: ${(sarErr as Error).message}`);
          }
        }
      }
    }
  }

  const nextOffset = onlyMarketId ? 1 : marketOffset + rows.length;
  const nextMarketOffset = nextOffset < effectiveTotal ? nextOffset : null;

  if (
    nextMarketOffset == null &&
    rows.length > 0 &&
    decisionsUpserted > 0 &&
    !disableDownstreamEnqueue &&
    process.env.EXECUTOR_AFTER_MEDIATOR_DISABLE !== "1" &&
    signalQueryUserIds.length > 0
  ) {
    try {
      await enqueueExecutorCatalogCloseAfterMediator({
        closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
        mediatorSyncRunId: body.mediatorPipelineSyncRunId ?? null,
      });
    } catch (e) {
      console.error("enqueueExecutorCatalogCloseAfterMediator failed:", e);
    }
  }

  return {
    ok: true,
    marketsProcessed: rows.length,
    decisionsUpserted,
    nextMarketOffset,
    totalMarkets: effectiveTotal,
  };
}

/** Process all market batches in-process for one catalog bar close. */
export async function runMediatorCatalogCloseDrain(body: MediatorCatalogCloseBody): Promise<RunMediatorCatalogCloseResult> {
  let offset = body.marketOffset ?? 0;
  let totalDecisions = 0;
  let totalMarkets = 0;
  let last: RunMediatorCatalogCloseResult | null = null;
  const maxIters = Number(process.env.SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS ?? 400);
  const cap = Math.min(Math.max(Math.floor(maxIters), 1), 2000);

  let marketsSum = 0;
  for (let i = 0; i < cap; i++) {
    last = await runMediatorCatalogClose({ ...body, marketOffset: offset });
    totalMarkets = last.totalMarkets;
    totalDecisions += last.decisionsUpserted;
    marketsSum += last.marketsProcessed;
    if (last.nextMarketOffset == null) break;
    offset = last.nextMarketOffset;
  }

  return {
    ok: true,
    marketsProcessed: marketsSum,
    decisionsUpserted: totalDecisions,
    nextMarketOffset: last?.nextMarketOffset ?? null,
    totalMarkets,
  };
}
