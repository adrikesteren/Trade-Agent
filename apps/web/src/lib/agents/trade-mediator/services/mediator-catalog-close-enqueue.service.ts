import "server-only";

import { getCatalogPipelineUserIds } from "@/lib/agents/signal/services/signal-user-ids.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

import { executeMediatorCatalogCloseWithSyncRun } from "./catalog-close-mediator-with-sync-run.service";
import type { MediatorCatalogCloseBody } from "./catalog-close-mediator-run.service";

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
