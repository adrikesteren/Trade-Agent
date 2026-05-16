import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Counts of rows removed by {@link deleteAllSignalsForMarket}. The signal count is exact;
 * the cascade counts are *not* returned by PostgREST so they're left for the caller to
 * surface in the UI as "via FK cascade" rather than precise numbers.
 */
export type DeleteAllSignalsForMarketResult = {
  marketId: string;
  marketSymbol: string;
  /** Total `catalog.candles` rows scanned to build the candle id list. */
  candlesScanned: number;
  /** `trading.signals` rows actually removed. */
  signalsDeleted: number;
};

const CANDLE_PAGE_SIZE = 1000;
const SIGNAL_DELETE_CHUNK = 80;

/**
 * Lists every `catalog.candles.id` for a market across **all stored timeframes**, paginated
 * to stay under PostgREST `max_rows`. We need every timeframe (not just the storage 15m)
 * because `trading.signals.candle_id` may eventually point at higher-tf candles too —
 * keeping this generic future-proofs the wipe.
 */
async function listCandleIdsForMarket(admin: SupabaseClient, marketId: string): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  // Defensive upper bound — at 1000/page this allows up to 1M candles per market before
  // we silently cap. In practice the largest market in this codebase sits at ~16k rows.
  const HARD_CAP = 1_000_000;
  while (ids.length < HARD_CAP) {
    const to = from + CANDLE_PAGE_SIZE - 1;
    const { data, error } = await admin
      .schema("catalog")
      .from("candles")
      .select("id")
      .eq("market_id", marketId)
      .range(from, to);
    if (error) throw new Error(`candles list (page ${from}): ${error.message}`);
    const chunk = (data ?? []) as { id: string }[];
    if (!chunk.length) break;
    for (const r of chunk) {
      const id = String(r.id ?? "").trim();
      if (id) ids.push(id);
    }
    from += chunk.length;
    if (chunk.length < CANDLE_PAGE_SIZE) break;
  }
  return ids;
}

/**
 * Deletes every `trading.signals` row whose `candle_id` belongs to the given market. The
 * delete is **not** scoped by user — every per-user signal for those candles goes away.
 *
 * **Cascade impact (DB-enforced, not done in app code):**
 * - `trading.decisions.signal_id` → ON DELETE CASCADE → all decisions on these signals are removed.
 * - `trading.orders.decision_id` → ON DELETE CASCADE → orders for those decisions are removed.
 * - `trading.fills.order_id` → ON DELETE CASCADE → fills for those orders are removed.
 * - `trading.positions` is **NOT** in the cascade chain (only references `executor_id` /
 *   `market_id`); positions remain and may end up inconsistent if they were opened by an
 *   order that's now gone. The caller should warn the user about this in the UI.
 * - `automation.signal_runs.signal_id` → ON DELETE SET NULL → run history preserved.
 *
 * Use case: starting from a clean signal slate on one market (e.g. after deciding the
 * old signal-agent output is wrong and a fresh evaluate-all run is preferable). For
 * targeted "rebuild a single agent in place" prefer `rebuildRegimeClassifierForMarket`
 * (or any equivalent upsert path) so signal ids — and downstream FKs — survive.
 */
export async function deleteAllSignalsForMarket(
  admin: SupabaseClient,
  args: { marketId: string },
): Promise<DeleteAllSignalsForMarketResult> {
  const marketId = String(args.marketId ?? "").trim();
  if (!marketId) throw new Error("marketId is required");

  const { data: mrow, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("id", marketId)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("Market not found.");
  const marketSymbol = String((mrow as { market_symbol?: string | null }).market_symbol ?? "");

  const candleIds = await listCandleIdsForMarket(admin, marketId);
  if (candleIds.length === 0) {
    return { marketId, marketSymbol, candlesScanned: 0, signalsDeleted: 0 };
  }

  let signalsDeleted = 0;
  for (let i = 0; i < candleIds.length; i += SIGNAL_DELETE_CHUNK) {
    const chunk = candleIds.slice(i, i + SIGNAL_DELETE_CHUNK);
    const { error, count } = await admin
      .schema("trading")
      .from("signals")
      .delete({ count: "exact" })
      .in("candle_id", chunk);
    if (error) throw new Error(`signals delete (chunk ${i}): ${error.message}`);
    signalsDeleted += count ?? 0;
  }

  return {
    marketId,
    marketSymbol,
    candlesScanned: candleIds.length,
    signalsDeleted,
  };
}
