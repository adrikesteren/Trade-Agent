import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_ASSET_DATA,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  type BitvavoSyncTriggerSource,
} from "@/lib/markets/record-bitvavo-sync-status";
import { syncBitvavoAssetData, type SyncBitvavoAssetDataOptions } from "@/lib/markets/sync-bitvavo-asset-data";

export type BitvavoAssetDataSyncResult = {
  fetchedFromApi: number;
  assetsUpdated: number;
  unmatchedSymbols: number;
  syncRunId: string | null;
  skipped: boolean;
};

/**
 * Bitvavo asset metadata (`/v2/assets`) → `catalog.assets` with `sync_runs` row.
 */
export async function runBitvavoAssetDataSyncWithSyncRun(
  admin: SupabaseClient,
  source: BitvavoSyncTriggerSource,
  opts: SyncBitvavoAssetDataOptions = {},
): Promise<BitvavoAssetDataSyncResult> {
  let runId: string | null = null;

  try {
    const begun = await beginBitvavoSyncRun(admin, BITVAVO_SYNC_JOB_ASSET_DATA, source);
    if (begun.outcome === "skipped") {
      return {
        fetchedFromApi: 0,
        assetsUpdated: 0,
        unmatchedSymbols: 0,
        syncRunId: begun.runId,
        skipped: true,
      };
    }
    runId = begun.runId;
  } catch {
    if (source === "automated") {
      return { fetchedFromApi: 0, assetsUpdated: 0, unmatchedSymbols: 0, syncRunId: null, skipped: false };
    }
  }

  if (source === "automated" && !runId) {
    return { fetchedFromApi: 0, assetsUpdated: 0, unmatchedSymbols: 0, syncRunId: null, skipped: false };
  }

  try {
    const stats = await syncBitvavoAssetData(admin, opts);
    if (runId) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_ASSET_DATA,
          source,
          metadata: {
            fetchedFromApi: stats.fetchedFromApi,
            assetsUpdated: stats.assetsUpdated,
            unmatchedSymbols: stats.unmatchedSymbols,
            ...(opts.symbols?.length ? { symbolsFilter: opts.symbols } : {}),
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return {
      fetchedFromApi: stats.fetchedFromApi,
      assetsUpdated: stats.assetsUpdated,
      unmatchedSymbols: stats.unmatchedSymbols,
      syncRunId: runId,
      skipped: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    if (runId) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_ASSET_DATA,
          source,
          reason: message,
        });
      } catch {
        /* non-fatal */
      }
    }
    throw e;
  }
}
