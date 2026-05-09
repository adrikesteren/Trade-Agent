import "server-only";

import { Client } from "@upstash/qstash";

import { workerPublicBaseUrl } from "@/lib/workers/worker-public-base-url";

import { runSignalsCatalogCloseDrain, type SignalsCatalogCloseBody } from "./run-signals-catalog-close";
import { parseSignalUserIdsFromEnv } from "./signal-user-ids";

export async function enqueueSignalsCatalogCloseAfterIncremental(params: {
  closeTimeIso: string;
  timeframe: string;
  candleSyncRunId?: string | null;
}): Promise<void> {
  if (process.env.SIGNALS_AFTER_CANDLE_DISABLE === "1") return;
  if (!parseSignalUserIdsFromEnv().length) return;

  const body: SignalsCatalogCloseBody = {
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
      url: `${base}/api/workers/signals-catalog-close`,
      body,
      retries: 3,
    });
    return;
  }

  await runSignalsCatalogCloseDrain(body);
}
