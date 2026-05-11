import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { executorAllowsMarketAsset, type ExecutionMode, type ExecutorAssetFilterMode } from "./executor-rules";

export type { ExecutionMode, ExecutorAssetFilterMode };
export { executorAllowsMarketAsset };

export type ExecutorRow = {
  id: string;
  user_id: string;
  exchange_id: string;
  name: string;
  enabled: boolean;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  created_at?: string;
  updated_at?: string;
  default_notional_eur: string | number;
  max_risk_per_trade: string | number;
  max_open_positions: string | number;
  max_exposure_per_symbol_eur: string | number;
  daily_loss_limit_eur: string | number;
  max_drawdown_eur: string | number;
  cooldown_after_losses: string | number;
  allow_add: boolean;
  mediator_rails_extra: Record<string, unknown> | null;
  profit_taking_enabled: boolean;
  moving_floor_trail_pct: string | number;
  moving_floor_activation_profit_pct: string | number;
  moving_floor_timeframe: string;
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
    .select(
      "id, user_id, exchange_id, name, enabled, execution_mode, asset_filter_mode, filter_asset_ids, created_at, updated_at, default_notional_eur, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe",
    )
    .in("user_id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorRow[];
}

export async function fetchExchangeIdByCode(admin: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await admin
    .schema("catalog")
    .from("exchanges")
    .select("id")
    .eq("code", code)
    .single();
  if (error || !data?.id) throw new Error(`${code} exchange not found`);
  return data.id as string;
}

/** Idempotent: one `risk_state` row per executor (paper defaults). */
export async function ensureRiskStateForExecutor(
  admin: SupabaseClient,
  args: { userId: string; executorId: string },
): Promise<void> {
  const { data: existing, error: selErr } = await admin
    .schema("trading")
    .from("risk_state")
    .select("id")
    .eq("executor_id", args.executorId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return;

  const { error } = await admin.schema("trading").from("risk_state").insert({
    user_id: args.userId,
    executor_id: args.executorId,
    equity_eur: 0,
    open_position_count: 0,
    exposure_by_market: {},
    daily_pnl_eur: 0,
    max_drawdown_eur: 0,
    kill_switch: false,
    consecutive_losses: 0,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`ensureRiskStateForExecutor: ${error.message}`);
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

  const bitvavoExchangeId = await fetchExchangeIdByCode(admin, "bitvavo");

  const rows = missing.map((user_id) => ({
    user_id,
    exchange_id: bitvavoExchangeId,
    name: "Default",
    enabled: true,
    execution_mode: "paper" as const,
    asset_filter_mode: "all" as const,
    filter_asset_ids: [] as string[],
    updated_at: new Date().toISOString(),
  }));

  const { data: inserted, error } = await admin.schema("trading").from("executors").insert(rows).select("id, user_id");
  if (error) throw new Error(`ensureDefaultExecutorsForUsers: ${error.message}`);
  for (const row of inserted ?? []) {
    await ensureRiskStateForExecutor(admin, { userId: row.user_id as string, executorId: row.id as string });
  }
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

export type EnsureUserExecutorExistsOptions = {
  /**
   * When the caller already ran a list query that returned no rows for this user,
   * skip the extra COUNT round trip and go straight to insert + risk_state.
   */
  verifiedEmptyExecutorList?: boolean;
};

/** Dashboard: ensure at least one row exists (RLS insert as authenticated user). */
export async function ensureUserExecutorExists(
  supabase: SupabaseClient,
  userId: string,
  options?: EnsureUserExecutorExistsOptions,
): Promise<void> {
  if (!options?.verifiedEmptyExecutorList) {
    const { count, error } = await supabase
      .schema("trading")
      .from("executors")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return;
  }

  const { data: created, error: insErr } = await supabase
    .schema("trading")
    .from("executors")
    .insert({
      user_id: userId,
      name: "Default",
      enabled: true,
      execution_mode: "paper",
      exchange_id: await fetchExchangeIdByCode(supabase, "bitvavo"),
      asset_filter_mode: "all",
      filter_asset_ids: [],
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  await ensureRiskStateForExecutor(supabase, { userId, executorId: created?.id as string });
}
