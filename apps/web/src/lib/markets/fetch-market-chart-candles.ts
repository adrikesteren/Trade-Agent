import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandleRowJson } from "@/lib/markets/chart-types";
import * as CandlesSelector from "@/lib/selectors/candles-selector";

/**
 * Must stay aligned with PostgREST `[api] max_rows` (`supabase/config.toml`).
 * Unpaginated selects are capped; without `order` + `range`, the slice is arbitrary.
 */
export const CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE = 1000;

/** Hard cap per SSR / API call to avoid multi‑MB payloads (~416 days @ 15m). */
export const CATALOG_MARKET_CHART_CANDLE_MAX_ROWS = 40_000;

export type CatalogCandleOhlcvRow = {
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  candle_timestamps: unknown;
};

export function mapCatalogCandleRowToJson(r: CatalogCandleOhlcvRow): CandleRowJson | null {
  const rawTs = r.candle_timestamps;
  const ts = (Array.isArray(rawTs) ? rawTs[0] : rawTs) as
    | { open_time: string; close_time: string }
    | null
    | undefined;
  if (!ts?.open_time || !ts?.close_time) return null;
  return {
    openTime: ts.open_time,
    closeTime: ts.close_time,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

/**
 * Stored OHLCV rows for a market (catalog storage timeframe), ascending by bar `close_time`.
 * Paginates past PostgREST `max_rows`.
 */
export async function fetchAllMarketStorageCandles(
  supabase: SupabaseClient,
  args: { marketId: string; storageTimeframe: string },
): Promise<{ rows: CatalogCandleOhlcvRow[]; truncated: boolean }> {
  const { marketId, storageTimeframe } = args;
  const out: CatalogCandleOhlcvRow[] = [];
  let from = 0;

  while (out.length < CATALOG_MARKET_CHART_CANDLE_MAX_ROWS) {
    const room = CATALOG_MARKET_CHART_CANDLE_MAX_ROWS - out.length;
    const page = Math.min(CATALOG_MARKET_CHART_CANDLE_PAGE_SIZE, room);
    const to = from + page - 1;

    const data = await CandlesSelector.selectOhlcvPaginatedForMarket(supabase, {
      marketId,
      timeframe: storageTimeframe,
      from,
      to,
    });

    const chunk = data as CatalogCandleOhlcvRow[];
    if (!chunk.length) break;

    out.push(...chunk);
    from += chunk.length;

    if (chunk.length < page) break;
  }

  const truncated = out.length >= CATALOG_MARKET_CHART_CANDLE_MAX_ROWS;
  return { rows: out, truncated };
}
