import "server-only";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  beginBitvavoSyncRun,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  SYNC_JOB_EXECUTOR_CATALOG_CLOSE,
  type BitvavoSyncTriggerSource,
} from "@/lib/markets/record-bitvavo-sync-status";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import {
  runExecutorCatalogCloseDrain,
  type ExecutorCatalogCloseBody,
  type RunExecutorCatalogCloseResult,
} from "./run-executor-catalog-close";

export type ExecuteExecutorCatalogCloseOutcome =
  | { kind: "skipped_overlap"; runId: string }
  | { kind: "completed"; runId: string; result: RunExecutorCatalogCloseResult };

/**
 * One `automation.sync_runs` row for `executor_catalog_close`, then full in-process drain.
 */
export async function executeExecutorCatalogCloseWithSyncRun(
  body: ExecutorCatalogCloseBody,
  source: BitvavoSyncTriggerSource,
): Promise<ExecuteExecutorCatalogCloseOutcome> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const begun = await beginBitvavoSyncRun(admin, SYNC_JOB_EXECUTOR_CATALOG_CLOSE, source, {
    metadata: {
      closeTimeIso: body.closeTimeIso,
      timeframe,
      candleSyncRunId: body.candleSyncRunId ?? null,
      signalsSyncRunId: body.signalsSyncRunId ?? null,
      mediatorSyncRunId: body.mediatorSyncRunId ?? null,
    },
  });
  if (begun.outcome === "skipped") {
    return { kind: "skipped_overlap", runId: begun.runId };
  }
  const runId = begun.runId;
  const drainBody: ExecutorCatalogCloseBody = { ...body, executorPipelineSyncRunId: runId };
  try {
    const result = await runExecutorCatalogCloseDrain(drainBody);
    await recordBitvavoSyncCompleted(admin, {
      runId,
      jobKey: SYNC_JOB_EXECUTOR_CATALOG_CLOSE,
      source,
      metadata: {
        closeTimeIso: body.closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
        mediatorSyncRunId: body.mediatorSyncRunId ?? null,
        marketsProcessed: result.marketsProcessed,
        ordersInserted: result.ordersInserted,
        totalMarkets: result.totalMarkets,
        ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      },
    });
    return { kind: "completed", runId, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordBitvavoSyncFailed(admin, {
      runId,
      jobKey: SYNC_JOB_EXECUTOR_CATALOG_CLOSE,
      source,
      reason: msg,
      metadata: {
        closeTimeIso: body.closeTimeIso,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
        mediatorSyncRunId: body.mediatorSyncRunId ?? null,
      },
    });
    throw e;
  }
}
