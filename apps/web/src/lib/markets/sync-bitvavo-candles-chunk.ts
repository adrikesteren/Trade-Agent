import type { SupabaseClient } from "@supabase/supabase-js";
import { BitvavoAdapter } from "@repo/exchange";
import { barsForRetention, deleteExpiredMarketCandles } from "@/lib/markets/candle-retention";

export type SyncCandlesChunkOptions = {
  /** Bitvavo interval, e.g. 1h, 5m */
  timeframe: string;
  /** Bars per market (Bitvavo max 1440 per request). */
  barsPerMarket: number;
  /** Only markets with this quote, e.g. EUR. Null = all quotes. */
  quote: string | null;
  /** Zero-based index into the ordered list of matching markets. */
  marketOffset: number;
  /** How many markets to process in this chunk (one HTTP request per market). */
  marketBatchSize: number;
  /** Pause between Bitvavo calls (ms) to reduce rate-limit risk. */
  delayMsBetweenMarkets: number;
};

export type SyncCandlesChunkResult = {
  marketsProcessed: number;
  candleRowsUpserted: number;
  nextMarketOffset: number | null;
  totalMarkets: number;
  timeframe: string;
  /** Effective bars fetched (capped by retention window for this timeframe). */
  barsPerMarket: number;
  retentionMaxBars: number;
};

/**
 * For each row in `markets`, fetch OHLCV from Bitvavo REST and upsert `candles`.
 * Call repeatedly with increasing `marketOffset` until `nextMarketOffset` is null.
 */
export async function syncBitvavoCandlesChunk(
  supabase: SupabaseClient,
  opts: SyncCandlesChunkOptions,
): Promise<SyncCandlesChunkResult> {
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

  let countQuery = supabase
    .schema("catalog")
    .from("markets")
    .select("id", { count: "exact", head: true })
    .eq("exchange_id", exchangeId);

  if (opts.quote) {
    countQuery = countQuery.eq("quote_code", opts.quote.toUpperCase());
  }

  const { count: totalMarkets, error: countErr } = await countQuery;
  if (countErr) {
    throw new Error(countErr.message);
  }

  const total = totalMarkets ?? 0;

  const maxBars = barsForRetention(opts.timeframe);
  const effectiveBars = Math.min(Math.max(opts.barsPerMarket, 1), maxBars);

  let listQuery = supabase
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("exchange_id", exchangeId)
    .order("market_symbol", { ascending: true });

  if (opts.quote) {
    listQuery = listQuery.eq("quote_code", opts.quote.toUpperCase());
  }

  const from = opts.marketOffset;
  const to = opts.marketOffset + opts.marketBatchSize - 1;

  const { data: markets, error: listErr } = await listQuery.range(from, to);

  if (listErr) {
    throw new Error(listErr.message);
  }

  const rows = markets ?? [];
  const adapter = new BitvavoAdapter();
  let candleRowsUpserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]!;
    const marketSymbol = String(m.market_symbol);
    const marketId = m.id as string;

    const candles = await adapter.listCandles({
      symbol: marketSymbol,
      timeframe: opts.timeframe,
      limit: effectiveBars,
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

    if (opts.delayMsBetweenMarkets > 0 && i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, opts.delayMsBetweenMarkets));
    }
  }

  const processed = rows.length;
  const nextStart = from + processed;
  const nextMarketOffset = nextStart < total ? nextStart : null;

  await deleteExpiredMarketCandles(supabase);

  return {
    marketsProcessed: processed,
    candleRowsUpserted,
    nextMarketOffset,
    totalMarkets: total,
    timeframe: opts.timeframe,
    barsPerMarket: effectiveBars,
    retentionMaxBars: maxBars,
  };
}
