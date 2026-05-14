import "server-only";

import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import { executeExecutorCatalogCloseWithSyncRun } from "./catalog-close-executor-with-sync-run.service";
import type { ExecutorCatalogCloseBody } from "./catalog-close-executor-run.service";

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
