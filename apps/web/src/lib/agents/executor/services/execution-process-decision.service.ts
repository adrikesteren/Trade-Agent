import "server-only";

import type { SupabaseClient as _SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { runExecutorCatalogCloseDrain } from "./catalog-close-executor-run.service";

export type ExecutionProcessDecisionArgs = {
  /** ISO bar close time the decision belongs to. */
  closeTimeIso: string;
  marketId: string;
  executorId: string;
  /** Defaults to {@link CATALOG_STORAGE_TIMEFRAME} (`15m`). */
  timeframe?: string;
};

export type ExecutionProcessDecisionResult = {
  ordersInserted: number;
};

/**
 * Adapter-agnostic Executor entry point for one (market, executor, close) tuple.
 * Thin wrapper that delegates to {@link runExecutorCatalogCloseDrain} scoped to a single
 * market + executor. Paper/live/historical routing, fill bookkeeping, Bitvavo order placement
 * and Slack notifications stay in the existing service. The Bitvavo direct imports in
 * `catalog-close-executor-run.service` will be migrated to the {@link IExchangeAdapter}
 * registry in a later Plan 2 step.
 *
 * `disableDownstreamEnqueue: true` — orchestrators decide their own scheduling.
 */
export async function runExecutionProcessDecision(
  admin: _SupabaseClient,
  args: ExecutionProcessDecisionArgs,
): Promise<ExecutionProcessDecisionResult> {
  const timeframe = args.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  // admin is intentionally unused: runExecutorCatalogCloseDrain re-creates its own
  // service-role client. Accepting it keeps the wrapper signature consistent with the
  // other domain services and the orchestrator caller-style.
  void admin;
  const res = await runExecutorCatalogCloseDrain({
    closeTimeIso: args.closeTimeIso,
    timeframe,
    onlyMarketId: args.marketId,
    onlyExecutorId: args.executorId,
    disableDownstreamEnqueue: true,
  });
  return { ordersInserted: res.ordersInserted };
}
