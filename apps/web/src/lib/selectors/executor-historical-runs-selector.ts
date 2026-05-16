import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Run-status discriminator (mirror of `trading.executor_historical_run_status`). */
export type ExecutorHistoricalRunStatus = "queued" | "running" | "completed" | "failed" | string;

/** Insert row for the orchestrator's `status="running"` log row. */
export type ExecutorHistoricalRunRunningInsert = {
  executor_id: string;
  user_id: string;
  status: ExecutorHistoricalRunStatus;
  bars_total: number;
  bars_done: number;
  metadata: Record<string, unknown>;
};

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `insert(row) .select("id") .single()` — initial `status="running"` log row, returning the new id. */
export async function insertRunningReturningId(
  client: SupabaseClient,
  row: ExecutorHistoricalRunRunningInsert,
): Promise<string> {
  const { data, error } = await client
    .schema("trading")
    .from("executor_historical_runs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("executor_historical_runs insert returned no id");
  return id;
}

/** `update({ bars_done }) .eq("id", id)` — incremental progress tick from the replay loop. */
export async function updateBarsDoneById(
  client: SupabaseClient,
  args: { id: string; barsDone: number },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_historical_runs")
    .update({ bars_done: args.barsDone })
    .eq("id", args.id);
  if (error) throw new Error(error.message);
}

/**
 * `update({ status:"completed", completed_at, bars_done, metadata }) .eq("id", id)` — final
 * success patch after the replay loop drains.
 */
export async function updateCompletedById(
  client: SupabaseClient,
  args: {
    id: string;
    barsDone: number;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_historical_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      bars_done: args.barsDone,
      metadata: args.metadata,
    })
    .eq("id", args.id);
  if (error) throw new Error(error.message);
}

/**
 * `update({ status:"failed", completed_at, error }) .eq("id", id)` — failure patch from the
 * orchestrator's catch block.
 */
export async function updateFailedById(
  client: SupabaseClient,
  args: { id: string; error: string },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_historical_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error: args.error,
    })
    .eq("id", args.id);
  if (error) throw new Error(error.message);
}

/** `delete() .eq("id", id)` — single-row delete (cleanup / rollback path). */
export async function deleteById(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("executor_historical_runs")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
