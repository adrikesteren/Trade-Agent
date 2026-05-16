import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Run-status discriminator (mirror of `automation.sync_runs.status`). */
export type SyncRunStatus = "running" | "completed" | "failed" | "skipped" | string;

/** Trigger-source discriminator (mirror of `automation.sync_runs.trigger_source`). */
export type SyncRunTriggerSource = "manual" | "automated" | string;

/** Narrow metadata-only projection — used by candle-sync-window readers. */
export type SyncRunMetadataRow = {
  metadata: Record<string, unknown> | null;
};

/** List-page row projection — `/sync-runs/page.tsx` table rendering. */
export type SyncRunListRow = {
  id: string;
  job_key: string;
  status: SyncRunStatus;
  trigger_source: SyncRunTriggerSource | null;
  created_at: string | null;
  ended_at: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
};

/** Detail-page row projection — `/sync-runs/[id]/page.tsx`. */
export type SyncRunDetailRow = {
  id: string;
  job_key: string;
  status: SyncRunStatus;
  trigger_source: SyncRunTriggerSource | null;
  created_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
};

const SYNC_RUN_LIST_FIELDS =
  "id, job_key, status, trigger_source, created_at, ended_at, reason, metadata";

const SYNC_RUN_DETAIL_FIELDS =
  "id, job_key, status, trigger_source, created_at, ended_at, updated_at, reason, metadata";

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select(SYNC_RUN_DETAIL_FIELDS) .eq("id", id) .in("job_key", jobKeys) .maybeSingle()` —
 * detail-page lookup restricted to the dashboard-tracked job set.
 */
export async function selectDetailByIdAndJobKeys(
  client: SupabaseClient,
  args: { id: string; jobKeys: readonly string[] },
): Promise<SyncRunDetailRow | null> {
  const { data, error } = await client
    .schema("automation")
    .from("sync_runs")
    .select(SYNC_RUN_DETAIL_FIELDS)
    .eq("id", args.id)
    .in("job_key", [...args.jobKeys])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SyncRunDetailRow | null) ?? null;
}

/**
 * `select(SYNC_RUN_LIST_FIELDS) .in("job_key", jobKeys) .order("created_at", desc) .range(from, to)`
 * — list-page paginated rows.
 */
export async function selectListPaginatedByJobKeys(
  client: SupabaseClient,
  args: { jobKeys: readonly string[]; from: number; to: number },
): Promise<{ data: SyncRunListRow[]; error: { message: string } | null }> {
  const { data, error } = await client
    .schema("automation")
    .from("sync_runs")
    .select(SYNC_RUN_LIST_FIELDS)
    .in("job_key", [...args.jobKeys])
    .order("created_at", { ascending: false })
    .range(args.from, args.to);
  return {
    data: (data ?? []) as SyncRunListRow[],
    error: error ? { message: error.message } : null,
  };
}

/**
 * `select("*", { count: "exact", head: true }) .in("job_key", jobKeys)` —
 * list-page total restricted to the dashboard-tracked job set.
 */
export async function countByJobKeys(
  client: SupabaseClient,
  jobKeys: readonly string[],
): Promise<{ count: number; error: { message: string } | null }> {
  const { count, error } = await client
    .schema("automation")
    .from("sync_runs")
    .select("*", { count: "exact", head: true })
    .in("job_key", [...jobKeys]);
  return {
    count: count ?? 0,
    error: error ? { message: error.message } : null,
  };
}

/**
 * `select("metadata") .eq("id", runId) .eq("job_key", jobKey) .maybeSingle()` —
 * narrow metadata lookup used by candle-sync-window readers.
 */
export async function selectMetadataByIdAndJobKey(
  client: SupabaseClient,
  args: { runId: string; jobKey: string },
): Promise<SyncRunMetadataRow | null> {
  const { data, error } = await client
    .schema("automation")
    .from("sync_runs")
    .select("metadata")
    .eq("id", args.runId)
    .eq("job_key", args.jobKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SyncRunMetadataRow | null) ?? null;
}
