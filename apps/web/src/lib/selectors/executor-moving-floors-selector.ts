import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Narrow trio-keyed snapshot used by the catalog-close mediator to roll the
 * moving-floor state forward (peak + floor + activation timestamp).
 */
export type ExecutorMovingFloorRow = {
  peak_price_since_entry: string | number | null;
  floor_price: string | number | null;
  activated_at: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("peak_price_since_entry, floor_price, activated_at")
 *   .eq("user_id", x) .eq("executor_id", y) .eq("market_id", z) .maybeSingle()` —
 * mediator pre-evaluate lookup that decides the next floor / trigger-exit.
 */
export async function selectByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<ExecutorMovingFloorRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_moving_floors")
    .select("peak_price_since_entry, floor_price, activated_at")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExecutorMovingFloorRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(row, { onConflict: "user_id,executor_id,market_id" })` — mediator
 * floor-roll write. Caller composes the full row (peak/floor/activated_at +
 * updated_at) — selector keeps the conflict key co-located so every write
 * reaches the same unique constraint.
 */
export async function upsertOneByTrio(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_moving_floors")
    .upsert(row, { onConflict: "user_id,executor_id,market_id" });
  if (error) throw new Error(error.message);
}

/**
 * `delete() .eq(user_id) .eq(executor_id) .eq(market_id)` — clear the moving
 * floor on flat-position roll (mediator), on filled sell (executor paper +
 * live), and on historical-wipe reset.
 */
export async function deleteByTrio(
  client: SupabaseClient,
  args: { userId: string; executorId: string; marketId: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_moving_floors")
    .delete()
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId);
  if (error) throw new Error(error.message);
}
