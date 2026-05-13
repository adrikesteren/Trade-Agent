import "server-only";

import { nextLocalWallClockBoundaryAfter } from "@/lib/markets/sync-schedule";

/**
 * **Not imported by default** — use an external scheduler or re-import from `instrumentation` and set
 * `ENABLE_LOCAL_COINGECKO_COIN_ID_SYNC=1` to enable.
 *
 * Dev-only: every hour on the local wall-clock grid (aligned), fill `assets.coingecko_coin_id` when empty.
 */
function startLocalCoingeckoCoinIdScheduler(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.ENABLE_LOCAL_COINGECKO_COIN_ID_SYNC !== "1") return;

  const g = globalThis as typeof globalThis & { __tradeAgentLocalCoingeckoCoinId?: boolean };
  if (g.__tradeAgentLocalCoingeckoCoinId) return;
  g.__tradeAgentLocalCoingeckoCoinId = true;

  const intervalMs = Number(process.env.LOCAL_COINGECKO_COIN_ID_INTERVAL_MS ?? 3_600_000);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 60_000 ? intervalMs : 3_600_000;

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
      const { getAppBaseUrl } = await import("@/lib/env/app-base-url");
      const { buildFindCoingeckoIdAllWorkerUrl } = await import("@/lib/relay/relay-symbol-close-pipeline-client");
      const { executeFindCoingeckoIdWorker } = await import("@/lib/markets/execute-find-coingecko-id-worker");
      const url = buildFindCoingeckoIdAllWorkerUrl(getAppBaseUrl(), "automated");
      const body = await executeFindCoingeckoIdWorker(url);
      const ms = Date.now() - started;
      if (!body.ok) {
        console.warn("[local coingecko coin-id]", body.error, `${ms}ms`);
      } else if (body.mode === "relay_enqueued") {
        console.log(
          "[local coingecko coin-id]",
          `relay published=${body.published}`,
          `assets=${body.distinctAssetCodes.length}`,
          `${ms}ms`,
        );
      } else if (body.mode === "inline_bulk") {
        const { copiedFromMetadata, filledViaSearch, searchAttempts, stillMissingCoinId, failures } = body;
        console.log(
          "[local coingecko coin-id]",
          `copied=${copiedFromMetadata}`,
          `searchFilled=${filledViaSearch}`,
          `searches=${searchAttempts}`,
          `stillMissing=${stillMissingCoinId}`,
          `${ms}ms`,
          failures.length ? `warn=${failures.length}` : "",
        );
      }
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
