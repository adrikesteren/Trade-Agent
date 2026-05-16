import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as DecisionsSelector from "@/lib/selectors/decisions-selector";
import * as ExecutorMovingFloorsSelector from "@/lib/selectors/executor-moving-floors-selector";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import * as FillsSelector from "@/lib/selectors/fills-selector";
import * as OrdersSelector from "@/lib/selectors/orders-selector";
import * as PositionsSelector from "@/lib/selectors/positions-selector";

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
      const ordRows = await OrdersSelector.selectIdsByDecisionIds(admin, part);
      const orderIds = ordRows.map((r) => r.id).filter(Boolean);
      if (orderIds.length) {
        for (let j = 0; j < orderIds.length; j += chunk) {
          const orderPart = orderIds.slice(j, j + chunk);
          await FillsSelector.deleteByOrderIds(admin, orderPart);
          await OrdersSelector.deleteByIds(admin, orderPart);
        }
      }
      await DecisionsSelector.deleteByIds(admin, part);
    }
  }

  await PositionsSelector.deleteByTrio(admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
  });

  await ExecutorMovingFloorsSelector.deleteByTrio(admin, {
    userId: args.userId,
    executorId: args.executorId,
    marketId: args.marketId,
  });

  await ExecutorsSelector.updateRiskStateResetByUserAndId(admin, {
    userId: args.userId,
    executorId: args.executorId,
  });
}
