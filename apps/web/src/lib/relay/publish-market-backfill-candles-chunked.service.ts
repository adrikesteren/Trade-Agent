import "server-only";

import { todayUtcYmd } from "@/lib/orchestrators/market-backfill-candles.service";

import {
  buildMarketBackfillCandlesWorkerUrl,
  downstreamWorkerHeaders,
  postRelayMessageGroup,
  postRelaySingleMessage,
  relayMaxRetries,
  RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S,
} from "./relay-symbol-close-pipeline-client";
import { chunkUtcDateRange, type UtcDateChunk } from "./chunk-utc-date-range";

/**
 * Default chunk width for the "Backfill candles" header action. Each chunk becomes one
 * Relay message inside a sequential message group. 30 days × 96 bars/day = 2880 bars per
 * chunk — well under Bitvavo's 1440-bar HTTP page (so ~2 page calls) and under the per-
 * message timeout in {@link RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S}.
 *
 * The historical executor `Run` button intentionally does NOT use this chunked path; it
 * still fires a single Relay message via `enqueueHistoricalExecutorReplay…`.
 */
export const MARKET_BACKFILL_CANDLES_CHUNK_DAYS = 30;

export type PublishMarketBackfillCandlesChunkedRelayResult =
  | {
      ok: true;
      chunks: UtcDateChunk[];
      groupId: string | null;
      messageIds: string[];
    }
  | { ok: false; error: string };

/**
 * Splits a `[startDate, endDate]` UTC backfill window into chunks of
 * {@link MARKET_BACKFILL_CANDLES_CHUNK_DAYS} days, builds one
 * {@link buildMarketBackfillCandlesWorkerUrl} per chunk, and publishes them to Relay
 * either as a single message (1 chunk) or as a sequential message group (N chunks).
 *
 * The per-message Relay timeout ({@link RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S} = 30 min)
 * is only attached on the single-message fallback. The message-group path inherits
 * Relay's default per-message timeout because the current `postRelayMessageGroup` body
 * shape doesn't support per-message overrides.
 */
export async function publishMarketBackfillCandlesChunkedRelay(args: {
  relayBase: string;
  appBase: string;
  marketId: string;
  startDate: string;
  endDate?: string | null;
  /** Override the default chunk width. Mostly for tests / one-off ops calls. */
  chunkDays?: number;
}): Promise<PublishMarketBackfillCandlesChunkedRelayResult> {
  const start = args.startDate.trim();
  const end = (args.endDate ?? "").trim() || todayUtcYmd();
  const chunkDays = args.chunkDays && args.chunkDays > 0 ? args.chunkDays : MARKET_BACKFILL_CANDLES_CHUNK_DAYS;

  let chunks: UtcDateChunk[];
  try {
    chunks = chunkUtcDateRange(start, end, chunkDays);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (chunks.length === 0) {
    return { ok: false, error: "No chunks produced for the given date range." };
  }

  const headers = await downstreamWorkerHeaders();
  const maxRetries = relayMaxRetries();
  const urls = chunks.map((c) =>
    buildMarketBackfillCandlesWorkerUrl(args.appBase, {
      marketId: args.marketId.trim(),
      startDate: c.startDate,
      endDate: c.endDate,
    }),
  );

  try {
    if (urls.length === 1) {
      const id = await postRelaySingleMessage(args.relayBase, urls[0]!, headers, maxRetries, {
        timeoutSec: RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S,
      });
      return { ok: true, chunks, groupId: null, messageIds: [id] };
    }
    const { groupId, messageIds } = await postRelayMessageGroup(
      args.relayBase,
      urls,
      headers,
      maxRetries,
    );
    return { ok: true, chunks, groupId, messageIds };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
