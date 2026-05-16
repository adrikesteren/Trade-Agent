import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as DecisionsSelector from "@/lib/selectors/decisions-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";

/**
 * Clears simulated trading state for a historical replay on one market, without touching the balance ledger.
 * Caller should pass the same close-time bounds used for the replay window.
 */
export async function wipeHistoricalExecutorSimulationState(
  admin: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    closeTimeGte: string;
    closeTimeLte: string;
  },
): Promise<void> {
  const decs = await DecisionsSelector.selectIdsForHistoricalWipe(admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
    closeTimeGte: args.closeTimeGte,
    closeTimeLte: args.closeTimeLte,
  });
  const decisionIds = decs.map((r) => r.id).filter(Boolean);
  if (decisionIds.length) {
    /** Keep PostgREST filter URLs under typical reverse-proxy limits (avoid `URI TOO LONG`). */
    const chunk = 80;
    for (let i = 0; i < decisionIds.length; i += chunk) {
      const part = decisionIds.slice(i, i + chunk);
      const { data: ordRows, error: oSelErr } = await admin
        .schema("trading")
        .from("orders")
        .select("id")
        .in("decision_id", part);
      if (oSelErr) throw new Error(oSelErr.message);
      const orderIds = (ordRows ?? []).map((r) => r.id as string).filter(Boolean);
      if (orderIds.length) {
        for (let j = 0; j < orderIds.length; j += chunk) {
          const orderPart = orderIds.slice(j, j + chunk);
          const { error: fDel } = await admin.schema("trading").from("fills").delete().in("order_id", orderPart);
          if (fDel) throw new Error(fDel.message);
          const { error: oDel } = await admin.schema("trading").from("orders").delete().in("id", orderPart);
          if (oDel) throw new Error(oDel.message);
        }
      }
      await DecisionsSelector.deleteByIds(admin, part);
    }
  }

  const { error: posDel } = await admin
    .schema("trading")
    .from("positions")
    .delete()
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (posDel) throw new Error(posDel.message);

  const { error: flDel } = await admin
    .schema("trading")
    .from("executor_moving_floors")
    .delete()
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (flDel) throw new Error(flDel.message);

  await ExecutorsSelector.updateRiskStateResetByUserAndId(admin, {
    userId: args.userId,
    executorId: args.executorId,
  });
}
