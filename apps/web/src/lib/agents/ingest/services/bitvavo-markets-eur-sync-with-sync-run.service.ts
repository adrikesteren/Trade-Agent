import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginBitvavoSyncRun,
  BITVAVO_SYNC_JOB_MARKETS_EUR,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  type BitvavoSyncTriggerSource,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { syncBitvavoMarkets } from "@/lib/agents/ingest/services/bitvavo-markets-sync.service";

export type BitvavoMarketsSyncResult = {
  upsertedAssets: number;
  upsertedListings: number;
  skippedMissingQuote: number;
  quoteFilter: string | null;
  syncRunId: string | null;
  /** `true` when an automated run was skipped because another `running` row exists. */
  skipped: boolean;
};

/**
 * Bitvavo catalog listings → `catalog.assets` + `catalog.markets` with `sync_runs` for EUR filter only.
 */
export async function runBitvavoMarketsEurSyncWithSyncRun(
  admin: SupabaseClient,
  source: BitvavoSyncTriggerSource,
  opts: { quoteFilter?: string | null } = {},
): Promise<BitvavoMarketsSyncResult> {
  const quoteFilter = opts.quoteFilter === undefined ? "EUR" : opts.quoteFilter;
  const trackRun = quoteFilter === "EUR";

  let runId: string | null = null;

  if (trackRun) {
    try {
      const begun = await beginBitvavoSyncRun(admin, BITVAVO_SYNC_JOB_MARKETS_EUR, source);
      if (begun.outcome === "skipped") {
        return {
          upsertedAssets: 0,
          upsertedListings: 0,
          skippedMissingQuote: 0,
          quoteFilter,
          syncRunId: begun.runId,
          skipped: true,
        };
      }
      runId = begun.runId;
    } catch {
      if (source === "automated") {
        return { upsertedAssets: 0, upsertedListings: 0, skippedMissingQuote: 0, quoteFilter, syncRunId: null, skipped: false };
      }
    }
  }

  if (source === "automated" && trackRun && !runId) {
    return { upsertedAssets: 0, upsertedListings: 0, skippedMissingQuote: 0, quoteFilter, syncRunId: null, skipped: false };
  }

  try {
    const stats = await syncBitvavoMarkets(admin, quoteFilter);
    if (trackRun && runId) {
      try {
        await recordBitvavoSyncCompleted(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
          source,
          metadata: {
            upsertedListings: stats.upsertedListings,
            upsertedAssets: stats.upsertedAssets,
            skippedMissingQuote: stats.skippedMissingQuote,
            ...(quoteFilter != null ? { quoteFilter } : {}),
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return {
      upsertedAssets: stats.upsertedAssets,
      upsertedListings: stats.upsertedListings,
      skippedMissingQuote: stats.skippedMissingQuote,
      quoteFilter,
      syncRunId: runId,
      skipped: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    if (trackRun && runId) {
      try {
        await recordBitvavoSyncFailed(admin, {
          runId,
          jobKey: BITVAVO_SYNC_JOB_MARKETS_EUR,
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
