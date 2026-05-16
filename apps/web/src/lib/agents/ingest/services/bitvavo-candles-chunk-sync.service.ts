import type { SupabaseClient } from "@supabase/supabase-js";
import { BitvavoAdapter, type Candle } from "@/lib/bitvavo/public/candles";
import { bitvavoListCandlesEndMs } from "@/lib/agents/ingest/services/bitvavo-list-candles-end-ms.service";
import { barsForIncrementalFetchWindow } from "@/lib/agents/ingest/services/candle-retention.service";
import { fetchAllCandleTimestampRowsForCandleWindow } from "@/lib/agents/ingest/services/candle-sync-window.service";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import * as CandlesSelector from "@/lib/selectors/candles-selector";
import * as CandleTimestampsSelector from "@/lib/selectors/candle-timestamps-selector";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";
import * as MarketsSelector from "@/lib/selectors/markets-selector";

export type CandleSyncMode = "full" | "incremental" | "window";

export type SyncCandlesChunkOptions = {
  /** Bitvavo interval, e.g. 1h, 15m */
  timeframe: string;
  /** Bars per market (Bitvavo max 1440 per request). Ignored when incremental or window. */
  barsPerMarket: number;
  /** Only markets with this quote, e.g. EUR. Null = all quotes. */
  quote: string | null;
  /** Zero-based index into the ordered list of matching markets. */
  marketOffset: number;
  /** How many markets to process in this chunk (one HTTP request per market). */
  marketBatchSize: number;
  /** Pause between Bitvavo calls (ms) to reduce rate-limit risk. */
  delayMsBetweenMarkets: number;
  /** When incremental: single bar for this catalog timestamp. */
  syncMode?: CandleSyncMode;
  /** Required when syncMode is incremental. */
  candleTimestampId?: string | null;
  /** When incremental: ISO close time of the target bar (Bitvavo `end` must align). */
  targetCloseTimeIso?: string | null;
  /** When window: pre-created `candle_timestamps` cover [start, end] (open/close ISO). */
  windowStartOpen?: string | null;
  windowEndClose?: string | null;
  windowBarCount?: number | null;
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
  syncMode: CandleSyncMode;
};

/** Stable map key: same instant may appear as `…T…Z` (Bitvavo) vs `… +00` (Postgres). */
function keyForTs(openIso: string, closeIso: string): string {
  const o = Date.parse(openIso);
  const c = Date.parse(closeIso);
  if (!Number.isFinite(o) || !Number.isFinite(c)) {
    return `invalid:${openIso}\0${closeIso}`;
  }
  return `${o}\0${c}`;
}

const BITVAVO_MAX_LIMIT = 1440;

/**
 * Fetches up to `totalBars` candles ending at or before `windowEndCloseMs`, oldest-first.
 * Splits into multiple Bitvavo calls when `totalBars` exceeds 1440.
 *
 * Bitvavo requires `end` to align exactly to the **end** of an interval; the oldest candle's
 * `openTime` equals the prior bar's close boundary, so it is a valid next `end` anchor (unlike `open - 1`).
 */
export async function listCandlesForWindow(
  adapter: Pick<BitvavoAdapter, "listCandles">,
  params: {
    symbol: string;
    timeframe: string;
    windowEndCloseMs: number;
    totalBars: number;
  },
): Promise<Candle[]> {
  const { symbol, timeframe, windowEndCloseMs, totalBars } = params;
  let endMs = windowEndCloseMs;
  let remaining = Math.max(totalBars, 1);
  const chunks: Candle[][] = [];
  let prevOldestOpenMs: number | null = null;

  while (remaining > 0) {
    const limit = Math.min(remaining, BITVAVO_MAX_LIMIT);
    const batch = await adapter.listCandles({
      symbol,
      timeframe,
      limit,
      endTime: String(Math.trunc(endMs)),
    });
    if (!batch.length) break;
    const oldest = batch[0]!;
    const oldestOpenMs = Date.parse(oldest.openTime);
    if (!Number.isFinite(oldestOpenMs)) {
      throw new Error(`${symbol}: invalid openTime from Bitvavo`);
    }
    if (prevOldestOpenMs !== null && oldestOpenMs >= prevOldestOpenMs) {
      break;
    }
    prevOldestOpenMs = oldestOpenMs;
    chunks.unshift(batch);
    remaining -= batch.length;
    endMs = oldestOpenMs;
    if (batch.length < limit) break;
  }

  return chunks.flat();
}

