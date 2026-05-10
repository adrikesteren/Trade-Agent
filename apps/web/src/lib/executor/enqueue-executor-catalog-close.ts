import "server-only";

import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";

import { executeExecutorCatalogCloseWithSyncRun } from "./run-executor-catalog-close-with-sync-run";
import type { ExecutorCatalogCloseBody } from "./run-executor-catalog-close";

/** After the last `mediator-catalog-close` batch for a bar, run one executor pass. */
export async function enqueueExecutorCatalogCloseAfterMediator(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  mediatorSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.EXECUTOR_AFTER_MEDIATOR_DISABLE === "1") return;
  if (!parseSignalUserIdsFromEnv().length) return;

  const body: ExecutorCatalogCloseBody = {
    closeTimeIso: params.closeTimeIso,
    timeframe: params.timeframe,
    quote: "EUR",
    marketOffset: 0,
    candleSyncRunId: params.candleSyncRunId ?? null,
    signalsSyncRunId: params.signalsSyncRunId ?? null,
    mediatorSyncRunId: params.mediatorSyncRunId ?? null,
  };

  await executeExecutorCatalogCloseWithSyncRun(body, "automated");
}
