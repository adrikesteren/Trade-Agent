import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types — one per unique select-shape used by callers.
// ──────────────────────────────────────────────────────────────────────────────

/** Narrow id projection (existence check / id-only lookup). */
export type CandleTimestampIdRow = { id: string };

/** Latest-close-time projection. */
export type CandleTimestampCloseTimeRow = { close_time: string | null };

/** Full `id, open_time, close_time` projection used by candle window upsert flows. */
export type CandleTimestampRow = {
  id: string;
  open_time: string;
  close_time: string;
};

/** Open/close pair payload used by bulk-upsert window seeding. */
export type CandleTimestampPairInsert = { open_time: string; close_time: string };

/**
 * PostgREST caps result sets (`[api] max_rows`, often 1000). Unpaginated selects silently truncate,
 * which breaks historical/window candle sync beyond the first page.
 */
export const CATALOG_CANDLE_TIMESTAMPS_FETCH_PAGE_SIZE = 1000;

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/** `select("id") .eq("id", id) .maybeSingle()` — existence check. */
export async function selectById(
  client: SupabaseClient,
  id: string,
): Promise<CandleTimestampIdRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CandleTimestampIdRow | null) ?? null;
}

/** `select("id", { count: "exact", head: true })` — total row count. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `select("close_time") .order(desc) .limit(1) .maybeSingle()` — latest close_time. */
export async function selectLatestCloseTime(
  client: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .select("close_time")
    .order("close_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const t = (data as CandleTimestampCloseTimeRow | null)?.close_time;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * `select("id") .gte("close_time", gte) .lte("close_time", lte) .order(close_time asc) .range(from, to)`
 * — one paginated chunk of ids whose `close_time` falls in `[gte, lte]`.
 */
export async function selectIdsInCloseTimeRangePaginated(
  client: SupabaseClient,
  args: { closeTimeGteIso: string; closeTimeLteIso: string; from: number; to: number },
): Promise<CandleTimestampIdRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .select("id")
    .gte("close_time", args.closeTimeGteIso)
    .lte("close_time", args.closeTimeLteIso)
    .order("close_time", { ascending: true })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleTimestampIdRow[];
}

/**
 * `select("id, open_time, close_time") .gte("open_time", gte) .lte("close_time", lte)
 *   .order(open_time asc) .range(from, to)`
 * — one paginated chunk of full rows overlapping a Bitvavo candle window.
 */
export async function selectRowsForCandleWindowPaginated(
  client: SupabaseClient,
  args: { openTimeGteIso: string; closeTimeLteIso: string; from: number; to: number },
): Promise<CandleTimestampRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .select("id, open_time, close_time")
    .gte("open_time", args.openTimeGteIso)
    .lte("close_time", args.closeTimeLteIso)
    .order("open_time", { ascending: true })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleTimestampRow[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(pair, { onConflict: "open_time,close_time" }) .select("id") .single()`
 * — single-pair upsert returning the new (or existing) id. Throws if the upsert returns no id.
 */
export async function upsertOneReturningId(
  client: SupabaseClient,
  pair: CandleTimestampPairInsert,
): Promise<string> {
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .upsert(pair, { onConflict: "open_time,close_time" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error("candle_timestamps upsert returned no id");
  return id;
}

/**
 * `upsert(pairs, { onConflict: "open_time,close_time" }) .select("id, open_time, close_time")`
 * — bulk upsert returning the (id, open_time, close_time) rows so callers can map back to bars.
 */
export async function upsertManyReturningRows(
  client: SupabaseClient,
  pairs: CandleTimestampPairInsert[],
): Promise<CandleTimestampRow[]> {
  if (pairs.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .upsert(pairs, { onConflict: "open_time,close_time" })
    .select("id, open_time, close_time");
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleTimestampRow[];
}

/**
 * `upsert(pairs, { onConflict: "open_time,close_time" })` — fire-and-forget bulk upsert
 * used by window seeding (no returning rows). Caller is responsible for chunking large arrays.
 */
export async function upsertManyPairs(
  client: SupabaseClient,
  pairs: CandleTimestampPairInsert[],
): Promise<void> {
  if (pairs.length === 0) return;
  const { error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .upsert(pairs, { onConflict: "open_time,close_time" });
  if (error) throw new Error(error.message);
}

/** `delete() .lt("close_time", cutoff)` — retention prune of expired rows (candles cascade). */
export async function deleteOlderThanCloseTime(
  client: SupabaseClient,
  cutoffIso: string,
): Promise<void> {
  const { error } = await client
    .schema("catalog")
    .from("candle_timestamps")
    .delete()
    .lt("close_time", cutoffIso);
  if (error) throw new Error(error.message);
}
