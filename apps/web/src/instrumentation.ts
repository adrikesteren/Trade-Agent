/**
 * Node only. Ensures local EUR candle interval is registered when instrumentation runs
 * (e.g. before any page layout). The scheduler module is idempotent; root layout also imports it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  await import("@/lib/markets/local-candle-sync-scheduler");
}
