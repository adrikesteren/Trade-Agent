/**
 * Node only. Catalog/candle automation is driven by **external schedulers** calling worker routes with
 * `CRON_SECRET`, or the dashboard **Sync now** actions — not in-process dev timers by default.
 * Re-add imports from `local-*-scheduler.ts` only if you explicitly want that.
 *
 * Do not import `node:path` / `dotenv` here: Turbopack can evaluate this file in a context where
 * Node builtins are unavailable ("Native module not found"). Monorepo `.env` is loaded from
 * `next.config.ts` instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
}
