import "server-only";

import { nextLocalWallClockBoundaryAfter } from "@/lib/agents/ingest/services/sync-schedule.service";

/**
 * **Not imported by default** — use an external scheduler or re-import from `instrumentation` and set
 * `ENABLE_LOCAL_COINGECKO_METRICS_SYNC=1` to enable.
 *
 * Dev-only: poll CoinGecko metrics on a wall-clock grid.
 */
function startLocalCoingeckoMetricsScheduler(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.ENABLE_LOCAL_COINGECKO_METRICS_SYNC !== "1") return;

  const g = globalThis as typeof globalThis & { __tradeAgentLocalCoingeckoMetrics?: boolean };
  if (g.__tradeAgentLocalCoingeckoMetrics) return;
  g.__tradeAgentLocalCoingeckoMetrics = true;

  const intervalMs = Number(process.env.LOCAL_COINGECKO_METRICS_INTERVAL_MS ?? 300_000);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : 300_000;

  let inFlight = false;

  const scheduleNextAligned = () => {
    const now = Date.now();
    const nextMs = nextLocalWallClockBoundaryAfter(now, safeInterval);
    let delay = nextMs - now;
    if (delay < 1_000) delay = 1_000;
    setTimeout(() => void runAlignedTick(), delay);
  };

  const runAlignedTick = async () => {
    if (inFlight) {
      setTimeout(() => void runAlignedTick(), 10_000);
      return;
    }
    inFlight = true;
    const started = Date.now();
    try {
      const { createServiceRoleClient } = await import("@/lib/supabase/admin");
      const { runCoingeckoMetricsSyncWithSyncRun } = await import(
        "@/lib/agents/ingest/services/coingecko-sync-with-sync-run.service"
      );
      const r = await runCoingeckoMetricsSyncWithSyncRun(createServiceRoleClient(), "automated", {});
      const ms = Date.now() - started;
      console.log(
        "[local coingecko metrics]",
        `assetsUpdated=${r.assetsUpdated}`,
        `resolved=${r.resolvedThisRun}`,
        `searches=${r.searchAttemptsThisRun}`,
        `missingCgId=${r.stillMissingCoingeckoId}`,
        `continuation=${r.continuationQueued}`,
        `assets=${r.assetsConsidered}`,
        `${ms}ms`,
        r.searchFailures.length ? `warn=${r.searchFailures.length}` : "",
      );
    } catch (e) {
      console.error("[local coingecko metrics]", e);
    } finally {
      inFlight = false;
      scheduleNextAligned();
    }
  };

  scheduleNextAligned();
}

startLocalCoingeckoMetricsScheduler();
