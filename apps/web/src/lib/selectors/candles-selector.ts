import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Row types — one per unique embed-shape used by callers.
// ──────────────────────────────────────────────────────────────────────────────

/** Bulk catalog-bar lookup row (`id, market_id, timeframe, close, candle_timestamps(close_time)`). */
export type CandleBarWithCloseTimeRow = {
  id: string;
  market_id: string;
  timeframe: string;
  close: unknown;
  candle_timestamps:
    | { close_time: string | null }
    | { close_time: string | null }[]
    | null;
};

/** `candle_timestamps(close_time)` only — earliest stored close-time lookup. */
export type CandleCloseTimeOnlyRow = {
  candle_timestamps:
    | { close_time?: string | null }
    | { close_time?: string | null }[]
    | null;
};

/** Mediator find-bar row (`id, close, candle_timestamps(open_time, close_time)`). */
export type CandleBarWithOpenCloseRow = {
  id: string;
  close: string | number;
  candle_timestamps:
    | { open_time: string; close_time: string }
    | { open_time: string; close_time: string }[]
    | null;
};

/** OHLCV row with `id` and embedded open/close times (executor, replay, signals). */
export type CandleOhlcvWithOpenCloseRow = {
  id: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  candle_timestamps:
    | { open_time: string; close_time: string }
    | { open_time: string; close_time: string }[]
    | null;
};

/** OHLCV row without `id` (market chart projection). */
export type CandleOhlcvRow = {
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  candle_timestamps: unknown;
};

/** Latest-close-by-market projection (`market_id, close, candle_timestamps(close_time)`). */
export type CandleMarketCloseRow = {
  market_id: string;
  close: unknown;
  candle_timestamps:
    | { close_time?: string | null }
    | { close_time?: string | null }[]
    | null;
};

