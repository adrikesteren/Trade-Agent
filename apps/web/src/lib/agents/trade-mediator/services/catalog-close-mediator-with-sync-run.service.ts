import "server-only";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import {
  beginBitvavoSyncRun,
  recordBitvavoSyncCompleted,
  recordBitvavoSyncFailed,
  SYNC_JOB_MEDIATOR_CATALOG_CLOSE,
  type BitvavoSyncTriggerSource,
} from "@/lib/agents/ingest/services/bitvavo-sync-status-record.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import {
  runMediatorCatalogCloseDrain,
  type MediatorCatalogCloseBody,
  type RunMediatorCatalogCloseResult,
} from "./catalog-close-mediator-run.service";

export type ExecuteMediatorCatalogCloseOutcome =
  | { kind: "skipped_overlap"; runId: string }
  | { kind: "completed"; runId: string; result: RunMediatorCatalogCloseResult };

/**
 * One `automation.sync_runs` row for `mediator_catalog_close`, then full in-process drain.
 */
export async function executeMediatorCatalogCloseWithSyncRun(
  body: MediatorCatalogCloseBody,
  source: BitvavoSyncTriggerSource,
): Promise<ExecuteMediatorCatalogCloseOutcome> {
  const admin = createServiceRoleClient();
  const timeframe = body.timeframe ?? CATALOG_STORAGE_TIMEFRAME;
  const begun = await beginBitvavoSyncRun(admin, SYNC_JOB_MEDIATOR_CATALOG_CLOSE, source, {
    metadata: {
      closeTimeIso: body.closeTimeIso,
      timeframe,
      candleSyncRunId: body.candleSyncRunId ?? null,
      signalsSyncRunId: body.signalsSyncRunId ?? null,
    },
  });
  if (begun.outcome === "skipped") {
    return { kind: "skipped_overlap", runId: begun.runId };
  }
  const runId = begun.runId;
  const drainBody: MediatorCatalogCloseBody = { ...body, mediatorPipelineSyncRunId: runId };
  try {
    const result = await runMediatorCatalogCloseDrain(drainBody);
    await recordBitvavoSyncCompleted(admin, {
      runId,
      jobKey: SYNC_JOB_MEDIATOR_CATALOG_CLOSE,
      source,
      metadata: {
        closeTimeIso: body.closeTimeIso,
        timeframe,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
        marketsProcessed: result.marketsProcessed,
        decisionsUpserted: result.decisionsUpserted,
        totalMarkets: result.totalMarkets,
        ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
      },
    });
    return { kind: "completed", runId, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordBitvavoSyncFailed(admin, {
      runId,
      jobKey: SYNC_JOB_MEDIATOR_CATALOG_CLOSE,
      source,
      reason: msg,
      metadata: {
        closeTimeIso: body.closeTimeIso,
        candleSyncRunId: body.candleSyncRunId ?? null,
        signalsSyncRunId: body.signalsSyncRunId ?? null,
      },
    });
    throw e;
  }
}
