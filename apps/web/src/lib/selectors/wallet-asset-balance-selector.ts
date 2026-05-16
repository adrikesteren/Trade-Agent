import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rows from `trading.wallet_asset_balance` — system-maintained per-(wallet, asset) running
 * balance. Kept in sync by the `trg_wallet_transactions_touch_wallet_asset_balance` trigger
 * on each `wallet_transactions` insert; UI sites are therefore read-only.
 */

/** Listing projection used by the executor detail and the view-all related page. */
export type WalletAssetBalanceListRow = {
  id: string;
  asset_id: string;
  amount: string | number | null;
  updated_at: string;
};

/** Narrow amount-only projection — wallet+asset spendable-units lookup. */
export type WalletAssetBalanceAmountRow = {
  amount: string | number | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("amount") .eq("wallet_id", walletId) .eq("asset_id", assetId) .maybeSingle()`
 * — narrow lookup used by `fetchWalletBalanceForAsset` to read spendable units.
 */
export async function selectAmountByWalletAndAsset(
  client: SupabaseClient,
  args: { walletId: string; assetId: string },
): Promise<WalletAssetBalanceAmountRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("wallet_asset_balance")
    .select("amount")
    .eq("wallet_id", args.walletId)
    .eq("asset_id", args.assetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WalletAssetBalanceAmountRow | null) ?? null;
}

/**
 * `select("id, asset_id, amount, updated_at") .eq("wallet_id", walletId) .order(updated_at desc)`
 * — full per-wallet listing for the view-all related page.
 */
export async function selectListByWallet(
  client: SupabaseClient,
  walletId: string,
): Promise<WalletAssetBalanceListRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("wallet_asset_balance")
    .select("id, asset_id, amount, updated_at")
    .eq("wallet_id", walletId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WalletAssetBalanceListRow[];
}

/**
 * `select("id, asset_id, amount, updated_at", { count: "exact" }) .eq("wallet_id", walletId)
 *   .order(updated_at desc) .limit(N)` — executor detail page preview pack. Returns
 * `{ data, count, error }` so callers can destructure like the inline pack call it replaces.
 */
export async function selectListByWalletWithCount(
  client: SupabaseClient,
  args: { walletId: string; limit: number },
): Promise<{
  data: WalletAssetBalanceListRow[] | null;
  count: number | null;
  error: { message: string } | null;
}> {
  const { data, count, error } = await client
    .schema("trading")
    .from("wallet_asset_balance")
    .select("id, asset_id, amount, updated_at", { count: "exact" })
    .eq("wallet_id", args.walletId)
    .order("updated_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as WalletAssetBalanceListRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `insert(row)` — direct insert. UI flows credit balances via `wallet_transactions` and
 * rely on the DB trigger to materialize this table; this helper exists for service/admin
 * paths that need to seed a row explicitly.
 */
export async function insertOne(
  client: SupabaseClient,
  row: { wallet_id: string; asset_id: string; amount: number | string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("wallet_asset_balance")
    .insert(row);
  if (error) throw new Error(error.message);
}

/**
 * `upsert(row, { onConflict: "wallet_id,asset_id" })` — idempotent set-amount helper
 * matching the table's `(wallet_id, asset_id)` unique constraint. Same caveat as
 * {@link insertOne} regarding the normal trigger-driven path.
 */
export async function upsertOneByWalletAsset(
  client: SupabaseClient,
  row: { wallet_id: string; asset_id: string; amount: number | string; updated_at?: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("wallet_asset_balance")
    .upsert(row, { onConflict: "wallet_id,asset_id" });
  if (error) throw new Error(error.message);
}
