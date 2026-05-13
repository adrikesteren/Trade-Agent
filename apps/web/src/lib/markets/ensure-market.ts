import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveQuoteAssetId } from "@/lib/markets/resolve-quote-asset";

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

export type EnsureMarketResult =
  | { ok: true; marketId: string; exchangeId: string; assetId: string }
  | { ok: false; reason: "missing_quote_asset"; exchangeId: string; quote: string };

/**
 * Ensure a row exists in `assets` + `markets` for this exchange listing (one tradable pair).
 * Idempotent; safe for ingest and sync.
 * Skips creating a market when `quote` has no matching `catalog.assets` row (fiat ISO vs crypto code).
 */
export async function ensureMarket(supabase: SupabaseClient, params: { exchangeCode: string; marketSymbol: string }): Promise<EnsureMarketResult> {
  const market = params.marketSymbol.toUpperCase();
  const { base, quote } = parseMarketSymbol(market);

  const { data: ex, error: exErr } = await supabase
    .schema("catalog")
    .from("exchanges")
    .select("id")
    .eq("code", params.exchangeCode)
    .single();

  if (exErr || !ex) {
    throw new Error(`Exchange not found: ${params.exchangeCode}. Run DB migration (seed).`);
  }

  const exchangeId = ex.id as string;

  const { data: existing } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id, asset_id")
    .eq("exchange_id", exchangeId)
    .eq("market_symbol", market)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      marketId: existing.id as string,
      exchangeId,
      assetId: existing.asset_id as string,
    };
  }

  const quoteAssetId = await resolveQuoteAssetId(supabase, quote);
  if (!quoteAssetId) {
    return { ok: false, reason: "missing_quote_asset", exchangeId, quote };
  }

  const { data: assetRow, error: assetErr } = await supabase
    .schema("catalog")
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
    .schema("catalog")
    .from("markets")
    .upsert(
      {
        exchange_id: exchangeId,
        asset_id: assetId,
        market_symbol: market,
        quote_asset_id: quoteAssetId,
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

  const marketId = row.id as string;
  try {
    const { sweepBitvavoSingleMarketCatalogCandles } = await import(
      "@/lib/markets/sweep-bitvavo-single-market-catalog-candles"
    );
    await sweepBitvavoSingleMarketCatalogCandles(supabase, marketId);
  } catch {
    /* non-fatal: listing exists; candles can be filled by the EUR sweep */
  }

  return { ok: true, marketId, exchangeId, assetId };
}
