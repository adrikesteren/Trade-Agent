import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Embedded signals projection (decisions → signals → candle_id), used to resolve `market_id`/`bar_close`. */
export type OrderEmbeddedDecisionSignals =
  | {
      signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
    }
  | {
      signals?: { candle_id?: string | null } | { candle_id?: string | null }[] | null;
    }[]
  | null;

/** Narrow id-only row used by the historical wipe service. */
export type OrderIdRow = { id: string };

/** Bitvavo-reconcile row (with embedded `decisions → signals(candle_id)` for market resolution). */
export type OrderReconcileRow = {
  id: string;
  user_id: string;
  executor_id: string;
  external_id: string | null;
  status: string;
  notional_eur: string | number | null;
  quantity: string | number | null;
  side: string;
  decision_id: string | null;
  decisions?: OrderEmbeddedDecisionSignals;
};

/** Trade-decision detail page row (narrow projection by `decision_id`). */
export type OrderForDecisionRow = {
  id: string;
  side: string;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
};

/** Executor detail page list row (with embedded `decisions → signals(candle_id)`). */
export type OrderExecutorListRow = {
  id: string;
  side: string;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  created_at: string;
  decisions?: OrderEmbeddedDecisionSignals;
};

/** Orders detail page row (wide, with embedded `decisions → signals(candle_id)`). */
export type OrderDetailRow = {
  id: string;
  decision_id: string | null;
  executor_id: string;
  side: string;
  position_side: string | null;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  paper: boolean;
  external_id: string | null;
  created_at: string;
  updated_at: string | null;
  decisions?: OrderEmbeddedDecisionSignals;
};

