import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Execution mode discriminator (mirror of `trading.executors.execution_mode`). */
export type ExecutionMode = "paper" | "live" | "historical" | string;

/** Asset-filter mode discriminator (mirror of `trading.executors.asset_filter_mode`). */
export type ExecutorAssetFilterMode = "all" | "whitelist" | "blacklist" | string;

/** Position side for `allowed_sides`. */
export type ExecutorPositionSide = "long" | "short";

/** Minimal id+name projection — list/dropdown rendering. */
export type ExecutorIdNameRow = { id: string; name: string | null };

/** Minimal name-only projection (linked from related-record headers). */
export type ExecutorNameRow = { name: string | null };

/** Narrow wallet-id projection. */
export type ExecutorWalletIdRow = { wallet_id: string | null };

/** Executors list-page projection. */
export type ExecutorListRow = {
  id: string;
  name: string;
  enabled: boolean;
  exchange_id: string;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
};

/** Risk-state page projection. */
export type ExecutorRiskStateRow = {
  id: string;
  user_id: string;
  name: string | null;
  updated_at: string | null;
  risk_open_position_count: number | null;
  risk_exposure_by_market: Record<string, unknown> | null;
  risk_daily_pnl_eur: string | number | null;
  risk_runtime_max_drawdown_eur: string | number | null;
  risk_kill_switch: boolean | null;
  risk_consecutive_losses: number | null;
};

/** Detail-page projection — `[id]/page.tsx` (does not include `user_id`). */
export type ExecutorDetailRow = {
  id: string;
  wallet_id: string | null;
  name: string;
  enabled: boolean;
  exchange_id: string;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  allowed_sides: ExecutorPositionSide[] | null;
  updated_at: string | null;
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
  slack_trade_notifications_enabled: boolean;
  exchange_api_key: string;
  exchange_api_secret: string;
  historical_start_date: string | null;
  historical_end_date: string | null;
  risk_open_position_count: number | null;
  risk_exposure_by_market: Record<string, unknown> | null;
  risk_daily_pnl_eur: string | number | null;
  risk_runtime_max_drawdown_eur: string | number | null;
  risk_kill_switch: boolean | null;
  risk_consecutive_losses: number | null;
};

/** Clone-source projection — `new/page.tsx` (no risk_* and no wallet_id). */
export type ExecutorCloneRow = {
  id: string;
  name: string;
  enabled: boolean;
  exchange_id: string;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  allowed_sides: ExecutorPositionSide[] | null;
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
  slack_trade_notifications_enabled: boolean;
  exchange_api_key: string;
  exchange_api_secret: string;
  historical_start_date: string | null;
  historical_end_date: string | null;
};

/** Bitvavo-reconcile projection — id + name + exchange + execution_mode + notify + creds. */
export type ExecutorReconcileRow = {
  id: string;
  name: string | null;
  exchange_id: string | null;
  execution_mode: ExecutionMode;
  slack_trade_notifications_enabled: boolean | null;
  exchange_api_key: string | null;
  exchange_api_secret: string | null;
};

/** Historical-replay source projection (no risk_* and no rails). */
export type ExecutorHistoricalReplayRow = {
  id: string;
  user_id: string;
  exchange_id: string;
  name: string;
  enabled: boolean;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  historical_start_date: string | null;
  historical_end_date: string | null;
};

/** Wallet-asset-balance page projection — id + wallet_id + name. */
export type ExecutorIdWalletNameRow = {
  id: string;
  wallet_id: string | null;
  name: string | null;
};

/** Quote-asset-budgets page projection — id + name + exchange. */
export type ExecutorIdNameExchangeRow = {
  id: string;
  name: string | null;
  exchange_id: string | null;
};

/** Edit-action API-key projection. */
export type ExecutorApiKeySecretRow = {
  exchange_api_key: string | null;
  exchange_api_secret: string | null;
};

/**
 * Wide SELECT used by `executors-lookup.service` (mediator/executor runtime ExecutorRow).
 * Kept here so the SELECT-string and the row-type stay in sync.
 */
export type ExecutorFullRow = {
  id: string;
  user_id: string;
  exchange_id: string;
  name: string;
  enabled: boolean;
  execution_mode: ExecutionMode;
  asset_filter_mode: ExecutorAssetFilterMode;
  filter_asset_ids: string[] | null;
  allowed_sides?: ExecutorPositionSide[] | null;
  created_at?: string;
  updated_at?: string;
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
  slack_trade_notifications_enabled: boolean;
  exchange_api_key: string;
  exchange_api_secret: string;
  historical_start_date?: string | null;
  historical_end_date?: string | null;
  risk_open_position_count?: number;
  risk_exposure_by_market?: Record<string, unknown> | null;
  risk_daily_pnl_eur?: string | number;
  risk_runtime_max_drawdown_eur?: string | number;
  risk_kill_switch?: boolean;
  risk_consecutive_losses?: number;
};

