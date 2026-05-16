import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Embedded signals projection (candle_id join used to resolve bar_close_time). */
export type DecisionEmbeddedSignals =
  | { candle_id?: string | null }
  | { candle_id?: string | null }[]
  | null;

/** Narrow row used by the executor catalog-close run (gating + payload + approval state). */
export type DecisionRunRow = {
  id: string;
  user_id: string;
  signal_id: string;
  approved: boolean;
  timeframe: string;
  decision_payload: Record<string, unknown> | null;
};

/** Narrow id-only row used by the historical wipe service. */
export type DecisionIdRow = { id: string };

/** List-view row (trade-decisions list page) — embeds `signals(candle_id)` for bar-close resolution. */
export type DecisionListViewRow = {
  id: string;
  executor_id: string;
  signal_id: string;
  approved: boolean;
  reason_codes: string[] | null;
  timeframe: string;
  position_side: string;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
  signals?: DecisionEmbeddedSignals;
};

/** Detail-page row (trade-decisions/[id]) — wide projection incl. risk_snapshot + embedded signals. */
export type DecisionDetailRow = {
  id: string;
  user_id: string;
  executor_id: string;
  signal_id: string | null;
  approved: boolean;
  reason_codes: string[] | null;
  timeframe: string;
  position_side: string | null;
  decision_payload: Record<string, unknown> | null;
  risk_snapshot: Record<string, unknown> | null;
  created_at: string;
  signals?: DecisionEmbeddedSignals;
};

/** Executor-detail trade-decisions pack row (narrow projection with embedded signals). */
export type DecisionExecutorListRow = {
  id: string;
  signal_id: string | null;
  approved: boolean;
  created_at: string;
  signals?: DecisionEmbeddedSignals;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id, user_id, signal_id, approved, timeframe, decision_payload")
 *   .eq("user_id", x).eq("executor_id", y).in("signal_id", ids)` — gating-pool
 * lookup used by the catalog-close executor run.
 */
export async function selectRunRowsForExecutorAndSignals(
  client: SupabaseClient,
  args: { userId: string; executorId: string; signalIds: string[] },
): Promise<DecisionRunRow[]> {
  if (args.signalIds.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("decisions")
    .select("id, user_id, signal_id, approved, timeframe, decision_payload")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .in("signal_id", args.signalIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as DecisionRunRow[];
}

/**
 * `select("id") .eq("user_id", x) .eq("executor_id", y) .eq("market_id", z)
 *   .gte("close_time", a) .lte("close_time", b)` — historical wipe lookup.
 */
export async function selectIdsForHistoricalWipe(
  client: SupabaseClient,
  args: {
    userId: string;
    executorId: string;
    marketId: string;
    closeTimeGte: string;
    closeTimeLte: string;
  },
): Promise<DecisionIdRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("decisions")
    .select("id")
    .eq("user_id", args.userId)
    .eq("executor_id", args.executorId)
    .eq("market_id", args.marketId)
    .gte("close_time", args.closeTimeGte)
    .lte("close_time", args.closeTimeLte);
  if (error) throw new Error(error.message);
  return (data ?? []) as DecisionIdRow[];
}

/**
 * `select("…, signals(candle_id)") .order(created_at desc) .limit(N)` — trade-decisions list
 * view fetch. Caller may narrow by executor via `executorIdFilter`.
 */
export async function selectListViewRecent(
  client: SupabaseClient,
  args: { limit: number; executorIdFilter?: string | null },
): Promise<DecisionListViewRow[]> {
  let q = client
    .schema("trading")
    .from("decisions")
    .select(
      "id, executor_id, signal_id, approved, reason_codes, timeframe, position_side, decision_payload, created_at, signals ( candle_id )",
    )
    .order("created_at", { ascending: false })
    .limit(args.limit);
  if (args.executorIdFilter) {
    q = q.eq("executor_id", args.executorIdFilter);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DecisionListViewRow[];
}

/**
 * `select("id, signal_id, approved, created_at, signals(candle_id)", { count: "exact" })
 *   .eq("executor_id", id) .order(created_at desc) .limit(N)` — executor detail
 * page trade-decisions pack. Returns `{ data, count, error }` so the caller can
 * destructure exactly like the inline pack call it replaces.
 */
export async function selectExecutorRecentWithCount(
  client: SupabaseClient,
  args: { executorId: string; limit: number },
): Promise<{ data: DecisionExecutorListRow[] | null; count: number | null; error: { message: string } | null }> {
  const { data, count, error } = await client
    .schema("trading")
    .from("decisions")
    .select("id, signal_id, approved, created_at, signals ( candle_id )", {
      count: "exact",
    })
    .eq("executor_id", args.executorId)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as DecisionExecutorListRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

/**
 * `select("…wide…, signals(candle_id)") .eq("id", id) .maybeSingle()` — trade-decision
 * detail page lookup.
 */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<DecisionDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("decisions")
    .select(
      "id, user_id, executor_id, signal_id, approved, reason_codes, timeframe, position_side, decision_payload, risk_snapshot, created_at, signals ( candle_id )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DecisionDetailRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(row, { onConflict: "user_id,executor_id,signal_id,position_side" })` —
 * primary mediator decision write. Caller composes the full row (decision payload,
 * risk snapshot, gating columns) — selector keeps the conflict key co-located so
 * every write target reaches the same unique constraint.
 */
export async function upsertOneByExecutorSignalSide(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("decisions")
    .upsert(row, { onConflict: "user_id,executor_id,signal_id,position_side" });
  if (error) throw new Error(error.message);
}

/** `delete() .in("id", ids)` — chunked id-list delete used by the historical wipe service. */
export async function deleteByIds(client: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client.schema("trading").from("decisions").delete().in("id", ids);
  if (error) throw new Error(error.message);
}
