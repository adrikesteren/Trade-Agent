import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExchangeCapabilities } from "./executor-form";

/**
 * Read all exchange capability flags into a `Record<exchange_id, ExchangeCapabilities>`.
 *
 * Used by the executor create + edit forms so the "Allowed sides" checkboxes can
 * be filtered to what the selected exchange actually supports (e.g. Bitvavo is
 * spot-only, so the short checkbox is hidden). Mirrors the columns added in
 * `20260723110000_exchange_capabilities.sql`.
 */
export async function fetchExchangeCapabilitiesById(
  supabase: SupabaseClient,
): Promise<Record<string, ExchangeCapabilities>> {
  const { data, error } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id, supports_spot_buy, supports_spot_sell, supports_margin_long, supports_margin_short");
  if (error) {
    console.error("exchange capabilities:", error.message);
    return {};
  }
  const out: Record<string, ExchangeCapabilities> = {};
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
  return out;
}
