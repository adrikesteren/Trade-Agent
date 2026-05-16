import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type WalletTransactionLedgerRow = {
  id: string;
  kind: string;
  quantity: string | number | null;
  asset_id: string;
  note: string | null;
  created_at: string;
};

/**
 * `select("id, kind, quantity, asset_id, note, created_at", { count: "exact" })
 *   .eq("wallet_id", id) .order(created_at desc) .limit(N)` — executor detail page ledger pack.
 * Returns `{ data, count, error }` so callers can destructure like the inline pack call it replaces.
 */
export async function selectByWalletIdRecentWithCount(
  client: SupabaseClient,
  args: { walletId: string; limit: number },
): Promise<{
  data: WalletTransactionLedgerRow[] | null;
  count: number | null;
  error: { message: string } | null;
}> {
  const { data, count, error } = await client
    .schema("trading")
    .from("wallet_transactions")
    .select("id, kind, quantity, asset_id, note, created_at", { count: "exact" })
    .eq("wallet_id", args.walletId)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as WalletTransactionLedgerRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}
