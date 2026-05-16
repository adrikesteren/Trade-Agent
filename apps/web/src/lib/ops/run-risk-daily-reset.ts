import "server-only";

import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type RunRiskDailyResetResult = {
  ok: true;
  rowsUpdated: number;
};

/** Reset `risk_daily_pnl_eur` on all executors (intended once per UTC day via scheduled worker). */
export async function runRiskDailyReset(): Promise<RunRiskDailyResetResult> {
  const admin = createServiceRoleClient();
  const count = await ExecutorsSelector.countAll(admin);
  await ExecutorsSelector.updateRiskDailyPnlResetForAll(admin);
  return { ok: true, rowsUpdated: count };
}
