import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Narrow id-only projection — used when callers only need the wallet id. */
export type WalletIdRow = { id: string };

/** Wallet detail-page projection — `wallets/[id]/page.tsx`. */
export type WalletDetailRow = {
  id: string;
  executor_id: string | null;
  created_at: string;
};

/**
 * `select("id") .eq("executor_id", executorId) .maybeSingle()` — defensive fallback
 * used by `resolveExecutorWalletId`, the executor detail page, and the wallet-asset-balance
 * page when `executors.wallet_id` is briefly empty (raced with the insert trigger).
 */
export async function selectIdByExecutorId(
  client: SupabaseClient,
  executorId: string,
): Promise<string | null> {
  const { data, error } = await client
    .schema("trading")
    .from("wallets")
    .select("id")
    .eq("executor_id", executorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WalletIdRow | null)?.id ?? null;
}

/** `select("id, executor_id, created_at") .eq("id", id) .maybeSingle()` — wallet detail page. */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<WalletDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("wallets")
    .select("id, executor_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WalletDetailRow | null) ?? null;
}
