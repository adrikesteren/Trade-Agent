import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bulkUpsertCandleTimestampsForWindow } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";
import { syncBitvavoCandlesChunk } from "@/lib/agents/ingest/services/bitvavo-candles-chunk-sync.service";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";

import { computeHistoricalCandleWindow } from "./historical-candle-window.service";

/**
 * Ingest Agent — historical candle backfill for a single Bitvavo market.
 *
 * Ensures `catalog.candle_timestamps` exists for the window and pulls Bitvavo OHLCV into `catalog.candles`
 * (window sync, chunked at 1440 bars per HTTP call inside `syncBitvavoCandlesChunk`).
 *
 * Reused by:
 * - `run-historical-executor-replay.ts` (executor-historical mode)
 * - `run-market-backfill-candles.ts` (manual “Backfill candles” action on a market)
 */
export async function ingestHistoricalCandles(
  admin: SupabaseClient,
  args: {
    marketId: string;
    timeframe: string;
    quote: string;
    historicalStartDate: string;
    historicalEndDate: string;
  },
): Promise<{ barCount: number; candleRowsUpserted: number; startOpenIso: string; endCloseIso: string }> {
  const win = computeHistoricalCandleWindow({
    startDate: args.historicalStartDate,
    endDate: args.historicalEndDate,
    timeframe: args.timeframe,
  });
  if (win.kind !== "ok") {
    throw new Error(`Historical candle window: ${win.reason}`);
  }

  await bulkUpsertCandleTimestampsForWindow(admin, win.startOpenMs, win.endCloseMs, timeframeDurationMs(args.timeframe));

  const mrow = await MarketsSelector.selectCoreById(admin, args.marketId);
  if (!mrow) throw new Error("market not found");

  const quoteCode = await AssetsSelector.selectCodeById(admin, mrow.quote_asset_id as string);
  const quote = String(quoteCode ?? args.quote).toUpperCase();
  if (!quote) {
    throw new Error("market missing quote asset code");
  }

  const { data: ordered, error: listErr } = await admin.schema("catalog").rpc("bitvavo_markets_for_candle_sync_slice", {
    p_exchange_id: mrow.exchange_id as string,
    p_quote: quote,
    p_offset: 0,
    p_limit: 50_000,
  });
  if (listErr) throw new Error(listErr.message);
  const ids = (ordered ?? []).map((r: { id: string }) => r.id);
  const offset = ids.indexOf(args.marketId);
  if (offset < 0) {
    throw new Error("market not in Bitvavo quote slice");
  }

  const startOpenIso = new Date(win.startOpenMs).toISOString();
  const endCloseIso = new Date(win.endCloseMs).toISOString();

  const r = await syncBitvavoCandlesChunk(admin, {
    timeframe: args.timeframe,
    barsPerMarket: win.barCount,
    quote,
    marketOffset: offset,
    marketBatchSize: 1,
    delayMsBetweenMarkets: 0,
    syncMode: "window",
    windowStartOpen: startOpenIso,
    windowEndClose: endCloseIso,
    windowBarCount: win.barCount,
  });

  return {
    barCount: win.barCount,
    candleRowsUpserted: r.candleRowsUpserted,
    startOpenIso,
    endCloseIso,
  };
}
