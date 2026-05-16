"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import {
  runMarketBackfillCandles,
  todayUtcYmd,
} from "@/lib/orchestrators/market-backfill-candles.service";
import {
  fetchEarliestStoredCandleDate,
  runMarketBackfillSignals,
} from "@/lib/orchestrators/market-backfill-signals.service";
import {
  RELAY_BACKFILL_WINDOW_CHUNK_DAYS,
  splitDateRangeInChunks,
} from "@/lib/relay/date-window-chunks";
import {
  buildMarketBackfillCandlesWorkerUrl,
  buildMarketBackfillSignalsWorkerUrl,
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  makeRelayClient,
  RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S,
  RELAY_MARKET_BACKFILL_SIGNALS_TIMEOUT_S,
  relayMaxRetries,
  toRelayOriginAndPaths,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EnqueueMarketBackfillCandlesResult =
  | {
      ok: true;
      /** True when handed off to Relay; false when the worker ran inline (no Relay env). */
      queued: boolean;
      /** Relay `message_group.id` when queued. */
      groupId?: string;
      /** Number of chunked Relay messages enqueued. */
      chunkCount?: number;
      /** Inline result (only when `queued === false`). */
      candleRowsUpserted?: number;
    }
  | { ok: false; error: string };

/**
 * Backfill candles for one market over a UTC window. Splits the window into
 * {@link RELAY_BACKFILL_WINDOW_CHUNK_DAYS}-day chunks and enqueues one Relay message per chunk as a
 * single `message-group`; falls back to a single inline run when Relay is not configured.
 */
export async function enqueueMarketBackfillCandlesViaRelay(args: {
  marketId: string;
  startDate: string;
  endDate?: string | null;
}): Promise<EnqueueMarketBackfillCandlesResult> {
  const marketId = args.marketId.trim();
  const startDate = args.startDate.trim();
  const rawEnd = (args.endDate ?? "").trim();
  const endDate = rawEnd || todayUtcYmd();

  if (!marketId) return { ok: false, error: "Market id is required." };
  if (!ISO_DATE_RE.test(startDate)) return { ok: false, error: "Start date must be a YYYY-MM-DD UTC date." };
  if (!ISO_DATE_RE.test(endDate)) return { ok: false, error: "End date must be a YYYY-MM-DD UTC date." };
  if (startDate > endDate) return { ok: false, error: "Start date must be on or before end date." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  try {
    if (await isRelayWorkerEnqueueConfigured()) {
      const relay = makeRelayClient();
      const appBase = getAppBaseUrl();
      const chunks = splitDateRangeInChunks(startDate, endDate, RELAY_BACKFILL_WINDOW_CHUNK_DAYS);
      const urls = chunks.map((c) =>
        buildMarketBackfillCandlesWorkerUrl(appBase, { marketId, startDate: c.startDate, endDate: c.endDate }),
      );
      const { origin, paths } = toRelayOriginAndPaths(urls);
      const { message_group } = await relay.messageGroups.create({
        origin,
        paths,
        method: "POST",
        headers: await downstreamWorkerHeaders(),
        maxRetries: relayMaxRetries(),
        timeout: RELAY_MARKET_BACKFILL_CANDLES_TIMEOUT_S,
      });
      return { ok: true, queued: true, groupId: message_group.id, chunkCount: urls.length };
    }

    const admin = createServiceRoleClient();
    const result = await runMarketBackfillCandles(admin, { marketId, startDate, endDate });
    revalidatePath(`/markets/${marketId}`);
    return { ok: true, queued: false, candleRowsUpserted: result.candleRowsUpserted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type EnqueueMarketBackfillSignalsResult =
  | {
      ok: true;
      /** True when handed off to Relay; false when the worker ran inline (no Relay env). */
      queued: boolean;
      /** Resolved start date used for chunking (earliest stored close time when not user-provided). */
      startDate: string;
      /** Resolved end date used for chunking (today UTC by default). */
      endDate: string;
      /** Relay `message_group.id` when queued. */
      groupId?: string;
      /** Number of chunked Relay messages enqueued. */
      chunkCount?: number;
      /** Inline result (only when `queued === false`). */
      barsInspected?: number;
      barsSkippedComplete?: number;
      barsFilled?: number;
      signalsUpsertedTotal?: number;
    }
  | { ok: false; error: string };

/**
 * Backfill signals for one market: walks every stored candle and only generates `trading.signals` for
 * agents that have not yet produced a signal for that bar. Splits the resolved window into
 * {@link RELAY_BACKFILL_WINDOW_CHUNK_DAYS}-day chunks and enqueues one Relay message per chunk as a
 * single `message-group`; falls back to a single inline run when Relay is not configured.
 */
export async function enqueueMarketBackfillSignalsViaRelay(
  marketId: string,
): Promise<EnqueueMarketBackfillSignalsResult> {
  const id = marketId.trim();
  if (!id) return { ok: false, error: "Market id is required." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  try {
    const admin = createServiceRoleClient();
    const earliest = await fetchEarliestStoredCandleDate(admin, id);
    if (!earliest) {
      return { ok: false, error: 'No candles found for this market — run "Backfill candles" first.' };
    }
    const endDate = todayUtcYmd();
    if (earliest > endDate) {
      return { ok: false, error: "Earliest stored candle is in the future — nothing to backfill." };
    }

    if (await isRelayWorkerEnqueueConfigured()) {
      const relay = makeRelayClient();
      const appBase = getAppBaseUrl();
      const chunks = splitDateRangeInChunks(earliest, endDate, RELAY_BACKFILL_WINDOW_CHUNK_DAYS);
      const urls = chunks.map((c) =>
        buildMarketBackfillSignalsWorkerUrl(appBase, { marketId: id, startDate: c.startDate, endDate: c.endDate }),
      );
      const { origin, paths } = toRelayOriginAndPaths(urls);
      const { message_group } = await relay.messageGroups.create({
        origin,
        paths,
        method: "POST",
        headers: await downstreamWorkerHeaders(),
        maxRetries: relayMaxRetries(),
        timeout: RELAY_MARKET_BACKFILL_SIGNALS_TIMEOUT_S,
      });
      return { ok: true, queued: true, startDate: earliest, endDate, groupId: message_group.id, chunkCount: urls.length };
    }

    const result = await runMarketBackfillSignals(admin, { marketId: id, startDate: earliest, endDate });
    revalidatePath(`/markets/${id}`);
    revalidatePath("/signals");
    return {
      ok: true,
      queued: false,
      startDate: earliest,
      endDate,
      barsInspected: result.barsInspected,
      barsSkippedComplete: result.barsSkippedComplete,
      barsFilled: result.barsFilled,
      signalsUpsertedTotal: result.signalsUpsertedTotal,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
