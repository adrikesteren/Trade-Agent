import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { bulkUpsertCandleTimestampsForWindow } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { timeframeDurationMs } from "@/lib/agents/ingest/services/eur-candle-timestamp-window.service";
import { syncBitvavoCandlesChunk } from "@/lib/agents/ingest/services/bitvavo-candles-chunk-sync.service";
import {
  computeWarmupBars,
  countCandlesForMarketByCloseTimeRange,
  type WarmupAgentInput,
} from "@/lib/agents/ingest/services/historical-candles-for-replay-load.service";

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
    /**
     * Optional list of enabled signal agents (slug + raw `config` JSON) used to derive extra
     * warmup. Each agent's warmup is computed from its config (e.g. regime classifier reads
     * `maPeriod` × `trendTimeframeMinutes` to know how many 15m bars it needs). Pass-through to
     * {@link computeWarmupBars}; defaults to the legacy 120-bar floor when omitted.
     */
    enabledAgents?: readonly WarmupAgentInput[];
  },
): Promise<{
  barCount: number;
  candleRowsUpserted: number;
  startOpenIso: string;
  endCloseIso: string;
  /**
   * `true` when the full ingest window (`ingestStartOpenMs`..`endCloseMs`) was already covered
   * by `catalog.candles` and the Bitvavo HTTP fetch was skipped. Diagnostic only — the caller
   * can treat the candles in DB as the source of truth either way.
   */
  cached: boolean;
  /** Number of `catalog.candles` rows already present in the ingest window when we checked. */
  candlesAlreadyInDb: number;
  /** Expected number of bars in the ingest window (warmup + replay). */
  ingestBarCount: number;
}> {
  const stepMs = timeframeDurationMs(args.timeframe);
  const warmupBars = computeWarmupBars(args.timeframe, args.enabledAgents ?? []);
  const extraWarmupMs = warmupBars * stepMs;
  const win = computeHistoricalCandleWindow({
    startDate: args.historicalStartDate,
    endDate: args.historicalEndDate,
    timeframe: args.timeframe,
    extraWarmupMs,
  });
  if (win.kind !== "ok") {
    throw new Error(`Historical candle window: ${win.reason}`);
  }

  // Bulk-upsert `candle_timestamps` for the full ingest window (warmup + replay) so the
  // Bitvavo fetch can attach candle_id → candle_timestamp_id without lookups failing.
  // (Idempotent — `ignoreDuplicates` makes the cached path cheap too.)
  await bulkUpsertCandleTimestampsForWindow(admin, win.ingestStartOpenMs, win.endCloseMs, stepMs);

  const startOpenIso = new Date(win.ingestStartOpenMs).toISOString();
  const endCloseIso = new Date(win.endCloseMs).toISOString();

  // Optimization: if the full ingest window (warmup + replay) is already covered in
  // `catalog.candles`, skip the Bitvavo HTTP fetch entirely. We compare against the
  // **expected** `ingestBarCount` derived from the window — if Bitvavo had previously
  // returned data for this window, the count in DB is stable and re-fetching would be
  // wasted bandwidth.
  //
  // `firstIngestCloseIso` = first bucket boundary at/after `ingestStartOpenMs`
  // (= `ingestStartOpenMs + stepMs`). `endCloseIso` is the inclusive upper bound.
  const firstIngestCloseIso = new Date(win.ingestStartOpenMs + stepMs).toISOString();
  const candlesAlreadyInDb = await countCandlesForMarketByCloseTimeRange(admin, {
    marketId: args.marketId,
    timeframe: args.timeframe,
    closeTimeGteIso: firstIngestCloseIso,
    closeTimeLteIso: endCloseIso,
  });

  if (candlesAlreadyInDb >= win.ingestBarCount) {
    return {
      // `barCount` is the **replay-only** count so callers using it as `bars_total`
      // (e.g. `executor_historical_runs.bars_total`) don't double-count warmup bars.
      barCount: win.barCount,
      candleRowsUpserted: 0,
      startOpenIso,
      endCloseIso,
      cached: true,
      candlesAlreadyInDb,
      ingestBarCount: win.ingestBarCount,
    };
  }

  const { data: mrow, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_asset_id, exchange_id")
    .eq("id", args.marketId)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("market not found");

  const { data: quoteRow, error: qErr } = await admin
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("id", mrow.quote_asset_id as string)
    .maybeSingle();
  if (qErr) throw new Error(qErr.message);
  const quote = String(quoteRow?.code ?? args.quote).toUpperCase();
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

  const r = await syncBitvavoCandlesChunk(admin, {
    timeframe: args.timeframe,
    barsPerMarket: win.ingestBarCount,
    quote,
    marketOffset: offset,
    marketBatchSize: 1,
    delayMsBetweenMarkets: 0,
    syncMode: "window",
    windowStartOpen: startOpenIso,
    windowEndClose: endCloseIso,
    windowBarCount: win.ingestBarCount,
  });

  return {
    barCount: win.barCount,
    candleRowsUpserted: r.candleRowsUpserted,
    startOpenIso,
    endCloseIso,
    cached: false,
    candlesAlreadyInDb,
    ingestBarCount: win.ingestBarCount,
  };
}