/** Bar metadata projection used by the market detail page (`id, timeframe, candle_timestamps(close_time)`). */
export type CandleIdTimeframeCloseRow = {
  id: string;
  timeframe: string;
  candle_timestamps:
    | { close_time?: string | null }
    | { close_time?: string | null }[]
    | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("id, market_id, timeframe, close, candle_timestamps(close_time)") .in("id", ids)`
 * — batch lookup by PK used when PostgREST can't embed via a parent table.
 */
export async function selectBarsWithCloseTimeByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<CandleBarWithCloseTimeRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, market_id, timeframe, close, candle_timestamps ( close_time )")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleBarWithCloseTimeRow[];
}

/**
 * `select("candle_timestamps(close_time)") .eq("market_id", x) .eq("timeframe", t)
 *   .order("close_time", asc, foreignTable: candle_timestamps) .limit(1)`
 * — earliest stored close-time for a market on a timeframe.
 */
export async function selectEarliestCloseTimeForMarket(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string },
): Promise<CandleCloseTimeOnlyRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("candle_timestamps ( close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleCloseTimeOnlyRow[];
}

/**
 * `select("id, close, candle_timestamps(open_time, close_time)") .eq("market_id", x)
 *   .eq("timeframe", t) .limit(N)` — mediator findBar projection.
 */
export async function selectBarsWithOpenCloseForMarket(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; limit: number },
): Promise<CandleBarWithOpenCloseRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, close, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleBarWithOpenCloseRow[];
}

/**
 * `select("id, open, high, low, close, volume, candle_timestamps(open_time, close_time)")
 *   .eq("market_id", x) .eq("timeframe", t) .limit(N)` — executor / replay OHLCV projection.
 */
export async function selectOhlcvWithOpenCloseForMarket(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; limit: number },
): Promise<CandleOhlcvWithOpenCloseRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleOhlcvWithOpenCloseRow[];
}

/**
 * Same projection as {@link selectOhlcvWithOpenCloseForMarket} but using `!inner` on
 * `candle_timestamps` + `order(close_time desc)` so the latest closed bar is included
 * when the bar limit is smaller than the stored history (signals path).
 */
export async function selectOhlcvWithOpenCloseInnerOrderedDescForMarket(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; limit: number },
): Promise<CandleOhlcvWithOpenCloseRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, open, high, low, close, volume, candle_timestamps!inner ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .order("close_time", { ascending: false, foreignTable: "candle_timestamps" })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleOhlcvWithOpenCloseRow[];
}

/**
 * `select("id, open, high, low, close, volume, candle_timestamps(open_time, close_time)")
 *   .eq("market_id", x) .eq("timeframe", t) .in("candle_timestamp_id", ids)`
 * — replay load by pre-resolved candle_timestamp ids (URI-budget chunked by caller).
 */
export async function selectOhlcvWithOpenCloseByCandleTimestampIds(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; candleTimestampIds: string[] },
): Promise<CandleOhlcvWithOpenCloseRow[]> {
  if (args.candleTimestampIds.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .in("candle_timestamp_id", args.candleTimestampIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleOhlcvWithOpenCloseRow[];
}

/**
 * `select("open, high, low, close, volume, candle_timestamps(open_time, close_time)")
 *   .eq("market_id", x) .eq("timeframe", t) .order(close_time asc, fk) .range(from, to)`
 * — market-chart OHLCV page (no `id`).
 */
export async function selectOhlcvPaginatedForMarket(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; from: number; to: number },
): Promise<CandleOhlcvRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("open, high, low, close, volume, candle_timestamps ( open_time, close_time )")
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleOhlcvRow[];
}

/**
 * `select("market_id, close, candle_timestamps(close_time)") .eq("timeframe", t)
 *   .in("market_id", ids)` — latest-close lookup batch by market ids.
 */
export async function selectMarketCloseByMarketIdsAndTimeframe(
  client: SupabaseClient,
  args: { marketIds: string[]; timeframe: string },
): Promise<CandleMarketCloseRow[]> {
  if (args.marketIds.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("market_id, close, candle_timestamps ( close_time )")
    .eq("timeframe", args.timeframe)
    .in("market_id", args.marketIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleMarketCloseRow[];
}

/**
 * `select("id, timeframe, candle_timestamps(close_time)") .eq("market_id", x)
 *   .order(close_time desc, fk) .limit(N)` — market detail page bar metadata.
 */
export async function selectIdTimeframeCloseForMarketLatest(
  client: SupabaseClient,
  args: { marketId: string; limit: number },
): Promise<CandleIdTimeframeCloseRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id, timeframe, candle_timestamps ( close_time )")
    .eq("market_id", args.marketId)
    .order("close_time", { ascending: false, foreignTable: "candle_timestamps" })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CandleIdTimeframeCloseRow[];
}

/**
 * `select("id", { count: "exact", head: true }) .eq("market_id", x) .eq("timeframe", t)
 *   .in("candle_timestamp_id", ids)` — count rows for a market on a timeframe within a
 * pre-resolved candle_timestamp_id batch (URI-budget chunked by caller).
 */
export async function countByMarketTimeframeAndCandleTimestampIds(
  client: SupabaseClient,
  args: { marketId: string; timeframe: string; candleTimestampIds: string[] },
): Promise<number> {
  if (args.candleTimestampIds.length === 0) return 0;
  const { count, error } = await client
    .schema("catalog")
    .from("candles")
    .select("id", { count: "exact", head: true })
    .eq("market_id", args.marketId)
    .eq("timeframe", args.timeframe)
    .in("candle_timestamp_id", args.candleTimestampIds);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(rows, { onConflict: "market_id,timeframe,candle_timestamp_id" })`
 * — bulk OHLCV upsert. The caller is responsible for chunking large arrays.
 */
export async function upsertManyByMarketTimeframeCandleTs(
  client: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .schema("catalog")
    .from("candles")
    .upsert(rows, { onConflict: "market_id,timeframe,candle_timestamp_id" });
  if (error) throw new Error(error.message);
}