/** Orders list-view row (with embedded `decisions → signals(candle_id)`). */
export type OrderListViewRow = {
  id: string;
  decision_id: string | null;
  executor_id: string;
  side: string;
  position_side: string | null;
  quantity: string | number | null;
  notional_eur: string | number | null;
  status: string;
  paper: boolean;
  external_id: string | null;
  created_at: string;
  decisions?: OrderEmbeddedDecisionSignals;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id, user_id, executor_id, external_id, status, notional_eur, quantity, side, decision_id, decisions ( signals ( candle_id ) )")
 *   .eq("paper", false) .in("status", ["pending","open"]) .not("external_id", "is", null)
 *   .order("created_at") .limit(N)` — Bitvavo reconcile batch.
 */
export async function selectLiveOpenForReconcile(
  client: SupabaseClient,
  args: { limit: number },
): Promise<OrderReconcileRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("orders")
    .select(
      "id, user_id, executor_id, external_id, status, notional_eur, quantity, side, decision_id, decisions ( signals ( candle_id ) )",
    )
    .eq("paper", false)
    .in("status", ["pending", "open"])
    .not("external_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderReconcileRow[];
}

/**
 * `select("id, side, notional_eur, status, created_at", { count: "exact" })
 *   .eq("decision_id", id) .order(created_at desc) .limit(N)` — trade-decision detail page
 * orders pack. Returns `{ data, count, error }` so callers can destructure exactly like the
 * inline pack call it replaces.
 */
export async function selectForDecisionWithCount(
  client: SupabaseClient,
  args: { decisionId: string; limit: number },
): Promise<{ data: OrderForDecisionRow[] | null; count: number | null; error: { message: string } | null }> {
  const { data, count, error } = await client
    .schema("trading")
    .from("orders")
    .select("id, side, notional_eur, status, created_at", { count: "exact" })
    .eq("decision_id", args.decisionId)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as OrderForDecisionRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

/**
 * `select("id, side, quantity, notional_eur, status, created_at, decisions ( signals ( candle_id ) )",
 *   { count: "exact" }) .eq("executor_id", id) .order(created_at desc) .limit(N)` — executor
 * detail page orders pack. Returns `{ data, count, error }` so callers can destructure like
 * the inline pack call it replaces.
 */
export async function selectExecutorRecentWithCount(
  client: SupabaseClient,
  args: { executorId: string; limit: number },
): Promise<{ data: OrderExecutorListRow[] | null; count: number | null; error: { message: string } | null }> {
  const { data, count, error } = await client
    .schema("trading")
    .from("orders")
    .select(
      "id, side, quantity, notional_eur, status, created_at, decisions ( signals ( candle_id ) )",
      { count: "exact" },
    )
    .eq("executor_id", args.executorId)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as OrderExecutorListRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

/**
 * `select("…wide…, decisions ( signals ( candle_id ) )") .eq("id", id) .maybeSingle()` —
 * orders detail page lookup.
 */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<OrderDetailRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("orders")
    .select(
      "id, decision_id, executor_id, side, position_side, quantity, notional_eur, status, paper, external_id, created_at, updated_at, decisions ( signals ( candle_id ) )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OrderDetailRow | null) ?? null;
}

/** `select("id") .eq("decision_id", id) .maybeSingle()` — duplicate-guard before order insert. */
export async function selectIdByDecisionId(
  client: SupabaseClient,
  decisionId: string,
): Promise<OrderIdRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("orders")
    .select("id")
    .eq("decision_id", decisionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OrderIdRow | null) ?? null;
}

/** `select("id") .in("decision_id", ids)` — historical-wipe lookup for order ids owned by a decision-id chunk. */
export async function selectIdsByDecisionIds(
  client: SupabaseClient,
  decisionIds: string[],
): Promise<OrderIdRow[]> {
  if (decisionIds.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("orders")
    .select("id")
    .in("decision_id", decisionIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderIdRow[];
}

// ──────────────────────────────────────────────────────────────────────────────
// List page
// ──────────────────────────────────────────────────────────────────────────────

/** Orders list page total count. Caller may narrow by executor via `executorIdFilter`. */
export async function countListView(
  client: SupabaseClient,
  args: { executorIdFilter?: string | null },
): Promise<{ count: number | null; error: { message: string } | null }> {
  let q = client
    .schema("trading")
    .from("orders")
    .select("*", { count: "exact", head: true });
  if (args.executorIdFilter) {
    q = q.eq("executor_id", args.executorIdFilter);
  }
  const { count, error } = await q;
  return { count: count ?? null, error: error ?? null };
}

/**
 * Orders list page rows — `select("…list-view…, decisions ( signals ( candle_id ) )")
 *   .order(created_at desc) .range(from, to)`. Caller may narrow by executor via
 * `executorIdFilter`.
 */
export async function selectListViewPaginated(
  client: SupabaseClient,
  args: { from: number; to: number; executorIdFilter?: string | null },
): Promise<{ data: OrderListViewRow[] | null; error: { message: string } | null }> {
  let q = client
    .schema("trading")
    .from("orders")
    .select(
      "id, decision_id, executor_id, side, position_side, quantity, notional_eur, status, paper, external_id, created_at, decisions ( signals ( candle_id ) )",
    )
    .order("created_at", { ascending: false })
    .range(args.from, args.to);
  if (args.executorIdFilter) {
    q = q.eq("executor_id", args.executorIdFilter);
  }
  const { data, error } = await q;
  return {
    data: (data ?? null) as OrderListViewRow[] | null,
    error: error ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `insert(row)` — generic single-row insert (paper-fill / rejected / live tracker rows). */
export async function insertOne(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.schema("trading").from("orders").insert(row);
  if (error) throw new Error(error.message);
}

/**
 * `insert(row).select("id").single()` — single-row insert returning the new `id` (paper buy/sell
 * fill insert + live order insert paths).
 */
export async function insertOneReturningId(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client
    .schema("trading")
    .from("orders")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error("orders insert returned no id");
  return id;
}

/** `update(patch) .eq("id", id)` — generic single-id update (status / quantity adjust). */
export async function updateById(
  client: SupabaseClient,
  args: { id: string; patch: Record<string, unknown> },
): Promise<void> {
  const { error } = await client
    .schema("trading")
    .from("orders")
    .update(args.patch)
    .eq("id", args.id);
  if (error) throw new Error(error.message);
}

/** `delete() .eq("id", id)` — single-row delete (paper fill rollback path). */
export async function deleteById(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.schema("trading").from("orders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** `delete() .in("id", ids)` — chunked id-list delete used by the historical wipe service. */
export async function deleteByIds(client: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client.schema("trading").from("orders").delete().in("id", ids);
  if (error) throw new Error(error.message);
}