const EXECUTOR_FULL_FIELDS =
  "id, user_id, exchange_id, name, enabled, execution_mode, asset_filter_mode, filter_asset_ids, allowed_sides, created_at, updated_at, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret, historical_start_date, historical_end_date, risk_open_position_count, risk_exposure_by_market, risk_daily_pnl_eur, risk_runtime_max_drawdown_eur, risk_kill_switch, risk_consecutive_losses";

const EXECUTOR_DETAIL_FIELDS =
  "id, wallet_id, name, enabled, exchange_id, execution_mode, asset_filter_mode, filter_asset_ids, allowed_sides, updated_at, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret, historical_start_date, historical_end_date, risk_open_position_count, risk_exposure_by_market, risk_daily_pnl_eur, risk_runtime_max_drawdown_eur, risk_kill_switch, risk_consecutive_losses";

const EXECUTOR_CLONE_FIELDS =
  "id, name, enabled, exchange_id, execution_mode, asset_filter_mode, filter_asset_ids, allowed_sides, max_risk_per_trade, max_open_positions, max_exposure_per_symbol_eur, daily_loss_limit_eur, max_drawdown_eur, cooldown_after_losses, allow_add, mediator_rails_extra, profit_taking_enabled, moving_floor_trail_pct, moving_floor_activation_profit_pct, moving_floor_timeframe, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret, historical_start_date, historical_end_date";

const EXECUTOR_RISK_STATE_FIELDS =
  "id, user_id, name, updated_at, risk_open_position_count, risk_exposure_by_market, risk_daily_pnl_eur, risk_runtime_max_drawdown_eur, risk_kill_switch, risk_consecutive_losses";

const EXECUTOR_RECONCILE_FIELDS =
  "id, name, exchange_id, execution_mode, slack_trade_notifications_enabled, exchange_api_key, exchange_api_secret";

const EXECUTOR_HISTORICAL_REPLAY_FIELDS =
  "id, user_id, exchange_id, name, enabled, execution_mode, asset_filter_mode, filter_asset_ids, historical_start_date, historical_end_date";

const EXECUTOR_LIST_FIELDS = "id, name, enabled, exchange_id, execution_mode, asset_filter_mode";

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/** `select(EXECUTOR_FULL_FIELDS) .eq("id", id) .maybeSingle()` — runtime ExecutorRow lookup. */
export async function selectFullById(
  client: SupabaseClient,
  id: string,
): Promise<ExecutorFullRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_FULL_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorFullRow | null) ?? null;
}

/** `select(EXECUTOR_FULL_FIELDS) .in("user_id", userIds)` — runtime ExecutorRow bulk. */
export async function selectFullByUserIds(
  client: SupabaseClient,
  userIds: string[],
): Promise<ExecutorFullRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_FULL_FIELDS)
    .in("user_id", userIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorFullRow[];
}

/** `select(EXECUTOR_DETAIL_FIELDS) .eq("id", id) .eq("user_id", userId) .maybeSingle()` — `[id]/page.tsx`. */
export async function selectDetailByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_DETAIL_FIELDS)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorDetailRow | null) ?? null;
}

/** `select(EXECUTOR_CLONE_FIELDS) .eq("id", id) .eq("user_id", userId) .maybeSingle()` — clone source. */
export async function selectCloneByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorCloneRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_CLONE_FIELDS)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorCloneRow | null) ?? null;
}

/** `select("wallet_id") .eq("id", id) .maybeSingle()` — narrow wallet-id lookup. */
export async function selectWalletIdById(
  client: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("wallet_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorWalletIdRow | null)?.wallet_id ?? null;
}

/** `select("name") .eq("id", id) .maybeSingle()` — narrow name lookup. */
export async function selectNameById(
  client: SupabaseClient,
  id: string,
): Promise<string | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorNameRow | null)?.name ?? null;
}

/** `select("id, name") .eq("id", id) .maybeSingle()` — id+name lookup for related-record pages. */
export async function selectIdAndNameById(
  client: SupabaseClient,
  id: string,
): Promise<ExecutorIdNameRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorIdNameRow | null) ?? null;
}

/** `select("id, name") .in("id", ids)` — bulk name lookup for list views. */
export async function selectIdAndNameByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<ExecutorIdNameRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("id, name")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorIdNameRow[];
}

/** `select("id, name, exchange_id") .eq("id", id) .eq("user_id", userId) .maybeSingle()` — quote-asset-budgets page. */
export async function selectIdNameExchangeByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorIdNameExchangeRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("id, name, exchange_id")
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorIdNameExchangeRow | null) ?? null;
}

/** `select("id, wallet_id, name") .eq("id", id) .eq("user_id", userId) .maybeSingle()` — wallet-asset-balance page. */
export async function selectIdWalletNameByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorIdWalletNameRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("id, wallet_id, name")
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorIdWalletNameRow | null) ?? null;
}

