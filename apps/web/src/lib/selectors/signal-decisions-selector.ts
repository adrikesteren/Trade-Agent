import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types
// ──────────────────────────────────────────────────────────────────────────────

/** One M:N junction row between a decision and a signal, with mediator scoring. */
export type SignalDecisionRow = {
  id: string;
  decision_id: string;
  signal_id: string;
  score: number;
  reasons: Record<string, unknown> | null;
  created_at: string;
};

/** Bulk-insert shape (caller-built; `id` / `created_at` server-side). */
export type SignalDecisionInsert = {
  decision_id: string;
  signal_id: string;
  score: number;
  reasons?: Record<string, unknown> | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("…") .eq("decision_id", id)` — fetch every junction row (with its
 * per-signal score + reasons) for one decision.
 */
export async function selectByDecisionId(
  client: SupabaseClient,
  decisionId: string,
): Promise<SignalDecisionRow[]> {
  const { data, error } = await client
    .schema("trading")
    .from("signal_decisions")
    .select("id, decision_id, signal_id, score, reasons, created_at")
    .eq("decision_id", decisionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalDecisionRow[];
}

/**
 * `select("…") .in("decision_id", ids)` — bulk junction fetch across a chunk
 * of decision ids (used by list pages to resolve the signal set per row).
 */
export async function selectByDecisionIds(
  client: SupabaseClient,
  decisionIds: string[],
): Promise<SignalDecisionRow[]> {
  if (decisionIds.length === 0) return [];
  const { data, error } = await client
    .schema("trading")
    .from("signal_decisions")
    .select("id, decision_id, signal_id, score, reasons, created_at")
    .in("decision_id", decisionIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalDecisionRow[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `insert(rows)` — bulk insert junction rows for one (or many) decisions.
 * Caller is responsible for batching; the table unique constraint
 * `(decision_id, signal_id)` rejects duplicates.
 */
export async function insertMany(
  client: SupabaseClient,
  rows: SignalDecisionInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .schema("trading")
    .from("signal_decisions")
    .insert(rows);
  if (error) throw new Error(error.message);
}
