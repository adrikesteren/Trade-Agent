import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 120;

function unwrapOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/** One catalog bar row (PostgREST cannot embed `catalog.candles` from `trading.signals` in one query). */
export type CatalogCandleBar = {
  id: string;
  market_id: string;
  timeframe: string;
  close: unknown;
  close_time: string | null;
};

/**
 * Batch-load `catalog.candles` (+ `candle_timestamps.close_time`) by primary key.
 * Use instead of `signals(candles(...))` when querying via `.schema("trading")`.
 */
export async function fetchCatalogCandlesByIds(
  supabase: SupabaseClient,
  candleIds: string[],
): Promise<Map<string, CatalogCandleBar>> {
  const map = new Map<string, CatalogCandleBar>();
  const uniq = [...new Set(candleIds)].map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .schema("catalog")
      .from("candles")
      .select("id, market_id, timeframe, close, candle_timestamps ( close_time )")
      .in("id", chunk);
    if (error) {
      console.error("fetchCatalogCandlesByIds:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      const id = String((row as { id: string }).id);
      const ct = unwrapOne((row as { candle_timestamps?: unknown }).candle_timestamps);
      const iso =
        ct && typeof (ct as { close_time?: unknown }).close_time === "string"
          ? String((ct as { close_time: string }).close_time).trim() || null
          : null;
      map.set(id, {
        id,
        market_id: String((row as { market_id?: string }).market_id ?? "").trim(),
        timeframe: String((row as { timeframe?: string }).timeframe ?? "").trim(),
        close: (row as { close?: unknown }).close,
        close_time: iso,
      });
    }
  }
  return map;
}
