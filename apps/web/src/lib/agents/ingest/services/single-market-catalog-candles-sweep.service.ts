import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { barsForRetention } from "@/lib/agents/ingest/services/candle-retention.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import { syncBitvavoCandlesChunk } from "@/lib/agents/ingest/services/bitvavo-candles-chunk-sync.service";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

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
    .select("id, market_symbol, quote_asset_id, exchange_id")
    .eq("id", marketId)
    .maybeSingle();

  if (mErr) throw new Error(mErr.message);
  if (!mrow) throw new Error("market not found");

  const exCodeRaw = await ExchangesSelector.selectCodeById(supabase, mrow.exchange_id as string);
  const exCode = String(exCodeRaw ?? "").toLowerCase();
  if (exCode !== "bitvavo") {
    return { candleRowsUpserted: 0, marketSymbol: String(mrow.market_symbol) };
  }

  const { data: quoteRow, error: qErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("id", mrow.quote_asset_id as string)
    .maybeSingle();

  if (qErr) throw new Error(qErr.message);
  const quote = String(quoteRow?.code ?? "").toUpperCase();
  if (!quote) {
    throw new Error("market missing quote asset code");
  }

  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const barsPerMarket = barsForRetention(timeframe);

  const { data: ordered, error: listErr } = await supabase
    .schema("catalog")
    .rpc("bitvavo_markets_for_candle_sync_slice", {
      p_exchange_id: mrow.exchange_id as string,
      p_quote: quote,
      p_offset: 0,
      p_limit: 50_000,
    });

  if (listErr) throw new Error(listErr.message);
  const ids = (ordered ?? []).map((r: { id: string }) => r.id);
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
