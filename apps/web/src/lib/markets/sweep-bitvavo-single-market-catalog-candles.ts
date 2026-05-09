import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { barsForRetention } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { syncBitvavoCandlesChunk } from "@/lib/markets/sync-bitvavo-candles-chunk";

/**
 * One full catalog-timeframe candle fetch for a single Bitvavo market (by `markets.id`).
 * Does not touch `sync_runs` (used after `ensureMarket` for new listings).
 */
export async function sweepBitvavoSingleMarketCatalogCandles(
  supabase: SupabaseClient,
  marketId: string,
): Promise<{ candleRowsUpserted: number; marketSymbol: string }> {
  const { data: mrow, error: mErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_code, exchange_id")
    .eq("id", marketId)
    .maybeSingle();

  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("market not found");

  const { data: exRow, error: exErr } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("code")
    .eq("id", mrow.exchange_id as string)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  const exCode = String(exRow?.code ?? "").toLowerCase();
  if (exCode !== "bitvavo") {
    return { candleRowsUpserted: 0, marketSymbol: String(mrow.market_symbol) };
  }

  const quote = String(mrow.quote_code ?? "").toUpperCase();
  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const barsPerMarket = barsForRetention(timeframe);

  const { data: ordered, error: listErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id")
    .eq("exchange_id", mrow.exchange_id as string)
    .eq("quote_code", quote)
    .order("market_symbol", { ascending: true });

  if (listErr) throw new Error(listErr.message);
  const ids = (ordered ?? []).map((r) => r.id as string);
  const offset = ids.indexOf(marketId);
  if (offset < 0) {
    throw new Error("market not in Bitvavo quote slice");
  }

  const r = await syncBitvavoCandlesChunk(supabase, {
    timeframe,
    barsPerMarket,
    quote,
    marketOffset: offset,
    marketBatchSize: 1,
    delayMsBetweenMarkets: 0,
  });

  return {
    candleRowsUpserted: r.candleRowsUpserted,
    marketSymbol: String(mrow.market_symbol),
  };
}
