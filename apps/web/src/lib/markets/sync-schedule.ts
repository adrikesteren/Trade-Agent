/**
 * Expected interval between automated Bitvavo syncs (for “next run” UI).
 * Set NEXT_PUBLIC_* to 0 to show “not scheduled” (manual-only).
 */
function parseIntervalMs(envVal: string | undefined, fallback: number): number {
  if (envVal === undefined || envVal === "") return fallback;
  const n = Number(envVal);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Default 0: market sync is manual-only; set env to a positive ms only if you use an external cron and want ETA UI. */
export function getMarketsSyncIntervalMs(): number {
  return parseIntervalMs(process.env.NEXT_PUBLIC_BITVAVO_MARKETS_SYNC_INTERVAL_MS, 0);
}

export function getCandlesSyncIntervalMs(): number {
  return parseIntervalMs(process.env.NEXT_PUBLIC_BITVAVO_CANDLES_SYNC_INTERVAL_MS, 300_000);
}

/** Display grid for CoinGecko worker (default 5m). Set to 0 to hide “next tick” on the sync dashboard. */
export function getCoingeckoMetricsSyncIntervalMs(): number {
  return parseIntervalMs(process.env.NEXT_PUBLIC_COINGECKO_METRICS_SYNC_INTERVAL_MS, 300_000);
}

/** CoinGecko coin-id backfill worker (default 5m). */
export function getCoingeckoCoinIdSyncIntervalMs(): number {
  return parseIntervalMs(process.env.NEXT_PUBLIC_COINGECKO_COIN_ID_SYNC_INTERVAL_MS, 300_000);
}

/**
 * Next local wall-clock instant strictly after `afterMs` on a grid of `intervalMs` from local
 * midnight (e.g. every hour → …:00; every 5 minutes → …:00, …:05, …:10, …).
 */
export function nextLocalWallClockBoundaryAfter(afterMs: number, intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return afterMs;
  let t = afterMs;
  for (let guard = 0; guard < 4; guard++) {
    const d = new Date(t);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayMs = 86_400_000;
    const offset = t - start;
    const step = Math.ceil((offset + 1) / intervalMs) * intervalMs;
    if (step < dayMs) return start + step;
    t = start + dayMs;
  }
  return afterMs + intervalMs;
}
