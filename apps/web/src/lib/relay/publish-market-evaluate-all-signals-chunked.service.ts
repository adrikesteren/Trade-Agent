import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

import {
  buildMarketEvaluateAllSignalsWorkerUrl,
  downstreamWorkerHeaders,
  postRelayMessageGroup,
  postRelaySingleMessage,
  relayMaxRetries,
  RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S,
} from "./relay-symbol-close-pipeline-client";
import {
  chunkUtcDateRange,
  ymdToEndOfDayIsoUtc,
  ymdToStartOfDayIsoUtc,
  type UtcDateChunk,
} from "./chunk-utc-date-range";

/**
 * Default chunk width for the "Evaluate signals" / "Re-evaluate regime" header actions.
 * Each chunk becomes one Relay message inside a sequential message group and only
 * processes bars whose `closeTime` falls inside the chunk's UTC day window. The worker
 * still loads the full market history per call so indicator-based agents (SMA / RSI /
 * regime classifier) get correct warmup; only the *processing* loop is sliced.
 *
 * 30 days × 96 bars/day = 2880 bars per chunk. Comfortable headroom under the per-
 * message Relay timeout in {@link RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S}.
 */
export const MARKET_EVALUATE_ALL_SIGNALS_CHUNK_DAYS = 30;

export type PublishMarketEvaluateAllSignalsChunkedRelayResult =
  | {
      ok: true;
      /** UTC day chunks the market's candle history was sliced into. May be empty. */
      chunks: UtcDateChunk[];
      groupId: string | null;
      messageIds: string[];
      /** Total candle rows the chunking decision was based on. */
      candleTotal: number;
    }
  | { ok: false; error: string };

type CandleBound = {
  /** Earliest UTC `YYYY-MM-DD` covered by the market's storage-timeframe candle history. */
  firstDateUtc: string | null;
  /** Latest UTC `YYYY-MM-DD` covered by the market's storage-timeframe candle history. */
  lastDateUtc: string | null;
  /** Total `catalog.candles` rows for this market on the storage timeframe. */
  candleTotal: number;
};

function unwrapTsCloseTime(raw: unknown): string | null {
  if (raw == null) return null;
  const obj = (Array.isArray(raw) ? raw[0] : raw) as { close_time?: string | null } | null;
  const v = obj?.close_time?.trim();
  return v ? v : null;
}

/**
 * Reads the (first, last, count) of a market's storage-timeframe candle history. The
 * `close_time` column lives on `catalog.candle_timestamps`, joined from
 * `catalog.candles` via `candle_timestamp_id`, so we order on the foreign table — same
 * pattern as `fetchAllStoredBarsAsc` in `market-evaluate-all-signals.service.ts`.
 */
async function fetchMarketCandleDateBounds(
  admin: SupabaseClient,
  marketId: string,
): Promise<CandleBound> {
  const [{ data: first, error: e1 }, { data: last, error: e2 }, { count, error: e3 }] = await Promise.all([
    admin
      .schema("catalog")
      .from("candles")
      .select("candle_timestamps ( close_time )")
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
      .order("close_time", { ascending: true, foreignTable: "candle_timestamps" })
      .limit(1)
      .maybeSingle(),
    admin
      .schema("catalog")
      .from("candles")
      .select("candle_timestamps ( close_time )")
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME)
      .order("close_time", { ascending: false, foreignTable: "candle_timestamps" })
      .limit(1)
      .maybeSingle(),
    admin
      .schema("catalog")
      .from("candles")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId)
      .eq("timeframe", CATALOG_STORAGE_TIMEFRAME),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (e3) throw new Error(e3.message);

  const firstIso = unwrapTsCloseTime((first as { candle_timestamps?: unknown } | null)?.candle_timestamps);
  const lastIso = unwrapTsCloseTime((last as { candle_timestamps?: unknown } | null)?.candle_timestamps);
  return {
    firstDateUtc: firstIso ? firstIso.slice(0, 10) : null,
    lastDateUtc: lastIso ? lastIso.slice(0, 10) : null,
    candleTotal: typeof count === "number" ? count : 0,
  };
}

