import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { fetchExchangeIdByCode } from "@/lib/agents/executor/services/executors-lookup.service";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";

import { ingestHistoricalCandles } from "@/lib/agents/ingest/services/historical-candles-ingest.service";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns today's UTC date as `YYYY-MM-DD`. */
export function todayUtcYmd(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type RunMarketBackfillCandlesArgs = {
  /** `catalog.markets.id`. Must be a Bitvavo market with a non-empty quote asset code. */
  marketId: string;
  /** Inclusive UTC date `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive UTC date `YYYY-MM-DD`. Defaults to today (UTC) when null/empty/omitted. */
  endDate?: string | null;
};

export type RunMarketBackfillCandlesResult = {
  ok: true;
  marketId: string;
  marketSymbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  /** Candle rows upserted into `catalog.candles` by the Ingest Agent. */
  candleRowsUpserted: number;
};

/**
 * "Backfill candles" runner — Ingest Agent only for one market over a [start, end] UTC window.
 *
 * 1. Validates the market is a Bitvavo market with a non-empty quote asset code.
 * 2. {@link ingestHistoricalCandles} pulls the OHLCV history from Bitvavo into `catalog.candles` (1440-bar batches).
 */
export async function runMarketBackfillCandles(
  admin: SupabaseClient,
  args: RunMarketBackfillCandlesArgs,
): Promise<RunMarketBackfillCandlesResult> {
  const startDate = args.startDate.trim();
  const rawEnd = (args.endDate ?? "").trim();
  const endDate = rawEnd || todayUtcYmd();

  if (!ISO_DATE_RE.test(startDate)) {
    throw new Error(`Invalid startDate "${startDate}" — expected YYYY-MM-DD.`);
  }
  if (!ISO_DATE_RE.test(endDate)) {
    throw new Error(`Invalid endDate "${endDate}" — expected YYYY-MM-DD.`);
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }

  const marketId = args.marketId.trim();
  if (!marketId) {
    throw new Error("marketId is required.");
  }

  const mrow = await MarketsSelector.selectCoreById(admin, marketId);
  if (!mrow) throw new Error("Market not found.");
  const market = mrow as {
    id: string;
    market_symbol: string | null;
    exchange_id: string;
    quote_asset_id: string;
  };

  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(market.exchange_id) !== bitvavoId) {
    throw new Error("Backfill candles currently only supports Bitvavo markets.");
  }

  const quoteCode = await AssetsSelector.selectCodeById(admin, market.quote_asset_id);
  const quote = String(quoteCode ?? "").trim().toUpperCase();
  if (!quote) {
    throw new Error("Market is missing a quote asset code.");
  }

  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const marketSymbol = String(market.market_symbol ?? "");

  const ingest = await ingestHistoricalCandles(admin, {
    marketId,
    timeframe,
    quote,
    historicalStartDate: startDate,
    historicalEndDate: endDate,
  });

  return {
    ok: true,
    marketId,
    marketSymbol,
    timeframe,
    startDate,
    endDate,
    candleRowsUpserted: ingest.candleRowsUpserted,
  };
}
