import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANDLE_RETENTION_HOURS,
  CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS,
} from "@/lib/agents/ingest/services/candle-retention.service";
import { patchSyncRunMetadata } from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";

/** `automation.sync_runs.metadata` — open_time (ISO) of the first candle bucket in this run. */
export const CANDLE_SYNC_META_WINDOW_START_OPEN = "candleSyncWindowStartOpen";
/** `automation.sync_runs.metadata` — close_time (ISO) of the last fully closed bucket in this run. */
export const CANDLE_SYNC_META_WINDOW_END_CLOSE = "candleSyncWindowEndClose";
/** `automation.sync_runs.metadata` — number of `catalog.candle_timestamps` buckets in [start, end]. */
export const CANDLE_SYNC_META_WINDOW_BAR_COUNT = "candleSyncWindowBarCount";
/** When true, the run completed immediately (nothing to fetch). */
export const CANDLE_SYNC_META_EMPTY_WINDOW = "emptyWindow";

/** Close time of the last fully closed bar at or before `nowMs` (grid from Unix epoch). */
export function floorLastClosedCloseMs(nowMs: number, stepMs: number): number {
  return Math.floor(nowMs / stepMs) * stepMs;
}

/** Smallest bar open time on the grid that is >= `tMs`. */
export function ceilBarOpenMs(tMs: number, stepMs: number): number {
  return Math.ceil(tMs / stepMs) * stepMs;
}

export type CandleSyncWindowCompute =
  | { kind: "empty" }
  | { kind: "ok"; startOpenMs: number; endCloseMs: number; barCount: number };

/**
 * Computes the candle timestamp window: end = last closed bucket close from "now";
 * start = last stored close as next open, or an initial-history floor when the table is empty
 * (see `CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS`), else `retentionHours` when rows exist but
 * the latest close is missing.
 */
export async function computeCandleSyncWindow(
  admin: SupabaseClient,
  timeframe: string,
  retentionHours = CANDLE_RETENTION_HOURS,
): Promise<CandleSyncWindowCompute> {
  const stepMs = timeframeDurationMs(timeframe);
  const nowMs = Date.now();
  const endCloseMs = floorLastClosedCloseMs(nowMs, stepMs);

  const { count, error: cntErr } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .select("id", { count: "exact", head: true });

  if (cntErr) throw new Error(`candle_timestamps: ${cntErr.message}`);

  let startOpenMs: number;

  if ((count ?? 0) === 0) {
    const cutoffMs = nowMs - CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS * 60 * 60 * 1000;
    startOpenMs = ceilBarOpenMs(cutoffMs, stepMs);
  } else {
    const { data: lastRow, error: lastErr } = await admin
      .schema("catalog")
      .from("candle_timestamps")
      .select("close_time")
      .order("close_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) throw new Error(`candle_timestamps: ${lastErr.message}`);
    const lastCloseIso = lastRow?.close_time as string | undefined;
    if (!lastCloseIso) {
      const cutoffMs = nowMs - CATALOG_INITIAL_EMPTY_SYNC_HISTORY_HOURS * 60 * 60 * 1000;
      startOpenMs = ceilBarOpenMs(cutoffMs, stepMs);
    } else {
      const lastCloseMs = Date.parse(lastCloseIso);
      if (!Number.isFinite(lastCloseMs)) {
        throw new Error("candle_timestamps: invalid close_time on latest row");
      }
      startOpenMs = lastCloseMs;
    }
  }

  if (startOpenMs >= endCloseMs) {
    return { kind: "empty" };
  }

  const span = endCloseMs - startOpenMs;
  if (span % stepMs !== 0) {
    throw new Error("candle sync window: start/end not aligned to timeframe grid");
  }
  const barCount = span / stepMs;
  if (!Number.isInteger(barCount) || barCount <= 0) {
    return { kind: "empty" };
  }

  return { kind: "ok", startOpenMs, endCloseMs, barCount };
}

/**
 * PostgREST caps result sets (`[api] max_rows`, often 1000). Unpaginated selects silently truncate,
 * which breaks historical/window candle sync beyond the first page.
 */
export const CATALOG_CANDLE_TIMESTAMPS_FETCH_PAGE_SIZE = 1000;

/** All `catalog.candle_timestamps.id` with `close_time` in `[gte, lte]` (ordered ascending). */
export async function fetchAllCandleTimestampIdsInCloseTimeRange(
  admin: SupabaseClient,
  args: { closeTimeGteIso: string; closeTimeLteIso: string },
): Promise<string[]> {
  const ids: string[] = [];
  const page = CATALOG_CANDLE_TIMESTAMPS_FETCH_PAGE_SIZE;
  for (let from = 0; ; from += page) {
    const to = from + page - 1;
    const { data, error } = await admin
      .schema("catalog")
      .from("candle_timestamps")
      .select("id")
      .gte("close_time", args.closeTimeGteIso)
      .lte("close_time", args.closeTimeLteIso)
      .order("close_time", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`candle_timestamps: ${error.message}`);
    const chunk = (data ?? []).map((r) => r.id as string).filter(Boolean);
    if (!chunk.length) break;
    ids.push(...chunk);
    if (chunk.length < page) break;
  }
  return ids;
}

/** All timestamp rows overlapping `[openTimeGteIso, closeTimeLteIso]` for Bitvavo candle upsert keying. */
export async function fetchAllCandleTimestampRowsForCandleWindow(
  admin: SupabaseClient,
  args: { openTimeGteIso: string; closeTimeLteIso: string },
): Promise<{ id: string; open_time: string; close_time: string }[]> {
  const rowsOut: { id: string; open_time: string; close_time: string }[] = [];
  const page = CATALOG_CANDLE_TIMESTAMPS_FETCH_PAGE_SIZE;
  for (let from = 0; ; from += page) {
    const to = from + page - 1;
    const { data, error } = await admin
      .schema("catalog")
      .from("candle_timestamps")
      .select("id, open_time, close_time")
      .gte("open_time", args.openTimeGteIso)
      .lte("close_time", args.closeTimeLteIso)
      .order("open_time", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`candle_timestamps: ${error.message}`);
    const chunk = (data ?? []) as { id: string; open_time: string; close_time: string }[];
    if (!chunk.length) break;
    rowsOut.push(...chunk);
    if (chunk.length < page) break;
  }
  return rowsOut;
}

export async function bulkUpsertCandleTimestampsForWindow(
  admin: SupabaseClient,
  startOpenMs: number,
  endCloseMs: number,
  stepMs: number,
): Promise<void> {
  const pairs: { open_time: string; close_time: string }[] = [];
  for (let open = startOpenMs; open + stepMs <= endCloseMs; open += stepMs) {
    pairs.push({
      open_time: new Date(open).toISOString(),
      close_time: new Date(open + stepMs).toISOString(),
    });
  }
  const batchSize = 500;
  for (let i = 0; i < pairs.length; i += batchSize) {
    const slice = pairs.slice(i, i + batchSize);
    const { error } = await admin
      .schema("catalog")
      .from("candle_timestamps")
      .upsert(slice, { onConflict: "open_time,close_time" });
    if (error) throw new Error(`candle_timestamps: ${error.message}`);
  }
}

/** Loads window bounds from a `sync_runs` row (after `prepareEurCandleSyncRunWindow`). */
export async function fetchCandleSyncWindowMeta(
  admin: SupabaseClient,
  runId: string,
  jobKey: string,
): Promise<{ startOpenIso: string; endCloseIso: string; barCount: number } | null> {
  const { data, error } = await admin
    .schema("automation")
    .from("sync_runs")
    .select("metadata")
    .eq("id", runId)
    .eq("job_key", jobKey)
    .maybeSingle();

  if (error) throw new Error(`sync_runs: ${error.message}`);
  return parseCandleSyncWindowFromMetadata(data?.metadata);
}

export function parseCandleSyncWindowFromMetadata(metadata: unknown): {
  startOpenIso: string;
  endCloseIso: string;
  barCount: number;
} | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  if (m[CANDLE_SYNC_META_EMPTY_WINDOW] === true) return null;
  const barCount = Number(m[CANDLE_SYNC_META_WINDOW_BAR_COUNT]);
  const start = m[CANDLE_SYNC_META_WINDOW_START_OPEN];
  const end = m[CANDLE_SYNC_META_WINDOW_END_CLOSE];
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  if (typeof start !== "string" || typeof end !== "string") return null;
  return { startOpenIso: start, endCloseIso: end, barCount };
}