/**
 * Splits the market's candle history into UTC day chunks of
 * {@link MARKET_EVALUATE_ALL_SIGNALS_CHUNK_DAYS} days, builds one
 * {@link buildMarketEvaluateAllSignalsWorkerUrl} per chunk (with `closeTimeGteIso` /
 * `closeTimeLteIso` set to the chunk's UTC day window), and publishes them to Relay
 * either as a single message (1 chunk / 0 candles) or as a sequential message group.
 *
 * The per-message Relay timeout ({@link RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S} =
 * 10 min) is only attached on the single-message fallback. The message-group path
 * inherits Relay's default per-message timeout because the current
 * `postRelayMessageGroup` body shape does not yet support per-message overrides.
 */
export async function publishMarketEvaluateAllSignalsChunkedRelay(args: {
  admin: SupabaseClient;
  relayBase: string;
  appBase: string;
  marketId: string;
  forceAgentSlugs?: readonly string[];
  /** Override the default chunk width. Mostly for tests / one-off ops calls. */
  chunkDays?: number;
}): Promise<PublishMarketEvaluateAllSignalsChunkedRelayResult> {
  const marketId = args.marketId.trim();
  if (!marketId) return { ok: false, error: "marketId is required." };

  let bounds: CandleBound;
  try {
    bounds = await fetchMarketCandleDateBounds(args.admin, marketId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // No candles → still publish one Relay message so the worker can record an empty
  // sync run. Don't bother computing chunk windows.
  if (!bounds.firstDateUtc || !bounds.lastDateUtc) {
    const url = buildMarketEvaluateAllSignalsWorkerUrl(args.appBase, marketId, {
      ...(args.forceAgentSlugs && args.forceAgentSlugs.length > 0
        ? { forceAgentSlugs: args.forceAgentSlugs }
        : {}),
    });
    try {
      const headers = await downstreamWorkerHeaders();
      const id = await postRelaySingleMessage(args.relayBase, url, headers, relayMaxRetries(), {
        timeoutSec: RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S,
      });
      return { ok: true, chunks: [], groupId: null, messageIds: [id], candleTotal: 0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const chunkDays =
    args.chunkDays && args.chunkDays > 0 ? args.chunkDays : MARKET_EVALUATE_ALL_SIGNALS_CHUNK_DAYS;

  let chunks: UtcDateChunk[];
  try {
    chunks = chunkUtcDateRange(bounds.firstDateUtc, bounds.lastDateUtc, chunkDays);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (chunks.length === 0) {
    return { ok: false, error: "No chunks produced for the market candle range." };
  }

  const headers = await downstreamWorkerHeaders();
  const maxRetries = relayMaxRetries();
  const forceSlugs =
    args.forceAgentSlugs && args.forceAgentSlugs.length > 0 ? args.forceAgentSlugs : undefined;

  const urls = chunks.map((c) =>
    buildMarketEvaluateAllSignalsWorkerUrl(args.appBase, marketId, {
      ...(forceSlugs ? { forceAgentSlugs: forceSlugs } : {}),
      closeTimeGteIso: ymdToStartOfDayIsoUtc(c.startDate),
      closeTimeLteIso: ymdToEndOfDayIsoUtc(c.endDate),
    }),
  );

  try {
    if (urls.length === 1) {
      const id = await postRelaySingleMessage(args.relayBase, urls[0]!, headers, maxRetries, {
        timeoutSec: RELAY_MARKET_EVALUATE_ALL_SIGNALS_TIMEOUT_S,
      });
      return { ok: true, chunks, groupId: null, messageIds: [id], candleTotal: bounds.candleTotal };
    }
    const { groupId, messageIds } = await postRelayMessageGroup(
      args.relayBase,
      urls,
      headers,
      maxRetries,
    );
    return { ok: true, chunks, groupId, messageIds, candleTotal: bounds.candleTotal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
