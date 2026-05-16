import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-market capability flags as stored on `catalog.markets`.
 *
 * Source: `20260724000000_market_capabilities.sql`. Mediator + executor use
 * this for runtime side gating (defense-in-depth on top of the form-level
 * `ExchangeCapabilities` rollup view). The form-level rollup answers "does
 * this exchange support side X on any market?"; this helper answers "does
 * THIS market support side X?".
 *
 * Lives under `lib/catalog/` so both runtime agents (`lib/agents/...`) and
 * the executor form (`app/(app)/executors/...`) can import it without
 * crossing the app → lib layering.
 */
export type MarketCapabilities = {
  supports_spot_buy: boolean;
  supports_spot_sell: boolean;
  supports_margin_long: boolean;
  supports_margin_short: boolean;
};

/**
 * Batched lookup of per-market capability flags.
 *
 * Chunks the input list to stay within Postgres parameter limits and returns
 * a `Record<market_id, MarketCapabilities>`. Markets not in the result map
 * either don't exist or were filtered out by RLS — callers should treat
 * missing entries as "no side allowed" (safe-by-default).
 */
export async function fetchMarketCapabilitiesByMarketIds(
  supabase: SupabaseClient,
  marketIds: readonly string[],
): Promise<Record<string, MarketCapabilities>> {
  const uniq = [...new Set(marketIds.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (uniq.length === 0) return {};

  const out: Record<string, MarketCapabilities> = {};
  const chunkSize = 200;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const slice = uniq.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .schema("catalog")
      .from("markets")
      .select(
        "id, supports_spot_buy, supports_spot_sell, supports_margin_long, supports_margin_short",
      )
      .in("id", slice);
    if (error) {
      console.error("market capabilities:", error.message);
      continue;
    }
    for (const row of (data ?? []) as {
      id: string;
      supports_spot_buy: boolean | null;
      supports_spot_sell: boolean | null;
      supports_margin_long: boolean | null;
      supports_margin_short: boolean | null;
    }[]) {
      out[row.id] = {
        supports_spot_buy: Boolean(row.supports_spot_buy),
        supports_spot_sell: Boolean(row.supports_spot_sell),
        supports_margin_long: Boolean(row.supports_margin_long),
        supports_margin_short: Boolean(row.supports_margin_short),
      };
    }
  }
  return out;
}

/**
 * True if the given market accepts the given side. For `long` we require
 * either spot-buy or margin-long (so spot venues count). For `short` we
 * require margin-short.
 *
 * Missing capability entry (e.g. market not found) is treated as `false`
 * for both sides.
 */
export function marketSupportsSide(
  caps: MarketCapabilities | undefined | null,
  side: "long" | "short",
): boolean {
  if (!caps) return false;
  if (side === "long") return caps.supports_spot_buy || caps.supports_margin_long;
  return caps.supports_margin_short;
}
