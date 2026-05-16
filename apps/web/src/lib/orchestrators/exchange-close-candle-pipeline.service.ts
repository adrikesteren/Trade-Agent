import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import {
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  makeRelayClient,
  relayMaxRetries,
  toRelayOriginAndPaths,
} from "@/lib/relay/relay-symbol-close-pipeline-client";

export type EnqueueExchangeClosePipelineResult =
  | { ok: true; queued: boolean; groupId?: string; chunkCount?: number; messageIds?: string[] }
  | { ok: false; error: string };

/**
 * For every `status = "trading"` market on the given exchange + quote (default EUR), enqueues
 * one Relay message targeting `/api/v1/orchestrator/close-candle-pipeline/{marketId}` (no body —
 * the pipeline picks live executors automatically when `closeTimeIso`/`executorId` are absent).
 *
 * Uses one MessageGroup so per-market work runs sequentially today (good for retry isolation +
 * predictable rate limit behaviour). When parallelism is needed later this can be swapped to N
 * independent `messages.enqueue` calls without touching the orchestrator contract.
 */
export async function enqueueExchangeClosePipeline(
  admin: SupabaseClient,
  args: { exchangeId: string; quoteCode?: string },
): Promise<EnqueueExchangeClosePipelineResult> {
  const exchangeId = args.exchangeId.trim();
  if (!exchangeId) {
    return { ok: false, error: "exchangeId is required" };
  }

  const quoteCode = (args.quoteCode ?? "EUR").trim().toUpperCase() || "EUR";
  const quoteAssetId = await resolveQuoteAssetId(admin, quoteCode);
  if (!quoteAssetId) {
    return { ok: false, error: "unknown_quote_asset" };
  }

  let markets: Awaited<ReturnType<typeof MarketsSelector.selectIdSymbolStatusByExchangeAndQuote>>;
  try {
    markets = await MarketsSelector.selectIdSymbolStatusByExchangeAndQuote(admin, {
      exchangeId,
      quoteAssetId,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Only active markets — halted/delisted markets are skipped here. Sort by `market_symbol`
  // for deterministic enqueue order (Relay processes in submission order within a group).
  const activeMarkets = markets
    .filter((m) => String(m.status).toLowerCase() === "trading" && Boolean(m.id))
    .sort((a, b) =>
      String(a.market_symbol ?? "").localeCompare(String(b.market_symbol ?? ""), undefined, {
        sensitivity: "base",
      }),
    );

  if (activeMarkets.length === 0) {
    return { ok: true, queued: false, chunkCount: 0, messageIds: [] };
  }

  if (!(await isRelayWorkerEnqueueConfigured())) {
    return { ok: false, error: "relay_worker_enqueue_not_configured" };
  }

  let relay: ReturnType<typeof makeRelayClient>;
  let appBase: string;
  let workerHeaders: Record<string, string>;
  let maxRetries: number;
  try {
    relay = makeRelayClient();
    appBase = getAppBaseUrl();
    workerHeaders = await downstreamWorkerHeaders();
    maxRetries = relayMaxRetries();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const urls = activeMarkets.map(
    (m) => `${appBase}/api/v1/orchestrator/close-candle-pipeline/${encodeURIComponent(m.id)}`,
  );

  try {
    const { origin, paths } = toRelayOriginAndPaths(urls);
    const { message_group, messages } = await relay.messageGroups.create({
      origin,
      paths,
      method: "POST",
      headers: workerHeaders,
      maxRetries,
    });
    return {
      ok: true,
      queued: true,
      groupId: message_group.id,
      chunkCount: messages.length,
      messageIds: messages.map((m) => m.id),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
