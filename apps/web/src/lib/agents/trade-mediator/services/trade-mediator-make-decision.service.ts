import "server-only";

import type { SupabaseClient as _SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { runMediatorCatalogCloseDrain } from "./catalog-close-mediator-run.service";

export type TradeMediatorMakeDecisionArgs = {
  /** ISO bar close time the decision is for. */
  closeTimeIso: string;
  marketId: string;
  executorId: string;
  /** Defaults to {@link CATALOG_STORAGE_TIMEFRAME} (`15m`). */
  timeframe?: string;
  /**
   * `auth.users.id`s that own the `trading.signals` rows the mediator should read. For paper/live
   * runs this is typically the catalog pipeline users (automated_process); historical replay
   * passes `[automatedUserId]` so the signals written during replay are joined to the executor.
   */
  signalQueryUserIds: string[];
};

export type TradeMediatorMakeDecisionResult = {
  decisionsUpserted: number;
};

/**
 * Adapter-agnostic Trade Mediator entry point for one (market, executor, close) tuple.
 * Thin wrapper that delegates to {@link runMediatorCatalogCloseDrain} scoped to a single
 * market + executor. All mediator logic — regime gating, SAR, ATR-gates, quote-asset budgets,
 * scale-in on enter, moving-floor exits — stays in the existing service; this entry point
 * exists so the new `CloseCandlePipelineService` orchestrator does not have to know about the
 * legacy "drain" iteration pattern.
 *
 * `disableDownstreamEnqueue: true` — the orchestrator schedules the executor step itself.
 * The historical replay scale-in flag is `false` here; callers that need it should run the
 * legacy `runHistoricalExecutorReplay` until the orchestrator covers that branch.
 */
export async function runTradeMediatorMakeDecision(
  admin: _SupabaseClient,
  args: TradeMediatorMakeDecisionArgs,
): Promise<TradeMediatorMakeDecisionResult> {
  const timeframe = args.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  // admin is intentionally unused: runMediatorCatalogCloseDrain re-creates its own
  // service-role client. Accepting it keeps the wrapper signature consistent with the
  // other domain services (ingest, signal, executor) and the orchestrator caller-style.
  void admin;
  const res = await runMediatorCatalogCloseDrain({
    closeTimeIso: args.closeTimeIso,
    timeframe,
    onlyMarketId: args.marketId,
    onlyExecutorId: args.executorId,
    signalQueryUserIds: args.signalQueryUserIds,
    disableDownstreamEnqueue: true,
  });
  return { decisionsUpserted: res.decisionsUpserted };
}
