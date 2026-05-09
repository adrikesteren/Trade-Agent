import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginBitvavoSyncRun,
  COINGECKO_SYNC_JOB_COIN_ID,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  type BitvavoSyncTriggerSource,
} from "@/lib/markets/record-bitvavo-sync-status";
import { syncCoingeckoCoinIds, type SyncCoingeckoCoinIdResult } from "@/lib/markets/sync-coingecko-coin-id";

export async function runCoingeckoCoinIdSyncWithSyncRun(
  admin: SupabaseClient,
  source: BitvavoSyncTriggerSource,
): Promise<SyncCoingeckoCoinIdResult & { syncRunId: string | null }> {
  let runId: string | null = null;
  try {
    const begun = await beginBitvavoSyncRun(admin, COINGECKO_SYNC_JOB_COIN_ID, source);
    if (begun.outcome === "skipped") {
      return {
        copiedFromMetadata: 0,
        filledViaSearch: 0,
        searchAttempts: 0,
        stillMissingCoinId: 0,
        failures: [],
        syncRunId: begun.runId,
      };
    }
    runId = begun.runId;
  } catch {
    /* non-fatal */
  }

  try {
    const result = await syncCoingeckoCoinIds(admin);
    if (runId) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: COINGECKO_SYNC_JOB_COIN_ID,
          source,
          metadata: {
            copiedFromMetadata: result.copiedFromMetadata,
            filledViaSearch: result.filledViaSearch,
            searchAttempts: result.searchAttempts,
            stillMissingCoinId: result.stillMissingCoinId,
            failureCount: result.failures.length,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return { ...result, syncRunId: runId };
  } catch (e) {
    if (runId) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId,
          jobKey: COINGECKO_SYNC_JOB_COIN_ID,
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
