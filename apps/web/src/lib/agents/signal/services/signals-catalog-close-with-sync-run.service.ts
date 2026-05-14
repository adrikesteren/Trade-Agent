import "server-only";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  beginBitvavoSyncRun,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  SYNC_JOB_SIGNALS_CATALOG_CLOSE,
  type BitvavoSyncTriggerSource,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import { runSignalsCatalogCloseDrain, type RunSignalsCatalogCloseResult, type SignalsCatalogCloseBody } from "./signals-catalog-close-run.service";

export type ExecuteSignalsCatalogCloseOutcome =
  | { kind: "skipped_overlap"; runId: string }
  | { kind: "completed"; runId: string; result: RunSignalsCatalogCloseResult };

/**
 * One `automation.sync_runs` row for `signals_catalog_close`, then full in-process drain.
 * On concurrent automated overlap, returns `skipped_overlap` without running work.
 */
export async function executeSignalsCatalogCloseWithSyncRun(
  body: SignalsCatalogCloseBody,
  source: BitvavoSyncTriggerSource,
): Promise<ExecuteSignalsCatalogCloseOutcome> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const begun = await beginBitvavoSyncRun(admin, SYNC_JOB_SIGNALS_CATALOG_CLOSE, source, {
    metadata: {
      closeTimeIso: body.closeTimeIso,
      timeframe,
      candleSyncRunId: body.candleSyncRunId ?? null,
    },
  });
  if (begun.outcome === "skipped") {
    return { kind: "skipped_overlap", runId: begun.runId };
  }
  const runId = begun.runId;
  const drainBody: SignalsCatalogCloseBody = { ...body, signalsSyncRunId: runId };
  try {
    const result = await runSignalsCatalogCloseDrain(drainBody);
    await recordBitvavoSyncCompleted(admin, {
      runId,
      jobKey: SYNC_JOB_SIGNALS_CATALOG_CLOSE,
      source,
      metadata: {
        closeTimeIso: body.closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
        marketsProcessed: result.marketsProcessed,
        signalsUpserted: result.signalsUpserted,
        totalMarkets: result.totalMarkets,
        ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      },
    });
    return { kind: "completed", runId, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordBitvavoSyncFailed(admin, {
      runId,
      jobKey: SYNC_JOB_SIGNALS_CATALOG_CLOSE,
      source,
      reason: msg,
      metadata: { closeTimeIso: body.closeTimeIso, candleSyncRunId: body.candleSyncRunId ?? null },
    });
    throw e;
  }
}
