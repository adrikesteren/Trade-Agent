/**
 * Node only. Catalog/candle automation is driven by **QStash schedules** (see `pnpm qstash:schedules`),
 * not in-process dev timers. Re-add imports from `local-*-scheduler.ts` only if you explicitly want that.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
}
