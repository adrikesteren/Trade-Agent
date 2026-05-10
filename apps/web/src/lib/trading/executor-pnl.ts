import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

export type ExecutorPnlSnapshot = {
  filledBuyNotionalEur: number;
  openCostBasisEur: number;
  openMarkValueEur: number | null;
  unrealizedEur: number | null;
};

function num(v: unknown): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Spot v1: buy notional filled, open cost basis, optional mark/unrealized from latest catalog closes. */
export async function loadExecutorPnlSnapshot(
  admin: SupabaseClient,
  params: { executorId: string; userId: string; timeframe?: string },
): Promise<ExecutorPnlSnapshot> {
  const timeframe = params.timeframe ?? CATALOG_STORAGE_TIMEFRAME;

  const { data, error } = await admin.schema("trading").rpc("executor_dashboard_pnl_snapshot", {
    p_executor_id: params.executorId,
    p_user_id: params.userId,
    p_catalog_timeframe: timeframe,
  });

  if (error) {
    throw new Error(error.message);
  }

  const raw = data as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("executor_dashboard_pnl_snapshot returned empty payload");
  }

  return {
    filledBuyNotionalEur: num(raw.filled_buy_notional_eur),
    openCostBasisEur: num(raw.open_cost_basis_eur),
    openMarkValueEur: raw.open_mark_value_eur == null ? null : num(raw.open_mark_value_eur),
    unrealizedEur: raw.unrealized_eur == null ? null : num(raw.unrealized_eur),
  };
}
