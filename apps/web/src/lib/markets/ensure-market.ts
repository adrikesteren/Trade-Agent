import type { SupabaseClient } from "@supabase/supabase-js";

/** Bitvavo pairs use `BASE-QUOTE` (e.g. ETH-BTC, FUN-EUR). */
export function parseMarketSymbol(marketSymbol: string): { base: string; quote: string } {
  const i = marketSymbol.lastIndexOf("-");
  if (i <= 0 || i === marketSymbol.length - 1) {
    throw new Error(`Invalid market symbol: ${marketSymbol}`);
  }
  return {
    base: marketSymbol.slice(0, i).toUpperCase(),
    quote: marketSymbol.slice(i + 1).toUpperCase(),
  };
}

/**
 * Ensure a row exists in `assets` + `markets` for this exchange listing (one tradable pair).
 * Idempotent; safe for ingest and sync.
 */
export async function ensureMarket(
  supabase: SupabaseClient,
  params: { exchangeCode: string; marketSymbol: string },
): Promise<{ marketId: string; exchangeId: string; assetId: string }> {
  const market = params.marketSymbol.toUpperCase();
  const { base, quote } = parseMarketSymbol(market);

  const { data: ex, error: exErr } = await supabase
    .from("exchanges")
    .select("id")
    .eq("code", params.exchangeCode)
    .single();

  if (exErr || !ex) {
    throw new Error(`Exchange not found: ${params.exchangeCode}. Run DB migration (seed).`);
  }

  const exchangeId = ex.id as string;

  const { data: existing } = await supabase
    .from("markets")
    .select("id, asset_id")
    .eq("exchange_id", exchangeId)
    .eq("market_symbol", market)
    .maybeSingle();

  if (existing) {
    return {
      marketId: existing.id as string,
      exchangeId,
      assetId: existing.asset_id as string,
    };
  }

  const { data: assetRow, error: assetErr } = await supabase
    .from("assets")
    .upsert(
      {
        kind: "crypto" as const,
        code: base,
        name: base,
        metadata: {},
      },
      { onConflict: "kind,code" },
    )
    .select("id")
    .single();

  if (assetErr || !assetRow) {
    throw new Error(assetErr?.message ?? "asset upsert failed");
  }

  const assetId = assetRow.id as string;

  const { data: row, error: mErr } = await supabase
    .from("markets")
    .upsert(
      {
        exchange_id: exchangeId,
        asset_id: assetId,
        market_symbol: market,
        quote_code: quote,
        status: "trading",
        metadata: {},
      },
      { onConflict: "exchange_id,market_symbol" },
    )
    .select("id")
    .single();

  if (mErr || !row) {
    throw new Error(mErr?.message ?? "markets upsert failed");
  }

  return { marketId: row.id as string, exchangeId, assetId };
}
