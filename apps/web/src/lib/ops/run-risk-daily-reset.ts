import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/admin";

export type RunRiskDailyResetResult = {
  ok: true;
  rowsUpdated: number;
};

/** Reset `daily_pnl_eur` for all users (intended once per UTC day via QStash). Kill switch and other fields unchanged. */
export async function runRiskDailyReset(): Promise<RunRiskDailyResetResult> {
  const admin = createServiceRoleClient();
  const { count, error: cErr } = await admin
    .schema("trading")
    .from("risk_state")
    .select("*", { count: "exact", head: true });
  if (cErr) throw new Error(cErr.message);

  const now = new Date().toISOString();
  const { error } = await admin
    .schema("trading")
    .from("risk_state")
    .update({ daily_pnl_eur: 0, updated_at: now })
    .not("user_id", "is", null);
  if (error) throw new Error(error.message);

  return { ok: true, rowsUpdated: count ?? 0 };
}
