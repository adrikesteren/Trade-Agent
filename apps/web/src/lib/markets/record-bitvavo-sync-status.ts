import type { SupabaseClient } from "@supabase/supabase-js";

export const BITVAVO_SYNC_JOB_MARKETS_EUR = "bitvavo_markets_eur";
export const BITVAVO_SYNC_JOB_CANDLES_EUR = "bitvavo_candles_eur";
export type BitvavoSyncTriggerSource = "manual" | "automated";
export type BitvavoSyncJobStatus = "running" | "completed" | "failed";

const TABLE = "bitvavo_sync_runs" as const;

/** Latest still-running row for a job (e.g. QStash continuation missing syncRunId). */
export async function resolveLatestRunningBitvavoRunId(
  admin: SupabaseClient,
  jobKey: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select("id")
    .eq("job_key", jobKey)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function resolveRunIdForUpdate(
  admin: SupabaseClient,
  jobKey: string,
  explicit: string | null | undefined,
): Promise<string | null> {
  if (explicit) return explicit;
  return resolveLatestRunningBitvavoRunId(admin, jobKey);
}

/** Inserts a new `running` row for this sync attempt (append-only). */
export async function beginBitvavoSyncRun(
  admin: SupabaseClient,
  jobKey: string,
  source: BitvavoSyncTriggerSource,
): Promise<string> {
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from(TABLE)
    .insert({
      job_key: jobKey,
      status: "running",
      trigger_source: source,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) throw new Error(`${TABLE}: ${error.message}`);
  if (!data?.id) throw new Error(`${TABLE}: insert returned no id`);
  return data.id as string;
}

/**
 * Marks the run completed (success). Only updates rows still in `running`.
 */
export async function recordBitvavoSyncCompleted(
  admin: SupabaseClient,
  args: { runId: string | null | undefined; jobKey: string; source: BitvavoSyncTriggerSource },
): Promise<void> {
  const now = new Date().toISOString();
  const runId = await resolveRunIdForUpdate(admin, args.jobKey, args.runId);
  if (!runId) return;

  const { error } = await admin
    .from(TABLE)
    .update({
      status: "completed",
      completed_at: now,
      ended_at: now,
      updated_at: now,
      trigger_source: args.source,
    })
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .eq("status", "running");

  if (error) throw new Error(`${TABLE}: ${error.message}`);
}

/**
 * Marks the run failed. Only updates rows still in `running`.
 */
export async function recordBitvavoSyncFailed(
  admin: SupabaseClient,
  args: { runId: string | null | undefined; jobKey: string; source: BitvavoSyncTriggerSource },
): Promise<void> {
  const now = new Date().toISOString();
  const runId = await resolveRunIdForUpdate(admin, args.jobKey, args.runId);
  if (!runId) return;

  const { error } = await admin
    .from(TABLE)
    .update({
      status: "failed",
      ended_at: now,
      updated_at: now,
      trigger_source: args.source,
    })
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .eq("status", "running");

  if (error) throw new Error(`${TABLE}: ${error.message}`);
}
