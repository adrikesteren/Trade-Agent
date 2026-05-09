import "server-only";

import { Client } from "@upstash/qstash";

import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";
import { runMediatorCatalogCloseDrain, type MediatorCatalogCloseBody } from "./run-mediator-catalog-close";

/** After the last `signals-catalog-close` batch for a bar, enqueue one mediator pass (same close grid). */
export async function enqueueMediatorCatalogCloseAfterSignals(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.MEDIATOR_AFTER_SIGNALS_DISABLE === "1") return;
  if (!parseSignalUserIdsFromEnv().length) return;

  const body: MediatorCatalogCloseBody = {
    closeTimeIso: params.closeTimeIso,
    timeframe: params.timeframe,
    quote: "EUR",
    marketOffset: 0,
    candleSyncRunId: params.candleSyncRunId ?? null,
  };

  const base = workerPublicBaseUrl();
  const token = process.env.QSTASH_TOKEN;
  if (base && token) {
    const client = new Client({ token });
    await client.publishJSON({
      url: `${base}/api/workers/mediator-catalog-close`,
      body,
      retries: 3,
    });
    return;
  }

  await runMediatorCatalogCloseDrain(body);
}
