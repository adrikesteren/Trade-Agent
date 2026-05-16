import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl } from "@/lib/env/app-base-url";
import * as ExecutorsSelector from "@/lib/selectors/executors-selector";
import { fetchHistoricalExecutorPaperMarket } from "@/lib/agents/executor/services/historical-paper-market.service";
import { fetchExchangeIdByCode } from "@/lib/agents/executor/services/executors-lookup.service";
import {
  downstreamWorkerHeaders,
  isRelayWorkerEnqueueConfigured,
  makeRelayClient,
  RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S,
  relayMaxRetries,
  toRelayOriginAndPath,
} from "@/lib/relay/relay-symbol-close-pipeline-client";
import { splitDateRangeInChunks } from "@/lib/relay/date-window-chunks";

/** 1 day = 96 bars on the 15m storage timeframe. Keeps per-message work bounded. */
const HISTORICAL_RUN_CHUNK_DAYS = 1;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EnqueueExecutorHistoricalRunResult =
  | { ok: true; queued: boolean; groupId?: string; chunkCount?: number; messageIds?: string[] }
  | { ok: false; error: string };

/**
 * Day-end UTC ISO close time (`YYYY-MM-DDT23:59:59.999Z`) for a `YYYY-MM-DD` date.
 * We use end-of-day as the synthetic "closeTime" so the pipeline ingests + replays everything
 * that closed during that UTC day.
 */
function endOfDayCloseIso(ymd: string): string {
  if (!ISO_DATE_RE.test(ymd)) throw new Error(`Invalid YYYY-MM-DD date: ${ymd}`);
  return `${ymd}T23:59:59.999Z`;
}

/**
 * Splits the executor's `[historical_start_date, historical_end_date]` window into 1-day chunks
 * (96 bars at 15m) and enqueues one Relay MessageGroup: one message per day, targeting
 * `/api/v1/orchestrator/close-candle-pipeline/{marketId}` with body `{ closeTimeIso, executorId }`.
 *
 * The MessageGroup processes strictly in submission order so days run sequentially. We use the
 * per-item shape (`messages[]`) because each message needs its own body (`closeTimeIso` differs).
 */
export async function enqueueExecutorHistoricalRun(
  admin: SupabaseClient,
  args: { executorId: string },
): Promise<EnqueueExecutorHistoricalRunResult> {
  const executorId = args.executorId.trim();
  if (!executorId) {
    return { ok: false, error: "executorId is required" };
  }

  // Load executor row (admin/no user scoping — caller is a worker route).
  const ex = await ExecutorsSelector.selectFullById(admin, executorId);
  if (!ex) return { ok: false, error: "executor_not_found" };
  if (ex.execution_mode !== "historical") {
    return { ok: false, error: "executor_not_historical_mode" };
  }
  if (!ex.enabled) {
    return { ok: false, error: "executor_not_enabled" };
  }

  const startDate = String(ex.historical_start_date ?? "").trim();
  const endDate = String(ex.historical_end_date ?? "").trim();
  if (!startDate || !endDate) {
    return { ok: false, error: "historical_dates_missing" };
  }
  if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
    return { ok: false, error: "historical_dates_invalid" };
  }
  if (startDate > endDate) {
    return { ok: false, error: "historical_start_after_end" };
  }

  const assetIds = (ex.filter_asset_ids ?? []).filter(Boolean);
  if (assetIds.length !== 1) {
    return { ok: false, error: "historical_requires_exactly_one_whitelisted_asset" };
  }
  const baseAssetId = assetIds[0]!;

  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(ex.exchange_id) !== bitvavoId) {
    return { ok: false, error: "historical_requires_bitvavo_exchange" };
  }

  // Resolve the Bitvavo EUR paper market for the whitelisted base asset.
  const paper = await fetchHistoricalExecutorPaperMarket(admin, {
    executorExchangeId: String(ex.exchange_id),
    filterBaseAssetId: baseAssetId,
  });
  if (!paper) {
    return { ok: false, error: "paper_market_not_found" };
  }
  const marketId = paper.marketId;

  // Split the inclusive window into 1-day chunks (last chunk may be the same day).
  const chunks = splitDateRangeInChunks(startDate, endDate, HISTORICAL_RUN_CHUNK_DAYS);
  if (chunks.length === 0) {
    return { ok: false, error: "no_chunks_produced" };
  }

  // Relay enqueue. When Relay is not configured we surface a clear error rather than
  // attempting an inline replay — this orchestrator's contract is "enqueue, not execute".
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

  // All chunks target the same shared origin/path but each carries a per-day body, so we use
  // the per-item shape. `splitDateRangeInChunks` returns each chunk's `endDate` inclusive — use
  // that as the day-end close time.
  const targetUrl = `${appBase}/api/v1/orchestrator/close-candle-pipeline/${encodeURIComponent(marketId)}`;
  const { origin, path } = toRelayOriginAndPath(targetUrl);

  const messages = chunks.map((chunk) => ({
    origin,
    path,
    method: "POST" as const,
    headers: workerHeaders,
    body: {
      closeTimeIso: endOfDayCloseIso(chunk.endDate),
      executorId,
    },
    maxRetries,
    timeout: RELAY_HISTORICAL_EXECUTOR_REPLAY_TIMEOUT_S,
  }));

  try {
    const { message_group, messages: created } = await relay.messageGroups.create({ messages });
    return {
      ok: true,
      queued: true,
      groupId: message_group.id,
      chunkCount: messages.length,
      messageIds: created.map((m) => m.id),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
