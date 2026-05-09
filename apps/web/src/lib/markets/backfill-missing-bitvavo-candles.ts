import type { SupabaseClient } from "@supabase/supabase-js";
import { BitvavoAdapter } from "@repo/exchange";
import { barsForRetention, deleteExpiredMarketCandles } from "@/lib/markets/candle-retention";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

export type BackfillMissingCandlesResult = {
  seededMarkets: number;
  candleRowsUpserted: number;
  missingTotal: number;
  error?: string;
};

/**
 * For Bitvavo markets with `quote` that have no rows in `candles` for the catalog timeframe,
 * fetch OHLCV and upsert. Bounded by `maxMarkets` per call (avoid long HTTP requests).
 */
export async function backfillMissingBitvavoCandles(
  supabase: SupabaseClient,
  opts: { quote: string; maxMarkets: number; delayMsBetweenMarkets: number },
): Promise<BackfillMissingCandlesResult> {
  const timeframe = CATALOG_STORAGE_TIMEFRAME;
  const barsPerMarket = barsForRetention(timeframe);

  const { data: ex, error: exErr } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id")
    .eq("code", "bitvavo")
    .single();

  if (exErr || !ex) {
    throw new Error("Bitvavo exchange not found. Run migrations and market sync first.");
  }

  const exchangeId = ex.id as string;

  const { data: missingRows, error: missErr } = await supabase.rpc("markets_missing_catalog_candles", {
    p_exchange_id: exchangeId,
    p_quote: opts.quote,
    p_timeframe: timeframe,
  });

  if (missErr) {
    throw new Error(missErr.message);
  }

  const missing = (missingRows ?? []) as { id: string; market_symbol: string }[];
  const batch = missing.slice(0, Math.max(opts.maxMarkets, 0));

  const adapter = new BitvavoAdapter();
  let candleRowsUpserted = 0;

  for (let i = 0; i < batch.length; i++) {
    const m = batch[i]!;
    const marketSymbol = String(m.market_symbol);
    const marketId = m.id as string;

    const candles = await adapter.listCandles({
      symbol: marketSymbol,
      timeframe,
      limit: barsPerMarket,
    });

    const ecRows = candles.map((c) => ({
      market_id: marketId,
      timeframe: c.timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      open_time: c.openTime,
      close_time: c.closeTime,
    }));

    if (ecRows.length) {
      const chunkSize = 500;
      for (let j = 0; j < ecRows.length; j += chunkSize) {
        const part = ecRows.slice(j, j + chunkSize);
        const { error: upErr } = await supabase.schema("catalog").from("candles").upsert(part, {
          onConflict: "market_id,timeframe,close_time",
        });
        if (upErr) {
          throw new Error(`${marketSymbol}: ${upErr.message}`);
        }
        candleRowsUpserted += part.length;
      }
    }

    if (opts.delayMsBetweenMarkets > 0 && i < batch.length - 1) {
      await new Promise((r) => setTimeout(r, opts.delayMsBetweenMarkets));
    }
  }

  await deleteExpiredMarketCandles(supabase);

  return {
    seededMarkets: batch.length,
    candleRowsUpserted,
    missingTotal: missing.length,
  };
}