/**
 * For each row in `markets`, fetch OHLCV from Bitvavo REST and upsert `catalog.candles`.
 * Call repeatedly with increasing `marketOffset` until `nextMarketOffset` is null.
 *
 * Processing order: base asset `coingecko_market_cap_usd` descending (nulls last), then `market_symbol`
 * (see `catalog.bitvavo_markets_for_candle_sync_slice`).
 */
export async function syncBitvavoCandlesChunk(
  supabase: SupabaseClient,
  opts: SyncCandlesChunkOptions,
): Promise<SyncCandlesChunkResult> {
  const exchangeId = await ExchangesSelector.selectIdByCode(supabase, "bitvavo");

  const quoteFilter =
    opts.quote != null && String(opts.quote).trim() !== "" ? String(opts.quote).trim().toUpperCase() : null;
  const quoteAssetId = quoteFilter ? await resolveQuoteAssetId(supabase, quoteFilter) : null;
  if (quoteFilter && !quoteAssetId) {
    return {
      marketsProcessed: 0,
      candleRowsUpserted: 0,
      nextMarketOffset: null,
      totalMarkets: 0,
      timeframe: opts.timeframe,
      barsPerMarket: 0,
      retentionMaxBars: barsForIncrementalFetchWindow(opts.timeframe),
      syncMode: opts.syncMode ?? "full",
    };
  }

  const total = await MarketsSelector.countByExchangeAndOptionalQuote(supabase, {
    exchangeId,
    quoteAssetId,
  });

  const maxBars = barsForIncrementalFetchWindow(opts.timeframe);
  const windowMode =
    opts.syncMode === "window" &&
    Boolean(opts.windowStartOpen && opts.windowEndClose && opts.windowBarCount && opts.windowBarCount > 0);

  const incremental =
    opts.syncMode === "incremental" && Boolean(opts.candleTimestampId && opts.targetCloseTimeIso);

  let effectiveBars: number;
  let totalWindowBars: number | undefined;
  if (windowMode) {
    totalWindowBars = opts.windowBarCount!;
    effectiveBars = totalWindowBars;
  } else if (incremental) {
    effectiveBars = 1;
  } else {
    effectiveBars = Math.min(Math.max(opts.barsPerMarket, 1), maxBars);
  }

  const from = opts.marketOffset;
  const quoteArg = quoteFilter;

  const { data: markets, error: listErr } = await supabase
    .schema("catalog")
    .rpc("bitvavo_markets_for_candle_sync_slice", {
      p_exchange_id: exchangeId,
      p_quote: quoteArg,
      p_offset: from,
      p_limit: opts.marketBatchSize,
    });

  if (listErr) {
    throw new Error(listErr.message);
  }

  const rows = markets ?? [];
  const adapter = new BitvavoAdapter();
  let candleRowsUpserted = 0;

  let idByKey = new Map<string, string>();
  const idByCloseMs = new Map<number, string>();
  if (windowMode) {
    const startIso = String(opts.windowStartOpen);
    const endIso = String(opts.windowEndClose);
    const tsRows = await fetchAllCandleTimestampRowsForCandleWindow(supabase, {
      openTimeGteIso: startIso,
      closeTimeLteIso: endIso,
    });
    for (const r of tsRows) {
      idByKey.set(keyForTs(String(r.open_time), String(r.close_time)), r.id);
      const closeMs = Date.parse(String(r.close_time));
      if (Number.isFinite(closeMs)) idByCloseMs.set(closeMs, r.id);
    }
  }

  const endMsIncremental = incremental ? Date.parse(String(opts.targetCloseTimeIso)) : NaN;
  const endTimeParamIncremental =
    incremental && Number.isFinite(endMsIncremental) ? String(Math.trunc(endMsIncremental)) : undefined;

  /** Full sync: Bitvavo `end` must be last **closed** bar so we never anchor on an in-progress candle. */
  const endTimeParamFull =
    !windowMode && !incremental
      ? String(Math.trunc(bitvavoListCandlesEndMs(Date.now(), opts.timeframe)))
      : undefined;

  const windowEndCloseMs = windowMode ? Date.parse(String(opts.windowEndClose)) : NaN;
  const windowStartOpenMs = windowMode ? Date.parse(String(opts.windowStartOpen)) : NaN;

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]!;
    const marketSymbol = String(m.market_symbol);
    const marketId = m.id as string;

    let candles: Candle[];

    if (windowMode) {
      if (!Number.isFinite(windowEndCloseMs) || !Number.isFinite(windowStartOpenMs)) {
        throw new Error(`${marketSymbol}: invalid window bounds`);
      }
      candles = await listCandlesForWindow(adapter, {
        symbol: marketSymbol,
        timeframe: opts.timeframe,
        windowEndCloseMs,
        totalBars: totalWindowBars!,
      });
    } else {
      candles = await adapter.listCandles({
        symbol: marketSymbol,
        timeframe: opts.timeframe,
        limit: effectiveBars,
        ...(endTimeParamIncremental
          ? { endTime: endTimeParamIncremental }
          : endTimeParamFull
            ? { endTime: endTimeParamFull }
            : {}),
      });
    }

    let rowsToWrite: {
      market_id: string;
      timeframe: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      candle_timestamp_id: string;
    }[];

    if (windowMode) {
      rowsToWrite = [];
      let unmappedBitvavoInWindow = 0;
      for (const c of candles) {
        const openMs = Date.parse(c.openTime);
        const closeMs = Date.parse(c.closeTime);
        if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) continue;
        if (openMs < windowStartOpenMs - 1 || closeMs > windowEndCloseMs + 1) continue;
        let id = idByKey.get(keyForTs(c.openTime, c.closeTime));
        if (!id) id = idByCloseMs.get(closeMs);
        if (!id) {
          unmappedBitvavoInWindow += 1;
          continue;
        }
        rowsToWrite.push({
          market_id: marketId,
          timeframe: c.timeframe,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          candle_timestamp_id: id,
        });
      }
      if (unmappedBitvavoInWindow > 0) {
        throw new Error(
          `${marketSymbol}: ${unmappedBitvavoInWindow} Bitvavo candle(s) fall inside the sync window but could not be matched to ` +
            `catalog.candle_timestamps (open/close grid or ISO mismatch vs pre-seeded timestamps).`,
        );
      }
    } else if (incremental) {
      const tsId = opts.candleTimestampId as string;
      const wantCloseMs = Date.parse(String(opts.targetCloseTimeIso));
      const match = candles.filter((c) => {
        if (!Number.isFinite(wantCloseMs)) return c.closeTime === String(opts.targetCloseTimeIso);
        const d = Math.abs(Date.parse(c.closeTime) - wantCloseMs);
        return d < 2000;
      });
      rowsToWrite = match.map((c) => ({
        market_id: marketId,
        timeframe: c.timeframe,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        candle_timestamp_id: tsId,
      }));
    } else {
      const distinctPairs = new Map<string, { open_time: string; close_time: string }>();
      for (const c of candles) {
        const k = keyForTs(c.openTime, c.closeTime);
        if (!distinctPairs.has(k)) {
          distinctPairs.set(k, { open_time: c.openTime, close_time: c.closeTime });
        }
      }
      const pairList = [...distinctPairs.values()];
      idByKey = new Map<string, string>();
      if (pairList.length) {
        let tsRows: { id: string; open_time: string; close_time: string }[];
        try {
          tsRows = await CandleTimestampsSelector.upsertManyReturningRows(supabase, pairList);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`${marketSymbol}: candle_timestamps: ${msg}`);
        }
        for (const r of tsRows) {
          idByKey.set(keyForTs(String(r.open_time), String(r.close_time)), r.id);
        }
      }

      rowsToWrite = candles.map((c) => {
        const id = idByKey.get(keyForTs(c.openTime, c.closeTime));
        if (!id) {
          throw new Error(`${marketSymbol}: missing candle_timestamp_id for bar`);
        }
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
    }

    if (rowsToWrite.length) {
      const chunkSize = 500;
      for (let j = 0; j < rowsToWrite.length; j += chunkSize) {
        const part = rowsToWrite.slice(j, j + chunkSize);
        try {
          await CandlesSelector.upsertManyByMarketTimeframeCandleTs(supabase, part);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`${marketSymbol}: ${msg}`);
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

  // No TTL pruning anymore — all historical candles stay in `catalog.candles` indefinitely.
  // (Pre-cleanup this branch called `deleteExpiredCandleTimestamps(supabase)` here.)

  const resultMode: CandleSyncMode = windowMode ? "window" : incremental ? "incremental" : "full";

  return {
    marketsProcessed: processed,
    candleRowsUpserted,
    nextMarketOffset,
    totalMarkets: total,
    timeframe: opts.timeframe,
    barsPerMarket: effectiveBars,
    retentionMaxBars: windowMode ? (totalWindowBars ?? maxBars) : maxBars,
    syncMode: resultMode,
  };
}
