import "server-only";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";

/**
 * Starts at most one interval per Node process (HMR / double import safe).
 * Loaded from root `layout.tsx` (reliable in `next dev`) and from `instrumentation.ts`
 * (covers API-only traffic that never renders the layout).
 *
 * Ticks align to the same local wall-clock grid as the Assets page “Next … mark” hint
 * (`nextLocalWallClockBoundaryAfter`), not to “every 5m since server boot” — avoids :39/:44/:49 drift.
 */
function startLocalCandleSyncScheduler(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.ENABLE_LOCAL_CANDLE_AUTO_SYNC !== "1") return;

  const g = globalThis as typeof globalThis & { __tradeAgentLocalCandleSync?: boolean };
  if (g.__tradeAgentLocalCandleSync) return;
  g.__tradeAgentLocalCandleSync = true;

  const intervalMs = Number(process.env.LOCAL_CANDLE_SYNC_INTERVAL_MS ?? 300_000);
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
      console.warn("[local candle sync] skipped tick — previous sweep still running; retry in 10s");
      setTimeout(() => void runAlignedTick(), 10_000);
      return;
    }
    inFlight = true;
    const started = Date.now();
    try {
      const { runEurCandleSweep } = await import("@/lib/markets/run-eur-candle-sweep");
      const r = await runEurCandleSweep({});
      const ms = Date.now() - started;
      console.log(
        "[local candle sync]",
        r.incomplete ? "partial" : "complete",
        `chunks=${r.chunksProcessed}`,
        `rows≈${r.candleRowsUpserted}`,
        `${ms}ms`,
        r.warning ? `warn=${r.warning}` : "",
      );
    } catch (e) {
      console.error("[local candle sync]", e);
    } finally {
      inFlight = false;
      scheduleNextAligned();
    }
  };

  scheduleNextAligned();
}

startLocalCandleSyncScheduler();
