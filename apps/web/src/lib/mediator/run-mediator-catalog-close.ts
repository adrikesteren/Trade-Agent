import "server-only";

import { evaluateTradeDecision, type SignalIntent } from "@repo/trading";
import type { RiskStateSnapshot } from "@repo/risk";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { enqueueExecutorCatalogCloseAfterMediator } from "@/lib/executor/enqueue-executor-catalog-close";
import { closeTimesMatch } from "@/lib/trading/close-time-match";
import { defaultNotionalFromExecutor, executorToMediatorRails } from "@/lib/trading/executor-mediator-rails";
import {
  ensureDefaultExecutorsForUsers,
  ensureRiskStateForExecutor,
  executorAllowsMarketAsset,
  fetchExecutorsForUsers,
  fetchMarketAssetIds,
  type ExecutorRow,
} from "@/lib/trading/executors";

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
  close_time: string;
  created_at?: string;
  signal_agents: { agent_id: string } | { agent_id: string }[] | null;
};

function agentSlugFromRow(row: SignalRow): string {
  const raw = row.signal_agents as unknown;
  const one = (Array.isArray(raw) ? raw[0] : raw) as { agent_id?: string } | null | undefined;
  return one?.agent_id ?? "unknown";
}

export async function runMediatorCatalogClose(body: MediatorCatalogCloseBody): Promise<RunMediatorCatalogCloseResult> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSizeVal = Math.min(Math.max(body.marketBatchSize ?? marketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;
  const onlyMarketId = body.onlyMarketId != null && String(body.onlyMarketId).trim() !== "" ? String(body.onlyMarketId).trim() : null;
  const disableDownstreamEnqueue = body.disableDownstreamEnqueue === true;

  const userIds = parseSignalUserIdsFromEnv();
  if (!userIds.length) {
    return {
      ok: true,
      marketsProcessed: 0,
      decisionsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      skippedReason: "no_signal_user_ids",
    };
  }

  const { data: ex, error: exErr } = await admin.schema("catalog").from("exchanges").select("id").eq("code", "bitvavo").single();
  if (exErr || !ex) throw new Error("Bitvavo exchange not found");
  const exchangeId = ex.id as string;

  let effectiveTotal: number;
  let rows: { id: string; market_symbol: string }[];

  if (onlyMarketId) {
    const { data: mrow, error: oneErr } = await admin
      .schema("catalog")
      .from("markets")
      .select("id, market_symbol, exchange_id")
      .eq("id", onlyMarketId)
      .maybeSingle();
    if (oneErr) throw new Error(oneErr.message);
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
    let countQuery = admin
      .schema("catalog")
      .from("markets")
      .select("id", { count: "exact", head: true })
      .eq("exchange_id", exchangeId);
    if (quote != null && String(quote).trim() !== "") {
      countQuery = countQuery.eq("quote_code", String(quote).trim().toUpperCase());
    }
    const { count: totalMarkets, error: countErr } = await countQuery;
    if (countErr) throw new Error(countErr.message);
    const total = totalMarkets ?? 0;
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

    const quoteArg = quote != null && String(quote).trim() !== "" ? String(quote).trim().toUpperCase() : null;
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

  const t = Date.parse(closeTimeIso);
  const closeLow = Number.isFinite(t) ? new Date(t - 2000).toISOString() : closeTimeIso;
  const closeHigh = Number.isFinite(t) ? new Date(t + 2000).toISOString() : closeTimeIso;

  await ensureDefaultExecutorsForUsers(admin, userIds);
  const executorRows = await fetchExecutorsForUsers(admin, userIds);
  const executorsByUser = new Map<string, ExecutorRow[]>();
  for (const uid of userIds) executorsByUser.set(uid, []);
  for (const ex of executorRows) {
    const cur = executorsByUser.get(ex.user_id) ?? [];
    cur.push(ex);
    executorsByUser.set(ex.user_id, cur);
  }

  for (const ex of executorRows) {
    await ensureRiskStateForExecutor(admin, { userId: ex.user_id, executorId: ex.id });
  }

  const marketIdsForAssets = rows.map((r) => r.id as string);
  const assetIdByMarket = await fetchMarketAssetIds(admin, marketIdsForAssets);

  let decisionsUpserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const marketSymbol = m.market_symbol as string;
    const marketAssetId = assetIdByMarket.get(marketId) ?? null;

    for (const userId of userIds) {
      const { data: sigData, error: sigErr } = await admin
        .schema("trading")
        .from("signals")
        .select("id, intent, close_time, created_at, signal_agents ( agent_id )")
        .eq("user_id", userId)
        .eq("market_id", marketId)
        .eq("timeframe", timeframe)
        .gte("close_time", closeLow)
        .lte("close_time", closeHigh);

      if (sigErr) throw new Error(`${marketSymbol}: signals select: ${sigErr.message}`);

      const matched = ((sigData ?? []) as SignalRow[]).filter((r) => closeTimesMatch(r.close_time, closeTimeIso));
      matched.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));

      const executors = (executorsByUser.get(userId) ?? []).filter((e) => e.enabled);
      for (const ex of executors) {
        if (!executorAllowsMarketAsset(ex, marketAssetId)) continue;

        const { data: riskEx, error: riskExErr } = await admin
          .schema("trading")
          .from("risk_state")
          .select("equity_eur, open_position_count, exposure_by_market, daily_pnl_eur, max_drawdown_eur, consecutive_losses, kill_switch")
          .eq("user_id", userId)
          .eq("executor_id", ex.id)
          .maybeSingle();

        if (riskExErr) throw new Error(riskExErr.message);
        const riskSnap = buildRiskSnapshot(riskEx ?? {}, marketId, marketSymbol);
        const rails = executorToMediatorRails(ex);
        const notionalSuggested = defaultNotionalFromExecutor(ex);

        const { data: posRow, error: posErr } = await admin
          .schema("trading")
          .from("positions")
          .select("quantity")
          .eq("user_id", userId)
          .eq("executor_id", ex.id)
          .eq("market_id", marketId)
          .maybeSingle();

        if (posErr) throw new Error(posErr.message);
        const inPosition = Number(posRow?.quantity ?? 0) > 0;

        const intents = matched.map((r) => r.intent as SignalIntent);
        const decision = evaluateTradeDecision({
          rails,
          risk: riskSnap,
          marketSymbol,
          signalIntents: intents,
          inPosition,
          notionalEurSuggested: notionalSuggested,
        });

        const canonicalClose = matched[0]?.close_time ?? closeTimeIso;
        const primarySignalId = matched[0]?.id ?? null;

        const signalsIn = matched.map((r) => ({
          id: r.id,
          intent: r.intent,
          agent_id: agentSlugFromRow(r),
        }));

        const decisionRow = {
          user_id: userId,
          executor_id: ex.id,
          market_id: marketId,
          close_time: canonicalClose,
          timeframe,
          signal_id: primarySignalId,
          approved: decision.approved,
          reason_codes: decision.reasonCodes,
          risk_snapshot: decision.riskSnapshot,
          decision_payload: {
            resolvedIntent: decision.resolvedIntent,
            policyVersion: "v1-priority",
            signalIds: matched.map((r) => r.id),
            signalsIn,
            proposedOrder: decision.proposedOrder ?? null,
            market_symbol: marketSymbol,
            executorId: ex.id,
            executorName: ex.name,
            ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
            ...(body.signalsSyncRunId ? { signalsSyncRunId: body.signalsSyncRunId } : {}),
            ...(body.mediatorPipelineSyncRunId ? { mediatorSyncRunId: body.mediatorPipelineSyncRunId } : {}),
          },
        };

        const { error: upErr } = await admin.schema("trading").from("trade_decisions").upsert(decisionRow, {
          onConflict: "user_id,executor_id,market_id,timeframe,close_time",
        });
        if (upErr) throw new Error(`${marketSymbol}: trade_decisions upsert: ${upErr.message}`);
        decisionsUpserted += 1;
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
    userIds.length > 0
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
