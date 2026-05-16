import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types
// ──────────────────────────────────────────────────────────────────────────────

/** Narrow id-only row used for existence/dedupe checks (e.g. reconcile). */
export type FillIdRow = { id: string };

/** Order-detail page projection (no `user_id` / `order_id`). */
export type FillDetailRow = {
  id: string;
  price: string | number | null;
  quantity: string | number | null;
  fee: string | number | null;
  created_at: string;
};

/** List-view projection — fills list page. */
export type FillListRow = {
  id: string;
  user_id: string;
  order_id: string;
  price: string | number | null;
  quantity: string | number | null;
  fee: string | number | null;
  created_at: string;
};

/** Insert payload — shared by paper (catalog-close) and live (reconcile) flows. */
export type FillInsertRow = {
  user_id: string;
  order_id: string;
  price: number;
  quantity: number;
  fee: number;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id") .eq("order_id", id) .maybeSingle()` — existence probe used by the
 * Bitvavo reconcile flow to avoid double-inserting a fill for an already-filled order.
 */
export async function selectIdByOrderId(
  client: SupabaseClient,
  orderId: string,
): Promise<FillIdRow | null> {
  const { data, error } = await client
    .schema("trading")
    .from("fills")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FillIdRow | null) ?? null;
}

/**
 * `select("id, price, quantity, fee, created_at", { count: "exact" }) .eq("order_id", id)
 *   .order(created_at desc) .limit(N)` — order detail page fills pack. Returns
 * `{ data, count, error }` so the caller can destructure exactly like the inline
 * pack call it replaces.
 */
export async function selectDetailByOrderIdWithCount(
  client: SupabaseClient,
  args: { orderId: string; limit: number },
): Promise<{ data: FillDetailRow[] | null; count: number | null; error: { message: string } | null }> {
  const { data, count, error } = await client
    .schema("trading")
    .from("fills")
    .select("id, price, quantity, fee, created_at", { count: "exact" })
    .eq("order_id", args.orderId)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  return {
    data: (data ?? null) as FillDetailRow[] | null,
    count: count ?? null,
    error: error ?? null,
  };
}

/**
 * `select("id, user_id, order_id, price, quantity, fee, created_at")
 *   .order(created_at desc) .range(from, to)` — fills list page. Caller may narrow
 * by order via `orderIdFilter`.
 */
export async function selectListPaginated(
  client: SupabaseClient,
  args: { from: number; to: number; orderIdFilter?: string | null },
): Promise<FillListRow[]> {
  let q = client
    .schema("trading")
    .from("fills")
    .select("id, user_id, order_id, price, quantity, fee, created_at")
    .order("created_at", { ascending: false })
    .range(args.from, args.to);
  if (args.orderIdFilter) {
    q = q.eq("order_id", args.orderIdFilter);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as FillListRow[];
}

/**
 * `select("*", { count: "exact", head: true })` — total row count for pagination.
 * Caller may narrow by order via `orderIdFilter`.
 */
export async function countAll(
  client: SupabaseClient,
  args: { orderIdFilter?: string | null } = {},
): Promise<number> {
  let q = client.schema("trading").from("fills").select("*", { count: "exact", head: true });
  if (args.orderIdFilter) {
    q = q.eq("order_id", args.orderIdFilter);
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `insert(row)` — single-row fill insert. Shared by paper (catalog-close executor
 * run) and live (Bitvavo reconcile, live broker fills) flows.
 */
export async function insertOne(client: SupabaseClient, row: FillInsertRow): Promise<void> {
  const { error } = await client.schema("trading").from("fills").insert(row);
  if (error) throw new Error(error.message);
}

/**
 * `delete() .in("order_id", ids)` — chunked order-id-list delete used by the
 * historical simulation wipe service. Caller is responsible for chunking large
 * arrays to keep PostgREST filter URLs under reverse-proxy limits.
 */
export async function deleteByOrderIds(client: SupabaseClient, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const { error } = await client.schema("trading").from("fills").delete().in("order_id", orderIds);
  if (error) throw new Error(error.message);
}
