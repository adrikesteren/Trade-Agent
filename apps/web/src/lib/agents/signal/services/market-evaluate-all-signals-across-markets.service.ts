import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

import {
  runMarketEvaluateAllSignals,
  type RunMarketEvaluateAllSignalsResult,
  MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS,
} from "./market-evaluate-all-signals.service";

/** Soft overall wall-clock budget for the across-markets loop (ms). 9 min keeps us under Relay's 10 min cap. */
export const MARKET_EVALUATE_ALL_SIGNALS_ACROSS_MARKETS_BUDGET_MS = 9 * 60 * 1000;

/** Per-market budget when the caller doesn't override it. Tighter than the single-market default because we expect to fan out across many markets in one outer call. */
export const MARKET_EVALUATE_ALL_SIGNALS_PER_MARKET_BUDGET_MS = 60 * 1000;

export type RunMarketEvaluateAllSignalsAcrossMarketsArgs = {
  /** Slugs whose existing signals should be overwritten instead of skipped. */
  forceAgentSlugs?: readonly string[];
  /** Wall-clock budget per market (ms). Defaults to {@link MARKET_EVALUATE_ALL_SIGNALS_PER_MARKET_BUDGET_MS}. */
  perMarketBudgetMs?: number;
  /** Wall-clock budget for the whole loop (ms). Defaults to {@link MARKET_EVALUATE_ALL_SIGNALS_ACROSS_MARKETS_BUDGET_MS}. */
  overallBudgetMs?: number;
  /** Optional whitelist; defaults to "all `catalog.markets` that have at least one candle row". */
  onlyMarketIds?: readonly string[];
};

export type RunMarketEvaluateAllSignalsAcrossMarketsResult = {
  ok: true;
  marketsConsidered: number;
  marketsProcessed: number;
  marketsFailed: number;
  marketsRemaining: number;
  signalsUpsertedTotal: number;
  barsProcessedTotal: number;
  /** True when the outer loop stopped because the overall wall-clock budget was reached. */
  deadlineHit: boolean;
  /** First N failures (capped) so the response stays small. */
  failures: { marketId: string; marketSymbol: string | null; error: string }[];
  /** Per-market summaries (cap to keep the response small for many markets). */
  perMarket: Pick<
    RunMarketEvaluateAllSignalsResult,
    "marketId" | "marketSymbol" | "barsProcessed" | "signalsUpserted" | "deadlineHit"
  >[];
};

const FAILURE_CAP = 25;
const PER_MARKET_SUMMARY_CAP = 200;

/**
 * Lists every `catalog.markets` row that has at least one candle in
 * `catalog.candles` for the storage timeframe. Returned in deterministic
 * `market_symbol` order so successive runs are reproducible.
 */
async function listMarketIdsWithCandles(admin: SupabaseClient): Promise<{ id: string; symbol: string }[]> {
  // Markets first — small table.
  const { data: marketRows, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .order("market_symbol", { ascending: true });
  if (mErr) throw new Error(mErr.message);
  const allMarkets = (marketRows ?? []) as { id: string; market_symbol: string }[];
  if (allMarkets.length === 0) return [];

  // Filter to those with at least one candle. Page through ids to keep PostgREST
  // filter URLs small (URI TOO LONG with thousands of ids).
  const present = new Set<string>();
  const chunk = 80;
  for (let i = 0; i < allMarkets.length; i += chunk) {
    const part = allMarkets.slice(i, i + chunk).map((m) => m.id);
    const { data, error } = await admin
      .schema("catalog")
      .from("candles")
      .select("market_id")
      .in("market_id", part)
      .limit(part.length);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { market_id: string }[]) {
      if (r.market_id) present.add(r.market_id);
    }
  }
  return allMarkets.filter((m) => present.has(m.id)).map((m) => ({ id: m.id, symbol: m.market_symbol }));
}

