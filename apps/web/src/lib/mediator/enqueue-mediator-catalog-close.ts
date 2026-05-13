import "server-only";

import { executeMediatorCatalogCloseWithSyncRun } from "./run-mediator-catalog-close-with-sync-run";
import type { MediatorCatalogCloseBody } from "./run-mediator-catalog-close";
import { getCatalogPipelineUserIds } from "@/lib/signals/signal-user-ids";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/** After the last `signals-catalog-close` batch for a bar, run one mediator pass (same close grid). */
export async function enqueueMediatorCatalogCloseAfterSignals(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
  signalsSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.MEDIATOR_AFTER_SIGNALS_DISABLE === "1") return;
  const admin = createServiceRoleClient();
  if (!(await getCatalogPipelineUserIds(admin)).length) return;

  const body: MediatorCatalogCloseBody = {
    closeTimeIso: params.closeTimeIso,
    timeframe: params.timeframe,
    quote: "EUR",
    marketOffset: 0,
    candleSyncRunId: params.candleSyncRunId ?? null,
    signalsSyncRunId: params.signalsSyncRunId ?? null,
  };

  await executeMediatorCatalogCloseWithSyncRun(body, "automated");
}
