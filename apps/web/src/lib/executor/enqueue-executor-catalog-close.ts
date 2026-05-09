import "server-only";

import { Client } from "@upstash/qstash";

import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";
import { runExecutorCatalogCloseDrain, type ExecutorCatalogCloseBody } from "./run-executor-catalog-close";

/** After the last `mediator-catalog-close` batch for a bar, enqueue one executor pass. */
export async function enqueueExecutorCatalogCloseAfterMediator(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.EXECUTOR_AFTER_MEDIATOR_DISABLE === "1") return;
  if (!parseSignalUserIdsFromEnv().length) return;

  const body: ExecutorCatalogCloseBody = {
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
      url: `${base}/api/workers/executor-catalog-close`,
      body,
      retries: 3,
    });
    return;
  }

  await runExecutorCatalogCloseDrain(body);
}
