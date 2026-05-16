import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { ingestHistoricalCandles } from "./historical-candles-ingest.service";
import * as MarketsSelector from "@/lib/selectors/markets-selector";
import * as AssetsSelector from "@/lib/selectors/assets-selector";

export type IngestRetrieveCandlesArgs = {
  marketId: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  endDate: string;
};

export type IngestRetrieveCandlesResult = {
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  candleRowsUpserted: number;
};

/**
 * Adapter-agnostic candle retrieval: ensures `[startDate, endDate]` candles exist in
 * `catalog.candles` for the given market on the storage timeframe. Currently delegates to
 * {@link ingestHistoricalCandles} which uses Bitvavo via the legacy direct imports — this
 * entry-point exists so future exchange-adapter routing can replace the body without touching
 * call-sites (see Plan 2 Layer 1).
 */
export async function runIngestRetrieveCandles(
  admin: SupabaseClient,
  args: IngestRetrieveCandlesArgs,
): Promise<IngestRetrieveCandlesResult> {
  const market = await MarketsSelector.selectCoreById(admin, args.marketId);
  if (!market) throw new Error(`Market not found: ${args.marketId}`);
  const quoteCode = await AssetsSelector.selectCodeById(admin, market.quote_asset_id);
  const quote = String(quoteCode ?? "").toUpperCase() || "EUR";
  const ingest = await ingestHistoricalCandles(admin, {
    marketId: args.marketId,
    timeframe: CATALOG_STORAGE_TIMEFRAME,
    quote,
    historicalStartDate: args.startDate,
    historicalEndDate: args.endDate,
  });
  return {
    marketId: args.marketId,
    marketSymbol: String(market.market_symbol ?? ""),
    timeframe: CATALOG_STORAGE_TIMEFRAME,
    startDate: args.startDate,
    endDate: args.endDate,
    candleRowsUpserted: ingest.candleRowsUpserted,
  };
}
