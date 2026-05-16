import type { SupabaseClient } from "@supabase/supabase-js";
import { BitvavoAdapter } from "@/lib/bitvavo/public/candles";
import { bitvavoListCandlesEndMs } from "@/lib/agents/ingest/services/bitvavo-list-candles-end-ms.service";
import { barsForRetention, deleteExpiredCandleTimestamps } from "@/lib/agents/ingest/services/candle-retention.service";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

export type BackfillMissingCandlesResult = {
  seededMarkets: number;
  candleRowsUpserted: number;
  missingTotal: number;
  error?: string;
};

/** Same as sync-bitvavo-candles-chunk: align Bitvavo ISO with Postgres timestamptz text. */
function keyForTs(openIso: string, closeIso: string): string {
  const o = Date.parse(openIso);
  const c = Date.parse(closeIso);
  if (!Number.isFinite(o) || !Number.isFinite(c)) {
    return `invalid:${openIso}\0${closeIso}`;
  }
  return `${o}\0${c}`;
}

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

  const exchangeId = await ExchangesSelector.selectIdByCode(supabase, "bitvavo");

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
      endTime: String(Math.trunc(bitvavoListCandlesEndMs(Date.now(), timeframe))),
    });

    const distinctPairs = new Map<string, { open_time: string; close_time: string }>();
    for (const c of candles) {
      const k = keyForTs(c.openTime, c.closeTime);
      if (!distinctPairs.has(k)) {
        distinctPairs.set(k, { open_time: c.openTime, close_time: c.closeTime });
      }
    }
    const pairList = [...distinctPairs.values()];
    const idByKey = new Map<string, string>();
    if (pairList.length) {
      const { data: tsRows, error: tsErr } = await supabase
        .schema("catalog")
        .from("candle_timestamps")
        .upsert(pairList, { onConflict: "open_time,close_time" })
        .select("id, open_time, close_time");
      if (tsErr) {
        throw new Error(`${marketSymbol}: candle_timestamps: ${tsErr.message}`);
      }
      for (const r of tsRows ?? []) {
        idByKey.set(keyForTs(String(r.open_time), String(r.close_time)), r.id as string);
      }
    }

    const rowsToWrite = candles.map((c) => {
      const id = idByKey.get(keyForTs(c.openTime, c.closeTime));
      if (!id) throw new Error(`${marketSymbol}: missing candle_timestamp_id for bar`);
      return {
        market_id: marketId,
        timeframe: c.timeframe,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        candle_timestamp_id: id,
      };
    });

    if (rowsToWrite.length) {
      const chunkSize = 500;
      for (let j = 0; j < rowsToWrite.length; j += chunkSize) {
        const part = rowsToWrite.slice(j, j + chunkSize);
        const { error: upErr } = await supabase.schema("catalog").from("candles").upsert(part, {
          onConflict: "market_id,timeframe,candle_timestamp_id",
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

  await deleteExpiredCandleTimestamps(supabase);

  return {
    seededMarkets: batch.length,
    candleRowsUpserted,
    missingTotal: missing.length,
  };
}
