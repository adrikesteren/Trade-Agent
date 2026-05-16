import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as ExecutorsSelector from "@/lib/selectors/executors-selector";

/**
 * Returns the wallet that an executor's transactions should land in.
 *
 * After P1/M2 this is just `executors.wallet_id` for both kinds (the DB trigger sets it
 * on insert and migration M2 backfilled all existing rows). The legacy fallback that
 * looked up `trading.wallets.executor_id` is kept as a defensive net for any executor
 * row that briefly lacks a `wallet_id` (e.g. raced-with-trigger).
 */
export async function resolveExecutorWalletId(
  admin: SupabaseClient,
  args: { executorId: string },
): Promise<string | null> {
  const executorId = String(args.executorId ?? "").trim();
  if (!executorId) return null;

  const walletIdRaw = await ExecutorsSelector.selectWalletIdById(admin, executorId);
  const direct = String(walletIdRaw ?? "").trim();
  if (direct) return direct;

  // Defensive fallback: shared wallets have wallet.executor_id = null, so this only ever
  // matches isolated historical_paper wallets that briefly lost their pointer.
  const { data: w, error: wErr } = await admin
    .schema("trading")
    .from("wallets")
    .select("id")
    .eq("executor_id", executorId)
    .maybeSingle();
  if (wErr) throw new Error(wErr.message);
  const fallback = String((w as { id?: string } | null)?.id ?? "").trim();
  return fallback || null;
}
