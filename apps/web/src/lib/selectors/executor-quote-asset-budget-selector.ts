import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Quote-asset-budget projection used on the new-executor clone form. */
export type ExecutorQuoteBudgetCloneRow = {
  quote_asset_id: string;
  max_notional_primary: string | number;
};

/** Quote-asset-budget projection used on the executor detail page. */
export type ExecutorQuoteBudgetDetailRow = {
  id: string;
  quote_asset_id: string;
  max_notional_primary: string | number;
};

/** Quote-asset-budget projection used on the related-list (`executor-quote-asset-budgets`) page. */
export type ExecutorQuoteBudgetListRow = {
  id: string;
  quote_asset_id: string;
  max_notional_primary: string | number;
  created_at: string;
  updated_at: string;
};

/**
 * Mediator-side join projection: junction row + a single `executors(user_id)` join used to
 * resolve the executor owner without a second round-trip.
 */
export type ExecutorQuoteBudgetWithExecutorRow = {
  max_notional_primary: string | number;
  executor_id: string;
  quote_asset_id: string;
  executors: { user_id?: string } | { user_id?: string }[] | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("quote_asset_id, max_notional_primary") .eq("executor_id", executorId) .order("created_at")`
 * — clone-form prefill (new-executor page).
 */
export async function selectCloneByExecutorIdOrdered(
  client: SupabaseClient,
  executorId: string,
): Promise<ExecutorQuoteBudgetCloneRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("quote_asset_id, max_notional_primary")
    .eq("executor_id", executorId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorQuoteBudgetCloneRow[];
}

/**
 * `select("id, quote_asset_id, max_notional_primary") .eq("executor_id", executorId) .order("created_at")`
 * — executor detail-page budget summary.
 */
export async function selectDetailByExecutorIdOrdered(
  client: SupabaseClient,
  executorId: string,
): Promise<ExecutorQuoteBudgetDetailRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("id, quote_asset_id, max_notional_primary")
    .eq("executor_id", executorId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorQuoteBudgetDetailRow[];
}

/**
 * `select("id, quote_asset_id, max_notional_primary, created_at, updated_at") .eq("executor_id", executorId) .order("created_at")`
 * — related-list page rows (with timestamps).
 */
export async function selectListByExecutorIdOrdered(
  client: SupabaseClient,
  executorId: string,
): Promise<ExecutorQuoteBudgetListRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("id, quote_asset_id, max_notional_primary, created_at, updated_at")
    .eq("executor_id", executorId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorQuoteBudgetListRow[];
}

/**
 * `select("max_notional_primary, executor_id, quote_asset_id, executors:executor_id(user_id)")
 *  .eq("executor_id", executorId) .eq("quote_asset_id", quoteAssetId) .maybeSingle()`
 * — mediator junction lookup that also returns the executor owner via embedded join.
 */
export async function selectWithExecutorByExecutorAndQuote(
  client: SupabaseClient,
  args: { executorId: string; quoteAssetId: string },
): Promise<ExecutorQuoteBudgetWithExecutorRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .select("max_notional_primary, executor_id, quote_asset_id, executors:executor_id ( user_id )")
    .eq("executor_id", args.executorId)
    .eq("quote_asset_id", args.quoteAssetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorQuoteBudgetWithExecutorRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `insert(row)` — single-row insert (UNIQUE-violation `23505` surfaces via the returned error). */
export async function insertOne(
  client: SupabaseClient,
  row: { executor_id: string; quote_asset_id: string; max_notional_primary: number | string },
): Promise<{ code?: string; message: string } | null> {
  const { error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .insert(row);
  if (!error) return null;
  return { code: error.code, message: error.message };
}

/** `insert(rows)` — bulk insert (used by the create/edit-executor delete-and-reinsert flow). */
export async function insertMany(
  client: SupabaseClient,
  rows: { executor_id: string; quote_asset_id: string; max_notional_primary: number | string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .insert(rows);
  if (error) throw new Error(error.message);
}

/**
 * `update({ quote_asset_id, max_notional_primary }) .eq("id", id) .eq("executor_id", executorId)`
 * — owner-scoped update (UNIQUE-violation `23505` surfaces via the returned error).
 */
export async function updateByIdAndExecutor(
  client: SupabaseClient,
  args: {
    id: string;
    executorId: string;
    patch: { quote_asset_id: string; max_notional_primary: number | string };
  },
): Promise<{ code?: string; message: string } | null> {
  const { error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .update(args.patch)
    .eq("id", args.id)
    .eq("executor_id", args.executorId);
  if (!error) return null;
  return { code: error.code, message: error.message };
}

/** `delete() .eq("id", id) .eq("executor_id", executorId)` — owner-scoped single-row delete. */
export async function deleteByIdAndExecutor(
  client: SupabaseClient,
  args: { id: string; executorId: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .delete()
    .eq("id", args.id)
    .eq("executor_id", args.executorId);
  if (error) throw new Error(error.message);
}

/** `delete() .eq("executor_id", executorId)` — wipe all budgets for an executor (replace flow). */
export async function deleteByExecutorId(
  client: SupabaseClient,
  executorId: string,
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_quote_asset_budget")
    .delete()
    .eq("executor_id", executorId);
  if (error) throw new Error(error.message);
}