export type PrepareEurCandleSyncRunWindowResult =
  | { kind: "empty" }
  | { kind: "ready"; startOpenIso: string; endCloseIso: string; barCount: number };

/**
 * Idempotent: if `sync_runs.metadata` already describes a prepared window, skips DB writes.
 * Otherwise computes the window, upserts `candle_timestamps`, and patches run metadata.
 */
export async function prepareEurCandleSyncRunWindow(
  admin: SupabaseClient,
  args: { runId: string; jobKey: string; timeframe: string },
): Promise<PrepareEurCandleSyncRunWindowResult> {
  const { data: row, error } = await admin
    .schema("automation")
    .from("sync_runs")
    .select("metadata")
    .eq("id", args.runId)
    .eq("job_key", args.jobKey)
    .maybeSingle();

  if (error) throw new Error(`sync_runs: ${error.message}`);

  const existing = parseCandleSyncWindowFromMetadata(row?.metadata);
  if (existing) {
    return {
      kind: "ready",
      startOpenIso: existing.startOpenIso,
      endCloseIso: existing.endCloseIso,
      barCount: existing.barCount,
    };
  }

  if (
    row?.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata) &&
    (row.metadata as Record<string, unknown>)[CANDLE_SYNC_META_EMPTY_WINDOW] === true
  ) {
    return { kind: "empty" };
  }

  const computed = await computeCandleSyncWindow(admin, args.timeframe);
  if (computed.kind === "empty") {
    await patchSyncRunMetadata(admin, {
      runId: args.runId,
      jobKey: args.jobKey,
      patch: {
        [CANDLE_SYNC_META_EMPTY_WINDOW]: true,
        [CANDLE_SYNC_META_WINDOW_BAR_COUNT]: 0,
      },
    });
    return { kind: "empty" };
  }

  const stepMs = timeframeDurationMs(args.timeframe);
  await bulkUpsertCandleTimestampsForWindow(
    admin,
    computed.startOpenMs,
    computed.endCloseMs,
    stepMs,
  );

  const startOpenIso = new Date(computed.startOpenMs).toISOString();
  const endCloseIso = new Date(computed.endCloseMs).toISOString();

  await patchSyncRunMetadata(admin, {
    runId: args.runId,
    jobKey: args.jobKey,
    patch: {
      [CANDLE_SYNC_META_WINDOW_START_OPEN]: startOpenIso,
      [CANDLE_SYNC_META_WINDOW_END_CLOSE]: endCloseIso,
      [CANDLE_SYNC_META_WINDOW_BAR_COUNT]: computed.barCount,
      [CANDLE_SYNC_META_EMPTY_WINDOW]: false,
    },
  });

  return {
    kind: "ready",
    startOpenIso,
    endCloseIso,
    barCount: computed.barCount,
  };
}
