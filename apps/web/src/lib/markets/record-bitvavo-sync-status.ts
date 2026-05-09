import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE = "sync_runs" as const;
const AUTOMATION_SCHEMA = "automation" as const;

/** Shallow-merge bag stored on `automation.sync_runs.metadata` (jsonb). */
export type SyncRunMetadataPatch = Record<string, unknown>;

function isPlainMetadataObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readMergedMetadata(
  admin: SupabaseClient,
  runId: string,
  jobKey: string,
  patch: SyncRunMetadataPatch,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .select("metadata")
    .eq("id", runId)
    .eq("job_key", jobKey)
    .maybeSingle();
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const prev = isPlainMetadataObject(data?.metadata) ? data.metadata : {};
  return { ...prev, ...patch };
}

/**
 * Merge `patch` into the row's existing `metadata` (any status). Use for progress while `running`.
 */
export async function patchSyncRunMetadata(
  admin: SupabaseClient,
  args: { runId: string | null | undefined; jobKey: string; patch: SyncRunMetadataPatch },
): Promise<void> {
  const runId = args.runId ? String(args.runId).trim() : "";
  if (!runId || !args.patch || Object.keys(args.patch).length === 0) return;
  const now = new Date().toISOString();
  const merged = await readMergedMetadata(admin, runId, args.jobKey, args.patch);
  const { error } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .update({ metadata: merged, updated_at: now })
    .eq("id", runId)
    .eq("job_key", args.jobKey);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
}

export const BITVAVO_SYNC_JOB_MARKETS_EUR = "bitvavo_markets_eur";
export const BITVAVO_SYNC_JOB_CANDLES_EUR = "bitvavo_candles_eur";
/**
 * CoinGecko USD fundamentals refresh (`/coins/markets` → `catalog.assets` live columns).
 * Only rows with `coingecko_coin_id` set; id backfill is `coingecko_asset_coin_id`.
 * Value is `sync_runs.job_key` only — not a table name (legacy key was `coingecko_asset_metrics`).
 */
export const COINGECKO_SYNC_JOB_METRICS = "coingecko_assets_usd_live";
/** Fills `assets.coingecko_coin_id` from `metadata.coingecko_id` or CoinGecko /search when empty (e.g. every 5 min). */
export const COINGECKO_SYNC_JOB_COIN_ID = "coingecko_asset_coin_id";
export type BitvavoSyncTriggerSource = "manual" | "automated";
export type BitvavoSyncJobStatus = "running" | "completed" | "failed" | "skipped";

/** `sync_runs.reason` when status is `skipped` (automated overlap guard). */
export const SKIPPED_PREVIOUS_SYNC_STILL_RUNNING = "Previous sync still running";

export type BeginBitvavoSyncRunResult =
  | { outcome: "started"; runId: string }
  | { outcome: "skipped"; runId: string };

/** Latest still-running row for a job (e.g. QStash continuation missing syncRunId). */
export async function resolveLatestRunningBitvavoRunId(
  admin: SupabaseClient,
  jobKey: string,
): Promise<string | null> {
  const { data, error } = await admin
    .schema(AUTOMATION_SCHEMA)
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

/**
 * Starts a new sync run, or records a `skipped` row when `source` is `automated` and the same `job_key`
 * already has a `running` row (scheduler overlap).
 */
export async function beginBitvavoSyncRun(
  admin: SupabaseClient,
  jobKey: string,
  source: BitvavoSyncTriggerSource,
  options?: { metadata?: SyncRunMetadataPatch },
): Promise<BeginBitvavoSyncRunResult> {
  const now = new Date().toISOString();
  const initialMeta =
    options?.metadata && Object.keys(options.metadata).length > 0 ? options.metadata : undefined;

  if (source === "automated") {
    const existingRunningId = await resolveLatestRunningBitvavoRunId(admin, jobKey);
    if (existingRunningId) {
      const { data, error } = await admin
        .schema(AUTOMATION_SCHEMA)
        .from(TABLE)
        .insert({
          job_key: jobKey,
          status: "skipped",
          trigger_source: source,
          reason: SKIPPED_PREVIOUS_SYNC_STILL_RUNNING,
          created_at: now,
          ended_at: now,
          updated_at: now,
          ...(initialMeta ? { metadata: initialMeta } : {}),
        })
        .select("id")
        .single();

      if (error) throw new Error(`${TABLE}: ${error.message}`);
      if (!data?.id) throw new Error(`${TABLE}: skipped insert returned no id`);
      return { outcome: "skipped", runId: data.id as string };
    }
  }

  const { data, error } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .insert({
      job_key: jobKey,
      status: "running",
      trigger_source: source,
      created_at: now,
      updated_at: now,
      ...(initialMeta ? { metadata: initialMeta } : {}),
    })
    .select("id")
    .single();

  if (error) throw new Error(`${TABLE}: ${error.message}`);
  if (!data?.id) throw new Error(`${TABLE}: insert returned no id`);
  return { outcome: "started", runId: data.id as string };
}

/**
 * Marks the run completed (success). Only updates rows still in `running`.
 */
export async function recordBitvavoSyncCompleted(
  admin: SupabaseClient,
  args: {
    runId: string | null | undefined;
    jobKey: string;
    source: BitvavoSyncTriggerSource;
    /** Shallow-merged into existing `metadata` before setting status. */
    metadata?: SyncRunMetadataPatch;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const runId = await resolveRunIdForUpdate(admin, args.jobKey, args.runId);
  if (!runId) return;

  const hasMetaPatch = args.metadata && Object.keys(args.metadata).length > 0;
  const metadata = hasMetaPatch
    ? await readMergedMetadata(admin, runId, args.jobKey, args.metadata as SyncRunMetadataPatch)
    : undefined;

  const { error } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .update({
      status: "completed",
      ended_at: now,
      updated_at: now,
      trigger_source: args.source,
      ...(metadata ? { metadata } : {}),
    })
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .eq("status", "running");

  if (error) throw new Error(`${TABLE}: ${error.message}`);
}

/**
 * Marks the run failed. Only updates rows still in `running`.
 * `reason` is required by the DB when status is `failed` or `skipped`.
 */
export async function recordBitvavoSyncFailed(
  admin: SupabaseClient,
  args: {
    runId: string | null | undefined;
    jobKey: string;
    source: BitvavoSyncTriggerSource;
    reason: string;
    metadata?: SyncRunMetadataPatch;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const runId = await resolveRunIdForUpdate(admin, args.jobKey, args.runId);
  if (!runId) return;

  const resolvedReason = String(args.reason || "").trim() || "Unknown error";
  const hasMetaPatch = args.metadata && Object.keys(args.metadata).length > 0;
  const metadata = hasMetaPatch
    ? await readMergedMetadata(admin, runId, args.jobKey, args.metadata as SyncRunMetadataPatch)
    : undefined;

  const { error } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .update({
      status: "failed",
      reason: resolvedReason,
      ended_at: now,
      updated_at: now,
      trigger_source: args.source,
      ...(metadata ? { metadata } : {}),
    })
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .eq("status", "running");

  if (error) throw new Error(`${TABLE}: ${error.message}`);
}
