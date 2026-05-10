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

/** Optional: reuse an existing `sync_runs` row when callers pass `syncRunId`. */
export type CoingeckoMetricsSyncBody = {
  syncRunId?: string | null;
};

export type CoingeckoMetricsSyncResult = {
  assetsConsidered: number;
  resolvedThisRun: number;
  /** Rows in `assets` patched with live CoinGecko /coins/markets fields this run. */
  assetsUpdated: number;
  searchFailures: string[];
  /** Crypto rows without `coingecko_coin_id` (skipped; use coin-id sync to fill). */
  stillMissingCoingeckoId: number;
  searchAttemptsThisRun: number;
  /** Always false; kept for API compatibility with older clients. */
  continuationQueued: boolean;
  syncRunId: string | null;
};

/**
 * CoinGecko live metrics for catalog assets that already have `coingecko_coin_id` (markets phase only).
 * Id discovery is not done here — use the coin-id worker / manual sync.
 */
export async function runCoingeckoMetricsSyncWithSyncRun(
  admin: SupabaseClient,
  source: BitvavoSyncTriggerSource,
  body: CoingeckoMetricsSyncBody = {},
): Promise<CoingeckoMetricsSyncResult> {
  let runId: string | null = body.syncRunId ?? null;

  if (!runId) {
    try {
      const begun = await beginBitvavoSyncRun(admin, COINGECKO_SYNC_JOB_METRICS, source);
      if (begun.outcome === "skipped") {
        return {
          assetsConsidered: 0,
          resolvedThisRun: 0,
          assetsUpdated: 0,
          searchFailures: [],
          stillMissingCoingeckoId: 0,
          searchAttemptsThisRun: 0,
          continuationQueued: false,
          syncRunId: begun.runId,
        };
      }
      runId = begun.runId;
    } catch {
      /* automated: do not call CoinGecko without a run row; manual may still run below */
    }
  }

  if (source === "automated" && !runId) {
    return {
      assetsConsidered: 0,
      resolvedThisRun: 0,
      assetsUpdated: 0,
      searchFailures: [],
      stillMissingCoingeckoId: 0,
      searchAttemptsThisRun: 0,
      continuationQueued: false,
      syncRunId: null,
    };
  }

  try {
    const p1 = await syncCoingeckoAssetMetricsResolvePhase(admin);
    const p2 = await syncCoingeckoAssetMetricsMarketsPhase(admin, p1.idByCoingecko);
    const stillMissing = p1.stillMissingCoingeckoId;

    const result: CoingeckoMetricsSyncResult = {
      assetsConsidered: p1.assetsConsidered,
      resolvedThisRun: p1.resolvedThisRun,
      assetsUpdated: p2.assetsUpdated,
      searchFailures: p1.searchFailures,
      stillMissingCoingeckoId: stillMissing,
      searchAttemptsThisRun: p1.searchAttemptsThisRun,
      continuationQueued: false,
      syncRunId: runId,
    };

    if (runId) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: COINGECKO_SYNC_JOB_METRICS,
          source,
          metadata: {
            assetsConsidered: result.assetsConsidered,
            resolvedThisRun: result.resolvedThisRun,
            assetsUpdated: result.assetsUpdated,
            stillMissingCoingeckoId: result.stillMissingCoingeckoId,
            searchAttemptsThisRun: result.searchAttemptsThisRun,
            searchFailureCount: result.searchFailures.length,
          },
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
          reason: e instanceof Error ? e.message : "sync failed",
        });
      } catch {
        /* non-fatal */
      }
    }
    throw e;
  }
}
