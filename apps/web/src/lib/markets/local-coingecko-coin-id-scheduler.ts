import "server-only";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";

/**
 * Dev-only: every 5 minutes (aligned), fill `assets.coingecko_coin_id` when empty.
 */
function startLocalCoingeckoCoinIdScheduler(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.ENABLE_LOCAL_COINGECKO_COIN_ID_SYNC !== "1") return;

  const g = globalThis as typeof globalThis & { __tradeAgentLocalCoingeckoCoinId?: boolean };
  if (g.__tradeAgentLocalCoingeckoCoinId) return;
  g.__tradeAgentLocalCoingeckoCoinId = true;

  const intervalMs = Number(process.env.LOCAL_COINGECKO_COIN_ID_INTERVAL_MS ?? 300_000);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : 300_000;

  let inFlight = false;

  const scheduleNextAligned = () => {
    const now = Date.now();
    const nextMs = nextLocalWallClockBoundaryAfter(now, safeInterval);
    let delay = nextMs - now;
    if (delay < 1_000) delay = 1_000;
    setTimeout(() => void runTick(), delay);
  };

  const runTick = async () => {
    if (inFlight) {
      setTimeout(() => void runTick(), 10_000);
      return;
    }
    inFlight = true;
    const started = Date.now();
    try {
      const { createServiceRoleClient } = await import("@/lib/supabase/admin");
      const { runCoingeckoCoinIdSyncWithSyncRun } = await import(
        "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run"
      );
      const r = await runCoingeckoCoinIdSyncWithSyncRun(createServiceRoleClient(), "automated");
      const ms = Date.now() - started;
      console.log(
        "[local coingecko coin-id]",
        `copied=${r.copiedFromMetadata}`,
        `searchFilled=${r.filledViaSearch}`,
        `searches=${r.searchAttempts}`,
        `stillMissing=${r.stillMissingCoinId}`,
        `${ms}ms`,
        r.failures.length ? `warn=${r.failures.length}` : "",
      );
    } catch (e) {
      console.error("[local coingecko coin-id]", e);
    } finally {
      inFlight = false;
      scheduleNextAligned();
    }
  };

  scheduleNextAligned();
}

startLocalCoingeckoCoinIdScheduler();
