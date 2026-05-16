import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Position side discriminator (mirror of `trading.positions.position_side`). */
export type PositionSide = "long" | "short" | string;

/** Narrow trio-keyed snapshot used by paper / live buy-merge logic (`mergeBuyPositionAvg`). */
export type PositionQtyAvgRow = {
  id: string;
  quantity: string | number | null;
  avg_price: string | number | null;
};

/** Snapshot used by the paper sell + restore-snapshot helpers (no id needed). */
export type PositionQtyAvgPaperRow = {
  quantity: string | number | null;
  avg_price: string | number | null;
  paper: boolean | null;
};

/** Narrow quantity+avg pair used by the mediator pre-evaluate position read. */
export type PositionQtyAvgPairRow = {
  quantity: string | number | null;
  avg_price: string | number | null;
};

/** Side+quantity projection used by SAR to bucket open positions per side. */
export type PositionSideAndQuantityRow = {
  position_side: PositionSide | null;
  quantity: string | number | null;
};

/** Executor-detail / list page projection (no user_id, no executor_id — caller filters by both). */
export type PositionListRow = {
  id: string;
  market_id: string;
  quantity: string | number | null;
  avg_price: string | number | null;
  paper: boolean;
  updated_at: string;
};

/** Positions-list page projection (full identifying columns for cross-executor listing). */
export type PositionFullListRow = {
  id: string;
  user_id: string;
  executor_id: string;
  market_id: string;
  position_side: PositionSide;
  quantity: string | number | null;
  avg_price: string | number | null;
  paper: boolean;
  updated_at: string;
};

const POSITION_LIST_FIELDS = "id, market_id, quantity, avg_price, paper, updated_at";

const POSITION_FULL_LIST_FIELDS =
  "id, user_id, executor_id, market_id, position_side, quantity, avg_price, paper, updated_at";

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id, quantity, avg_price") .eq(user_id) .eq(executor_id) .eq(market_id) .maybeSingle()`
 * — buy-merge snapshot used by paper + live (Bitvavo reconcile) upsert-after-buy paths.
 */
export async function selectIdQtyAvgByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<PositionQtyAvgRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("positions")
    .select("id, quantity, avg_price")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PositionQtyAvgRow | null) ?? null;
}

/**
 * `select("quantity, avg_price, paper") .eq(user_id) .eq(executor_id) .eq(market_id) .maybeSingle()`
 * — paper-sell + snapshot/restore helpers in the executor wallet service.
 */
export async function selectQtyAvgPaperByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<PositionQtyAvgPaperRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("positions")
    .select("quantity, avg_price, paper")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PositionQtyAvgPaperRow | null) ?? null;
}

/**
 * `select("quantity, avg_price") .eq(user_id) .eq(executor_id) .eq(market_id) .maybeSingle()`
 * — mediator pre-evaluate read (`inPosition` + moving-floor seed).
 */
export async function selectQtyAvgByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<PositionQtyAvgPairRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("positions")
    .select("quantity, avg_price")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PositionQtyAvgPairRow | null) ?? null;
}

/**
 * `select("position_side, quantity") .eq(user_id) .eq(executor_id) .eq(market_id)`
 * — SAR open-positions-by-side fan-out (returns all rows; caller buckets per side).
 * Soft-fails to `[]` matching the original SAR helper which swallows errors.
 */
export async function selectSideAndQuantityByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<PositionSideAndQuantityRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("positions")
    .select("position_side, quantity")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (error) return [];
  return (data ?? []) as PositionSideAndQuantityRow[];
}

/**
 * `select(POSITION_LIST_FIELDS, { count: "exact" }) .eq(executor_id) .eq(user_id)
 *   .order(updated_at desc) .limit(N)` — executor-detail-page related-positions pack.
 * Returns `{ data, count, error }` so callers can destructure exactly like the
 * inline pack call this replaces.
 */
export async function selectExecutorListWithCount(
  client: SupabaseClient,
  args: { executorId: string; userId: string; limit: number },
): Promise<{ data: PositionListRow[] | null; count: number | null; error: { message: string } | null }> {
  const { data, count, error } = await client
    .schema("trading")
    .from("positions")
    .select(POSITION_LIST_FIELDS, { count: "exact" })
    .eq("executor_id", args.executorId)
    .eq("user_id", args.userId)
    .order("updated_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as PositionListRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

/**
 * `select(POSITION_FULL_LIST_FIELDS) .order(updated_at desc) .range(from, to)` — positions
 * list page rows. Caller may narrow by executor via `executorIdFilter`.
 */
export async function selectListPaginated(
  client: SupabaseClient,
  args: { from: number; to: number; executorIdFilter?: string | null },
): Promise<PositionFullListRow[]> {
  let q = client
    .schema("trading")
    .from("positions")
    .select(POSITION_FULL_LIST_FIELDS)
    .order("updated_at", { ascending: false })
    .range(args.from, args.to);
  if (args.executorIdFilter) {
    q = q.eq("executor_id", args.executorIdFilter);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PositionFullListRow[];
}

/**
 * `select("*", { count: "exact", head: true })` — total row count for positions list pagination.
 * Caller may narrow by executor via `executorIdFilter`.
 */
export async function countAllOrFiltered(
  client: SupabaseClient,
  args: { executorIdFilter?: string | null },
): Promise<number> {
  let q = client.schema("trading").from("positions").select("*", { count: "exact", head: true });
  if (args.executorIdFilter) {
    q = q.eq("executor_id", args.executorIdFilter);
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(row, { onConflict: "user_id,executor_id,market_id" })` — paper + live
 * position-after-fill writer. Caller composes the full row (quantity, avg_price,
 * paper, updated_at, etc.); selector keeps the conflict key co-located so every
 * write target reaches the same unique constraint.
 */
export async function upsertOneByTrio(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("positions")
    .upsert(row, { onConflict: "user_id,executor_id,market_id" });
  if (error) throw new Error(error.message);
}

/**
 * `update({ quantity, updated_at }) .eq(user_id) .eq(executor_id) .eq(market_id)`
 * — partial paper-sell update for the remaining quantity (does not touch avg_price).
 */
export async function updateQuantityByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string; quantity: number },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("positions")
    .update({
      quantity: args.quantity,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (error) throw new Error(error.message);
}

/**
 * `delete() .eq(user_id) .eq(executor_id) .eq(market_id)` — full position close
 * (paper-sell goes-to-zero, restore-snapshot null-case, historical-wipe reset).
 */
export async function deleteByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("positions")
    .delete()
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (error) throw new Error(error.message);
}