/**
 * `select("exchange_api_key, exchange_api_secret") .eq("id", id) .eq("user_id", userId) .maybeSingle()`
 * — narrow lookup used by the edit action to preserve existing credentials.
 */
export async function selectApiCredentialsByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorApiKeySecretRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select("exchange_api_key, exchange_api_secret")
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorApiKeySecretRow | null) ?? null;
}

/** `select(EXECUTOR_LIST_FIELDS) .eq("user_id", userId) .order("created_at") .range(from, to)` — list page rows. */
export async function selectListPaginatedForUser(
  client: SupabaseClient,
  args: { userId: string; from: number; to: number },
): Promise<ExecutorListRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_LIST_FIELDS)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: true })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorListRow[];
}

/** `select("*", { count: "exact", head: true }) .eq("user_id", userId)` — list page total. */
export async function countForUser(client: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("executors")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `select("id", { count: "exact", head: true }) .eq("user_id", userId)` — used by ensureUserExecutorExists. */
export async function countIdsForUser(client: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("executors")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `select(EXECUTOR_RISK_STATE_FIELDS) .eq("user_id", userId) .order("updated_at") .range(from, to)` — risk-state list page. */
export async function selectRiskStatePaginatedForUser(
  client: SupabaseClient,
  args: { userId: string; from: number; to: number },
): Promise<ExecutorRiskStateRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_RISK_STATE_FIELDS)
    .eq("user_id", args.userId)
    .order("updated_at", { ascending: false })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorRiskStateRow[];
}

/** Filtered variant of {@link selectRiskStatePaginatedForUser} that restricts to a single executor id. */
export async function selectRiskStatePaginatedForUserAndId(
  client: SupabaseClient,
  args: { userId: string; id: string; from: number; to: number },
): Promise<ExecutorRiskStateRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_RISK_STATE_FIELDS)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .order("updated_at", { ascending: false })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorRiskStateRow[];
}

/** `count(*) head:true .eq("user_id", userId)` — risk-state list page total (no filter). */
export async function countRiskStateForUser(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("executors")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `count(*) head:true .eq("id", id) .eq("user_id", userId)` — risk-state list filtered total. */
export async function countRiskStateForUserAndId(
  client: SupabaseClient,
  args: { userId: string; id: string },
): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("executors")
    .select("*", { count: "exact", head: true })
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `count(*) head:true` — total row count across all executors (admin-only). */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("trading")
    .from("executors")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `select(EXECUTOR_RECONCILE_FIELDS) .in("id", ids)` — bitvavo reconcile bulk. */
export async function selectReconcileByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<ExecutorReconcileRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_RECONCILE_FIELDS)
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorReconcileRow[];
}

/** `select(EXECUTOR_HISTORICAL_REPLAY_FIELDS) .eq("id", id) .eq("user_id", userId) .maybeSingle()` — historical-replay source. */
export async function selectHistoricalReplayByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string },
): Promise<ExecutorHistoricalReplayRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .select(EXECUTOR_HISTORICAL_REPLAY_FIELDS)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorHistoricalReplayRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `insert(rows) .select("id, user_id")` — bulk default-executor seed. */
export async function insertManyReturningIdAndUserId(
  client: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<{ id: string; user_id: string }[]> {
  if (rows.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .insert(rows)
    .select("id, user_id");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; user_id: string }[];
}

/** `insert(row) .select("id") .single()` — single insert returning id. */
export async function insertReturningId(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client
    .schema("trading")
    .from("executors")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("executors insert returned no id");
  return id;
}

/** `update(patch) .eq("id", id) .eq("user_id", userId)` — owner-scoped update. */
export async function updateByIdAndUser(
  client: SupabaseClient,
  args: { id: string; userId: string; patch: Record<string, unknown> },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executors")
    .update(args.patch)
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw new Error(error.message);
}

/**
 * `update({ risk_*: 0, kill_switch:false, updated_at }) .eq("user_id", userId) .eq("id", executorId)`
 * — used by the historical-simulation wipe (note: filters by user_id + id, matching the original).
 */
export async function updateRiskStateResetByUserAndId(
  client: SupabaseClient,
  args: { userId: string; executorId: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executors")
    .update({
      risk_open_position_count: 0,
      risk_exposure_by_market: {},
      risk_daily_pnl_eur: 0,
      risk_runtime_max_drawdown_eur: 0,
      risk_consecutive_losses: 0,
      risk_kill_switch: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("id", args.executorId);
  if (error) throw new Error(error.message);
}

/**
 * `update({ risk_daily_pnl_eur:0, updated_at }) .not("user_id","is",null)` — daily reset across all users.
 */
export async function updateRiskDailyPnlResetForAll(client: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .schema("trading")
    .from("executors")
    .update({ risk_daily_pnl_eur: 0, updated_at: now })
    .not("user_id", "is", null);
  if (error) throw new Error(error.message);
}
