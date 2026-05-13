import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

function asIsoString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function isMissingCatalogRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "");
  if (/does not exist|undefined_function|Could not find the function/i.test(msg)) return true;
  if (String(error.code) === "42883") return true;
  return false;
}

/** @internal Legacy: max `close_time` across all rows in `candle_timestamps` (any timeframe). */
async function resolveLatestCatalogCandleCloseIsoLegacyGlobal(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .schema("catalog")
    .from("candle_timestamps")
    .select("close_time")
    .order("close_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`candle_timestamps: ${error.message}`);
  const t = data?.close_time;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * Latest catalog bar `close_time` among **all** candles of `timeframe` (typically `15m`).
 * Prefer this over the legacy global `candle_timestamps` max when multiple timeframes exist.
 */
export async function resolveLatestCatalogCandleCloseIso(
  admin: SupabaseClient,
  timeframe: string = CATALOG_STORAGE_TIMEFRAME,
): Promise<string | null> {
  const { data, error } = await admin.schema("catalog").rpc("catalog_max_close_time_for_timeframe", {
    p_timeframe: timeframe,
  });

  if (error) {
    if (isMissingCatalogRpc(error)) {
      return resolveLatestCatalogCandleCloseIsoLegacyGlobal(admin);
    }
    throw new Error(`catalog_max_close_time_for_timeframe: ${error.message}`);
  }

  return asIsoString(data);
}

/**
 * Latest `close_time` for **one** catalog market + timeframe (symbol-close-pipeline).
 * Avoids using a global timestamp from another market or another timeframe.
 */
export async function resolveLatestCatalogCandleCloseIsoForMarketTimeframe(
  admin: SupabaseClient,
  marketId: string,
  timeframe: string = CATALOG_STORAGE_TIMEFRAME,
): Promise<string | null> {
  const mid = String(marketId ?? "").trim();
  if (!mid) return null;

  const { data, error } = await admin.schema("catalog").rpc("catalog_max_close_time_for_market_timeframe", {
    p_market_id: mid,
    p_timeframe: timeframe,
  });

  if (error) {
    if (isMissingCatalogRpc(error)) {
      console.error(
        "[resolveLatestCatalogCandleCloseIsoForMarketTimeframe] Apply migration `20260627140000_catalog_max_close_time_for_timeframe.sql` (RPC `catalog.catalog_max_close_time_for_market_timeframe`).",
      );
      return null;
    }
    throw new Error(`catalog_max_close_time_for_market_timeframe: ${error.message}`);
  }

  return asIsoString(data);
}
