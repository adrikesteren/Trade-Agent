import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Latest `close_time` in `catalog.candle_timestamps` (global bar grid).
 * Used after a **full** EUR candle sweep so signal workers still have a concrete bar to evaluate.
 */
export async function resolveLatestCatalogCandleCloseIso(admin: SupabaseClient): Promise<string | null> {
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
