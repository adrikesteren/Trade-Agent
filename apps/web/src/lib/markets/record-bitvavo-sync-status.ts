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
/** `automation.sync_runs.job_key` — catalog-close signal evaluation pass. */
export const SYNC_JOB_SIGNALS_CATALOG_CLOSE = "signals_catalog_close" as const;
/** `automation.sync_runs.job_key` — mediator pass for one catalog bar close. */
export const SYNC_JOB_MEDIATOR_CATALOG_CLOSE = "mediator_catalog_close" as const;
/** `automation.sync_runs.job_key` — executor pass for one catalog bar close. */
export const SYNC_JOB_EXECUTOR_CATALOG_CLOSE = "executor_catalog_close" as const;
export type BitvavoSyncTriggerSource = "manual" | "automated";
export type BitvavoSyncJobStatus = "running" | "completed" | "failed" | "skipped";

/** `sync_runs.reason` when status is `skipped` (automated overlap guard). */
export const SKIPPED_PREVIOUS_SYNC_STILL_RUNNING = "Previous sync still running";

export type BeginBitvavoSyncRunResult =
  | { outcome: "started"; runId: string }
  | { outcome: "skipped"; runId: string };

/** Latest still-running row for a job (e.g. HTTP chunk continuation missing syncRunId). */
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

function isUniqueViolation(err: unknown): boolean {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "23505";
}

/** Human-readable `sync_runs.reason` when a run is failed for exceeding max wall time in `running`. */
export const SYNC_RUN_TIMED_OUT_REASON =
  "Timed out: run exceeded the maximum running duration without completing (server safeguard).";

function syncRunRunningTimeoutMs(): number {
  const raw = process.env.SYNC_RUN_RUNNING_TIMEOUT_MS?.trim();
  if (!raw) return 600_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 600_000;
  return Math.min(Math.max(Math.floor(n), 60_000), 24 * 60 * 60 * 1000);
}

type StaleRunRow = {
  id: string;
  created_at: string;
  trigger_source: string | null;
  metadata: unknown;
};

/**
 * If a `running` row exceeds the configured wall time since `created_at` (default 10 minutes), mark it `failed`.
 * - With `runId`: only that row (for explicit run id).
 * - Without `runId`: the single `running` row for `job_key` if stale (before starting a new run).
 *
 * Returns the run id that was timed out, or null.
 */
export async function failSyncRunIfExceededMaxDuration(
  admin: SupabaseClient,
  args: { jobKey: string; runId?: string | null },
): Promise<string | null> {
  const maxMs = syncRunRunningTimeoutMs();
  const cutoffIso = new Date(Date.now() - maxMs).toISOString();
  const now = new Date().toISOString();

  let row: StaleRunRow | null = null;

  if (args.runId && String(args.runId).trim()) {
    const id = String(args.runId).trim();
    const { data, error } = await admin
      .schema(AUTOMATION_SCHEMA)
      .from(TABLE)
      .select("id, created_at, trigger_source, metadata, status")
      .eq("id", id)
      .eq("job_key", args.jobKey)
      .maybeSingle();
    if (error || !data || String(data.status) !== "running") return null;
    const created = typeof data.created_at === "string" ? Date.parse(data.created_at) : NaN;
    if (!Number.isFinite(created) || created >= Date.now() - maxMs) return null;
    row = {
      id: data.id as string,
      created_at: data.created_at as string,
      trigger_source: (data.trigger_source as string | null) ?? null,
      metadata: data.metadata,
    };
  } else {
    const { data, error } = await admin
      .schema(AUTOMATION_SCHEMA)
      .from(TABLE)
      .select("id, created_at, trigger_source, metadata")
      .eq("job_key", args.jobKey)
      .eq("status", "running")
      .lt("created_at", cutoffIso)
      .maybeSingle();
    if (error || !data?.id) return null;
    row = {
      id: data.id as string,
      created_at: data.created_at as string,
      trigger_source: (data.trigger_source as string | null) ?? null,
      metadata: data.metadata,
    };
  }

  const prev = isPlainMetadataObject(row.metadata) ? row.metadata : {};
  const merged = { ...prev, timedOut: true, timedOutAfterMs: maxMs };
  const trig: BitvavoSyncTriggerSource = row.trigger_source === "manual" ? "manual" : "automated";

  const { error: upErr } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .update({
      status: "failed",
      reason: SYNC_RUN_TIMED_OUT_REASON,
      ended_at: now,
      updated_at: now,
      trigger_source: trig,
      metadata: merged,
    })
    .eq("id", row.id)
    .eq("job_key", args.jobKey)
    .eq("status", "running");

  if (upErr) {
    console.error(`${TABLE}: failSyncRunIfExceededMaxDuration: ${upErr.message}`);
    return null;
  }
  return row.id;
}

