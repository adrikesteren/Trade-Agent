import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { executorAllowsMarketAsset, type ExecutionMode, type ExecutorAssetFilterMode } from "./executor-rules";

export type { ExecutionMode, ExecutorAssetFilterMode };
export { executorAllowsMarketAsset };

export type ExecutorRow = {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  execution_mode: ExecutionMode;
  budget_eur: string | number | null;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  created_at?: string;
  updated_at?: string;
};

/** Prefer "Default" by name, then oldest created. */
export function sortExecutorsForDefaultPick(rows: ExecutorRow[]): ExecutorRow[] {
  return [...rows].sort((a, b) => {
    const da = a.name.trim().toLowerCase() === "default" ? 0 : 1;
    const db = b.name.trim().toLowerCase() === "default" ? 0 : 1;
    if (da !== db) return da - db;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

export async function fetchExecutorsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<ExecutorRow[]> {
  if (!userIds.length) return [];
  const { data, error } = await admin
    .schema("trading")
    .from("executors")
    .select("id, user_id, name, enabled, execution_mode, budget_eur, asset_filter_mode, filter_asset_ids, created_at, updated_at")
    .in("user_id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorRow[];
}

export async function ensureDefaultExecutorsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<void> {
  if (!userIds.length) return;
  const existing = await fetchExecutorsForUsers(admin, userIds);
  const has = new Set(existing.map((e) => e.user_id));
  const missing = userIds.filter((id) => !has.has(id));
  if (!missing.length) return;

  const rows = missing.map((user_id) => ({
    user_id,
    name: "Default",
    enabled: true,
    execution_mode: "paper" as const,
    budget_eur: null as number | null,
    asset_filter_mode: "all" as const,
    filter_asset_ids: [] as string[],
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin.schema("trading").from("executors").insert(rows);
  if (error) throw new Error(`ensureDefaultExecutorsForUsers: ${error.message}`);
}

/** Sum `notional_eur` for filled orders per executor (spot v1 budget cap). */
export async function fetchFilledNotionalSumByExecutorIds(
  admin: SupabaseClient,
  executorIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (!executorIds.length) return sums;
  const { data, error } = await admin
    .schema("trading")
    .from("orders")
    .select("executor_id, notional_eur")
    .eq("status", "filled")
    .in("executor_id", executorIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const id = row.executor_id as string;
    const n = Number(row.notional_eur ?? 0);
    if (!Number.isFinite(n)) continue;
    sums.set(id, (sums.get(id) ?? 0) + n);
  }
  return sums;
}

export async function fetchMarketAssetIds(
  admin: SupabaseClient,
  marketIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!marketIds.length) return map;
  const chunk = 200;
  for (let i = 0; i < marketIds.length; i += chunk) {
    const part = marketIds.slice(i, i + chunk);
    const { data, error } = await admin.schema("catalog").from("markets").select("id, asset_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      map.set(r.id as string, (r.asset_id as string | null) ?? null);
    }
  }
  return map;
}

/** Dashboard: ensure at least one row exists (RLS insert as authenticated user). */
export async function ensureUserExecutorExists(supabase: SupabaseClient, userId: string): Promise<void> {
  const { count, error } = await supabase
    .schema("trading")
    .from("executors")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return;

  const { error: insErr } = await supabase.schema("trading").from("executors").insert({
    user_id: userId,
    name: "Default",
    enabled: true,
    execution_mode: "paper",
    budget_eur: null,
    asset_filter_mode: "all",
    filter_asset_ids: [],
    updated_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(insErr.message);
}
