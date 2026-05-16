import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** List-page projection — columns rendered by the `/signal-runs` list table. */
export type SignalRunListRow = {
  id: string;
  signal_job_id: string | null;
  agent_id: string;
  signal_id: string | null;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select(<list-fields>) .order("started_at", { ascending: false }) .range(from, to)` —
 * paginated list page.
 */
export async function selectAllPaginatedOrderedByStartedAt(
  client: SupabaseClient,
  range: { from: number; to: number },
): Promise<SignalRunListRow[]> {
  const { data, error } = await client
    .schema("automation")
    .from("signal_runs")
    .select("id, signal_job_id, agent_id, signal_id, status, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .range(range.from, range.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalRunListRow[];
}

/** `select("*", { count: "exact", head: true })` — total row count for pagination. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("automation")
    .from("signal_runs")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