/**
 * Starts a new sync run. Concurrent `running` rows for the same `job_key` are prevented by a partial unique
 * index; on conflict, `automated` inserts a `skipped` audit row (manual callers get an error).
 */
export async function beginBitvavoSyncRun(
  admin: SupabaseClient,
  jobKey: string,
  source: BitvavoSyncTriggerSource,
  options?: { metadata?: SyncRunMetadataPatch },
): Promise<BeginBitvavoSyncRunResult> {
  await failSyncRunIfExceededMaxDuration(admin, { jobKey });

  const now = new Date().toISOString();
  const initialMeta =
    options?.metadata && Object.keys(options.metadata).length > 0 ? options.metadata : undefined;

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

  if (!error && data?.id) {
    return { outcome: "started", runId: data.id as string };
  }

  if (isUniqueViolation(error)) {
    const blockedByRunId = await resolveLatestRunningBitvavoRunId(admin, jobKey);
    const skipMeta: Record<string, unknown> = {
      ...(initialMeta ?? {}),
      ...(blockedByRunId ? { blockedByRunId } : {}),
    };

    if (source === "automated") {
      const { data: skipRow, error: skipErr } = await admin
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
          ...(Object.keys(skipMeta).length > 0 ? { metadata: skipMeta } : {}),
        })
        .select("id")
        .single();

      if (skipErr) throw new Error(`${TABLE}: ${skipErr.message}`);
      if (!skipRow?.id) throw new Error(`${TABLE}: skipped insert returned no id`);
      return { outcome: "skipped", runId: skipRow.id as string };
    }

    throw new Error("Another sync is already running for this job.");
  }

  throw new Error(`${TABLE}: ${error?.message ?? "insert failed"}`);
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

  const { data: updatedRows, error } = await admin
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
    .eq("status", "running")
    .select("id");

  if (error) throw new Error(`${TABLE}: ${error.message}`);

  if (updatedRows && updatedRows.length > 0) return;

  const { data: existing, error: readErr } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .select("id,status")
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .maybeSingle();
  if (readErr) throw new Error(`${TABLE}: ${readErr.message}`);
  if (existing && String(existing.status) === "completed") {
    return;
  }

  const detail = `runId=${runId} jobKey=${args.jobKey} currentStatus=${existing ? String(existing.status) : "missing"}`;
  console.error(`[${TABLE}] recordBitvavoSyncCompleted: update matched 0 rows while row was not completed (${detail})`);
  throw new Error(`${TABLE}: recordBitvavoSyncCompleted matched 0 rows (${detail})`);
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

  const { data: updatedRows, error } = await admin
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
    .eq("status", "running")
    .select("id");

  if (error) throw new Error(`${TABLE}: ${error.message}`);

  if (updatedRows && updatedRows.length > 0) return;

  const { data: existing, error: readErr } = await admin
    .schema(AUTOMATION_SCHEMA)
    .from(TABLE)
    .select("id,status")
    .eq("id", runId)
    .eq("job_key", args.jobKey)
    .maybeSingle();
  if (readErr) throw new Error(`${TABLE}: ${readErr.message}`);
  const st = existing ? String(existing.status) : "";
  if (st === "failed" || st === "skipped") {
    return;
  }

  const detail = `runId=${runId} jobKey=${args.jobKey} currentStatus=${st || "missing"}`;
  console.error(`[${TABLE}] recordBitvavoSyncFailed: update matched 0 rows (${detail})`);
  throw new Error(`${TABLE}: recordBitvavoSyncFailed matched 0 rows (${detail})`);
}
