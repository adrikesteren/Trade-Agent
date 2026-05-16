import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** List-page projection — columns rendered by the `/signal-jobs` list table. */
export type SignalJobListRow = {
  id: string;
  job_key: string;
  market_id: string;
  timeframe: string;
  close_time: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

/**
 * `select("id, job_key, market_id, timeframe, close_time, status, error, created_at, started_at, ended_at")
 *   .order("created_at", { ascending: false }) .range(from, to)` — paginated list page.
 */
export async function selectAllPaginatedOrderedByCreatedAt(
  client: SupabaseClient,
  range: { from: number; to: number },
): Promise<SignalJobListRow[]> {
  const { data, error } = await client
    .schema("automation")
    .from("signal_jobs")
    .select(
      "id, job_key, market_id, timeframe, close_time, status, error, created_at, started_at, ended_at",
    )
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalJobListRow[];
}

/** `select("*", { count: "exact", head: true })` — total row count for pagination. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("automation")
    .from("signal_jobs")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
