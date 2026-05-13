import "server-only";

import { executeExecutorCatalogCloseWithSyncRun } from "./run-executor-catalog-close-with-sync-run";
import type { ExecutorCatalogCloseBody } from "./run-executor-catalog-close";
import { getCatalogPipelineUserIds } from "@/lib/signals/signal-user-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/** After the last `mediator-catalog-close` batch for a bar, run one executor pass. */
export async function enqueueExecutorCatalogCloseAfterMediator(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
  mediatorSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.EXECUTOR_AFTER_MEDIATOR_DISABLE === "1") return;
  const admin = createServiceRoleClient();
  if (!(await getCatalogPipelineUserIds(admin)).length) return;

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
