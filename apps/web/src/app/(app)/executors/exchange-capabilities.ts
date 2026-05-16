import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

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
  let rows: Awaited<ReturnType<typeof ExchangesSelector.selectAllCapabilities>>;
  try {
    rows = await ExchangesSelector.selectAllCapabilities(supabase);
  } catch (e) {
    console.error("exchange capabilities:", e instanceof Error ? e.message : String(e));
    return {};
  }
  const out: Record<string, ExchangeCapabilities> = {};
  for (const row of rows) {
    out[row.id] = {
      supports_spot_buy: Boolean(row.supports_spot_buy),
      supports_spot_sell: Boolean(row.supports_spot_sell),
      supports_margin_long: Boolean(row.supports_margin_long),
      supports_margin_short: Boolean(row.supports_margin_short),
    };
  }
  return out;
}
