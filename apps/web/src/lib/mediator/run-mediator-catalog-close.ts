import "server-only";

import { Client } from "@upstash/qstash";

import { evaluateTradeDecision, type MediatorRailsConfig, type SignalIntent } from "@repo/trading";
import type { RiskStateSnapshot } from "@repo/risk";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { enqueueExecutorCatalogCloseAfterMediator } from "@/lib/executor/enqueue-executor-catalog-close";
import { closeTimesMatch } from "@/lib/trading/close-time-match";
import { fetchUserUsesPaperBook } from "@/lib/trading/user-execution-paper";
import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

export type MediatorCatalogCloseBody = {
  closeTimeIso: string;
  timeframe?: string;
  quote?: string | null;
  marketOffset?: number;
  marketBatchSize?: number;
  candleSyncRunId?: string | null;
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

function defaultRails(): MediatorRailsConfig {
  return {
    maxRiskPerTrade: 0.05,
    maxOpenPositions: 5,
    maxExposurePerSymbolEur: 500,
    dailyLossLimitEur: 100,
    maxDrawdownEur: 500,
    cooldownAfterLosses: 3,
    allowAdd: false,
  };
}

function mediatorRailsFromEnv(): MediatorRailsConfig {
  const raw = process.env.MEDIATOR_RISK_RAILS_JSON?.trim();
  if (!raw) return defaultRails();
  try {
    const o = JSON.parse(raw) as Partial<MediatorRailsConfig>;
    return { ...defaultRails(), ...o };
  } catch {
    return defaultRails();
  }
}

function defaultNotionalEur(): number {
  const n = Number(process.env.MEDIATOR_DEFAULT_NOTIONAL_EUR ?? 100);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return n;
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

export async function runMediatorCatalogClose(
  body: MediatorCatalogCloseBody,
  opts?: { allowQStashSelfQueue?: boolean },
): Promise<RunMediatorCatalogCloseResult> {
  const allowQStashSelfQueue = opts?.allowQStashSelfQueue !== false;
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const quote = body.quote === undefined ? "EUR" : body.quote;
  const marketOffset = Math.max(body.marketOffset ?? 0, 0);
  const marketBatchSizeVal = Math.min(Math.max(body.marketBatchSize ?? marketBatchSize(), 1), 120);
  const closeTimeIso = body.closeTimeIso;

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
  const effectiveTotal = maxTotal != null ? Math.min(total, maxTotal) : total;

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
  const rows = remainingBudget < rowsRaw.length ? rowsRaw.slice(0, remainingBudget) : rowsRaw;

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

  const rails = mediatorRailsFromEnv();
  const notionalSuggested = defaultNotionalEur();
  const t = Date.parse(closeTimeIso);
  const closeLow = Number.isFinite(t) ? new Date(t - 2000).toISOString() : closeTimeIso;
  const closeHigh = Number.isFinite(t) ? new Date(t + 2000).toISOString() : closeTimeIso;

  let decisionsUpserted = 0;

  for (const m of rows) {
    const marketId = m.id as string;
    const marketSymbol = m.market_symbol as string;

    for (const userId of userIds) {
      const { decisionPaperColumn } = await fetchUserUsesPaperBook(admin, userId);

      const { data: riskUser, error: riskUserErr } = await admin
        .schema("trading")
        .from("risk_state")
        .select("equity_eur, open_position_count, exposure_by_market, daily_pnl_eur, max_drawdown_eur, consecutive_losses, kill_switch")
        .eq("user_id", userId)
        .maybeSingle();

      if (riskUserErr) throw new Error(riskUserErr.message);
      const riskSnap = buildRiskSnapshot(riskUser ?? {}, marketId, marketSymbol);

      const { data: posRow, error: posErr } = await admin
        .schema("trading")
        .from("positions")
        .select("quantity")
        .eq("user_id", userId)
        .eq("market_id", marketId)
        .eq("paper", decisionPaperColumn)
        .maybeSingle();

      if (posErr) throw new Error(posErr.message);
      const inPosition = Number(posRow?.quantity ?? 0) > 0;

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
        market_id: marketId,
        close_time: canonicalClose,
        timeframe,
        paper: decisionPaperColumn,
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
          executionModeSnapshot: decisionPaperColumn ? "paper" : "live",
          ...(body.candleSyncRunId ? { candleSyncRunId: body.candleSyncRunId } : {}),
        },
      };

      const { error: upErr } = await admin.schema("trading").from("trade_decisions").upsert(decisionRow, {
        onConflict: "user_id,market_id,timeframe,close_time",
      });
      if (upErr) throw new Error(`${marketSymbol}: trade_decisions upsert: ${upErr.message}`);
      decisionsUpserted += 1;
    }
  }

  const nextOffset = marketOffset + rows.length;
  const nextMarketOffset = nextOffset < effectiveTotal ? nextOffset : null;

  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (nextMarketOffset != null && allowQStashSelfQueue && base && token) {
    const client = new Client({ token });
    await client.publishJSON({
      url: `${base}/api/workers/mediator-catalog-close`,
      body: {
        closeTimeIso,
        timeframe,
        quote,
        marketOffset: nextMarketOffset,
        marketBatchSize: marketBatchSizeVal,
        candleSyncRunId: body.candleSyncRunId ?? undefined,
      },
      retries: 3,
    });
  }

  if (
    nextMarketOffset == null &&
    rows.length > 0 &&
    decisionsUpserted > 0 &&
    process.env.EXECUTOR_AFTER_MEDIATOR_DISABLE !== "1" &&
    userIds.length > 0
  ) {
    try {
      await enqueueExecutorCatalogCloseAfterMediator({
        closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
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

/** Inline drain when QStash is not configured (localhost). */
export async function runMediatorCatalogCloseDrain(body: MediatorCatalogCloseBody): Promise<RunMediatorCatalogCloseResult> {
  let offset = body.marketOffset ?? 0;
  let totalDecisions = 0;
  let totalMarkets = 0;
  let last: RunMediatorCatalogCloseResult | null = null;
  const maxIters = Number(process.env.SIGNALS_CATALOG_CLOSE_INLINE_MAX_ITERS ?? 400);
  const cap = Math.min(Math.max(Math.floor(maxIters), 1), 2000);

  let marketsSum = 0;
  for (let i = 0; i < cap; i++) {
    last = await runMediatorCatalogClose({ ...body, marketOffset: offset }, { allowQStashSelfQueue: false });
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