/**
 * Re-evaluate signals across **every market with at least one stored candle**.
 *
 * Designed for one-off batch operations after an agent's seed config changes
 * (e.g. regime classifier moving from `4h × SMA(200)` to `1h × SMA(100)`):
 * pass `forceAgentSlugs: ['regime-classifier-15m-v1']` and the per-market
 * `(signal_agent_id, candle_id, user_id)` upsert overwrites the stale rows in
 * place. The signal id is preserved so downstream FK references in
 * `trading.decisions` / `trading.orders` keep pointing at the same row.
 *
 * Budgeting is two-tier:
 * - **Per-market budget** caps how long a single market can spend.
 * - **Overall budget** caps the whole loop so the caller (HTTP / worker) can
 *   return cleanly. When hit, `deadlineHit: true` and `marketsRemaining > 0`;
 *   re-invoking the same call resumes from the next market because per-market
 *   `runMarketEvaluateAllSignals` is skip-existing (the just-rewritten rows
 *   are now "covered" and won't be re-evaluated unless `forceAgentSlugs`
 *   names them again).
 */
export async function runMarketEvaluateAllSignalsAcrossMarkets(
  admin: SupabaseClient,
  args: RunMarketEvaluateAllSignalsAcrossMarketsArgs = {},
): Promise<RunMarketEvaluateAllSignalsAcrossMarketsResult> {
  const overallBudgetMs = args.overallBudgetMs ?? MARKET_EVALUATE_ALL_SIGNALS_ACROSS_MARKETS_BUDGET_MS;
  const perMarketBudgetMs = Math.min(
    args.perMarketBudgetMs ?? MARKET_EVALUATE_ALL_SIGNALS_PER_MARKET_BUDGET_MS,
    MARKET_EVALUATE_ALL_SIGNALS_BUDGET_MS,
  );
  const forceAgentSlugs = args.forceAgentSlugs ?? [];

  const allMarkets = args.onlyMarketIds && args.onlyMarketIds.length > 0
    ? (await listMarketIdsWithCandles(admin)).filter((m) => args.onlyMarketIds!.includes(m.id))
    : await listMarketIdsWithCandles(admin);

  const startedMs = Date.now();
  let marketsProcessed = 0;
  let marketsFailed = 0;
  let signalsUpsertedTotal = 0;
  let barsProcessedTotal = 0;
  let deadlineHit = false;
  const failures: { marketId: string; marketSymbol: string | null; error: string }[] = [];
  const perMarket: RunMarketEvaluateAllSignalsAcrossMarketsResult["perMarket"] = [];

  for (let i = 0; i < allMarkets.length; i += 1) {
    if (Date.now() - startedMs > overallBudgetMs) {
      deadlineHit = true;
      break;
    }
    const m = allMarkets[i]!;
    try {
      const r = await runMarketEvaluateAllSignals(admin, {
        marketId: m.id,
        budgetMs: perMarketBudgetMs,
        ...(forceAgentSlugs.length > 0 ? { forceAgentSlugs } : {}),
      });
      marketsProcessed += 1;
      signalsUpsertedTotal += r.signalsUpserted;
      barsProcessedTotal += r.barsProcessed;
      if (perMarket.length < PER_MARKET_SUMMARY_CAP) {
        perMarket.push({
          marketId: r.marketId,
          marketSymbol: r.marketSymbol,
          barsProcessed: r.barsProcessed,
          signalsUpserted: r.signalsUpserted,
          deadlineHit: r.deadlineHit,
        });
      }
    } catch (e) {
      marketsFailed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (failures.length < FAILURE_CAP) {
        failures.push({ marketId: m.id, marketSymbol: m.symbol ?? null, error: msg });
      }
      // Note (intentional): swallow per-market errors so one bad market doesn't
      // abort the whole batch. Failures are still surfaced via the response.
    }
  }

  const marketsRemaining = Math.max(0, allMarkets.length - marketsProcessed - marketsFailed);

  return {
    ok: true,
    marketsConsidered: allMarkets.length,
    marketsProcessed,
    marketsFailed,
    marketsRemaining,
    signalsUpsertedTotal,
    barsProcessedTotal,
    deadlineHit,
    failures,
    perMarket,
  };
}

/** Re-export so worker routes can declare imports from a single file. */
export { CATALOG_STORAGE_TIMEFRAME };
