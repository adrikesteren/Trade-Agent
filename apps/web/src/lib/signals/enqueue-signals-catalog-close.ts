import "server-only";

import { executeSignalsCatalogCloseWithSyncRun } from "@/lib/signals/run-signals-catalog-close-with-sync-run";
import type { SignalsCatalogCloseBody } from "@/lib/signals/run-signals-catalog-close";
import { parseSignalUserIdsFromEnv } from "@/lib/signals/signal-user-ids";

/** After a completed EUR catalog candle sweep (`runEurCandleSweep`), run one signal pass for `closeTimeIso` (latest closed bar on the catalog grid). */
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

  await executeSignalsCatalogCloseWithSyncRun(body, "automated");
}
