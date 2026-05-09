import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginBitvavoSyncRun,
  COINGECKO_SYNC_JOB_METRICS,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  type BitvavoSyncTriggerSource,
} from "@/lib/markets/record-bitvavo-sync-status";
import {
  syncCoingeckoAssetMetricsMarketsPhase,
  syncCoingeckoAssetMetricsResolvePhase,
} from "@/lib/markets/sync-coingecko-metrics";
import { queueCoingeckoMetricsContinuation } from "@/lib/workers/queue-coingecko-metrics-continuation";

/** Same shape as candle sweep body: reuse `syncRunId` across chained QStash worker POSTs. */
export type CoingeckoMetricsSyncBody = {
  syncRunId?: string | null;
  continuationDepth?: number;
};

/** Enough chained jobs to cover a large catalog (e.g. 100 × 200 searches). */
const MAX_COINGECKO_RESOLVE_CONTINUATION_DEPTH = 100;

export type CoingeckoMetricsSyncResult = {
  assetsConsidered: number;
  resolvedThisRun: number;
  /** Rows in `assets` patched with live CoinGecko /coins/markets fields this run. */
  assetsUpdated: number;
  searchFailures: string[];
  stillMissingCoingeckoId: number;
  searchAttemptsThisRun: number;
  continuationQueued: boolean;
  syncRunId: string | null;
};

/**
 * CoinGecko catalog metrics with `sync_runs` lifecycle (same pattern as EUR candle sweep):
 * 1. If `syncRunId` is set (e.g. follow-up POST), reuse that run — no new `begin` (same as passing `syncRunId` across candle chunks).
 * 2. Else insert `running` via `beginBitvavoSyncRun` (non-fatal if insert fails, like candle chunk 0).
 * 3. Resolve + markets for the full crypto catalog (QStash chains until every asset has `coingecko_id` or depth cap).
 * 4. Mark `completed` or `failed` on `runId`, non-fatal on status update errors.
 */
export async function runCoingeckoMetricsSyncWithSyncRun(
  admin: SupabaseClient,
  source: BitvavoSyncTriggerSource,
  body: CoingeckoMetricsSyncBody = {},
): Promise<CoingeckoMetricsSyncResult> {
  let runId: string | null = body.syncRunId ?? null;
  const continuationDepth =
    typeof body.continuationDepth === "number" &&
    Number.isFinite(body.continuationDepth) &&
    body.continuationDepth >= 0
      ? Math.min(Math.floor(body.continuationDepth), MAX_COINGECKO_RESOLVE_CONTINUATION_DEPTH)
      : 0;

  if (!runId) {
    try {
      runId = await beginBitvavoSyncRun(admin, COINGECKO_SYNC_JOB_METRICS, source);
    } catch {
      /* non-fatal — same as candle sweep when begin throws */
    }
  }

  try {
    const p1 = await syncCoingeckoAssetMetricsResolvePhase(admin);
    const p2 = await syncCoingeckoAssetMetricsMarketsPhase(admin, p1.idByCoingecko);
    const stillMissing = p1.stillMissingCoingeckoId;
    const runIdForChain = runId;
    const needsMoreResolve =
      stillMissing > 0 &&
      runIdForChain != null &&
      continuationDepth < MAX_COINGECKO_RESOLVE_CONTINUATION_DEPTH;

    let continuationQueued = false;
    if (needsMoreResolve) {
      try {
        continuationQueued = await queueCoingeckoMetricsContinuation({
          syncRunId: runIdForChain,
          continuationDepth: continuationDepth + 1,
        });
      } catch {
        continuationQueued = false;
      }
    }

    const result: CoingeckoMetricsSyncResult = {
      assetsConsidered: p1.assetsConsidered,
      resolvedThisRun: p1.resolvedThisRun,
      assetsUpdated: p2.assetsUpdated,
      searchFailures: p1.searchFailures,
      stillMissingCoingeckoId: stillMissing,
      searchAttemptsThisRun: p1.searchAttemptsThisRun,
      continuationQueued,
      syncRunId: runId,
    };

    if (runId && !continuationQueued) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: COINGECKO_SYNC_JOB_METRICS,
          source,
        });
      } catch {
        /* non-fatal */
      }
    }

    return result;
  } catch (e) {
    if (runId) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId,
          jobKey: COINGECKO_SYNC_JOB_METRICS,
          source,
          failedReason: e instanceof Error ? e.message : "sync failed",
        });
      } catch {
        /* non-fatal */
      }
    }
    throw e;
  }
}
