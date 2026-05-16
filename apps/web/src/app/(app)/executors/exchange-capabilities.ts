import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

import type { ExchangeCapabilities } from "./executor-form";

/**
 * Read exchange-level capability rollups into a `Record<exchange_id, ExchangeCapabilities>`.
 *
 * Source: the `catalog.v_exchange_capabilities` view (see
 * `20260724020000_exchange_capabilities_view_and_drop.sql`). The view answers
 * "does this exchange support side X on at least one of its markets?" by
 * `bool_or`-ing the per-market columns on `catalog.markets`.
 *
 * Used by the executor create + edit forms so the "Trading stance" radio
 * can hide options the exchange has no market for (e.g. "Short only" / "Both
 * (SAR)" are hidden on a venue that doesn't support shorts anywhere). For
 * runtime per-market gating (mediator / executor) see
 * {@link ./market-capabilities}.
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
