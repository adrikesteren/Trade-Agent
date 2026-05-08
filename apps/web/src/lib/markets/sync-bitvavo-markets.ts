import type { SupabaseClient } from "@supabase/supabase-js";

export type BitvavoMarketRow = {
  market: string;
  status: string;
  base: string;
  quote: string;
  minOrderInQuoteAsset?: string;
  minOrderInBaseAsset?: string;
  [key: string]: unknown;
};

/**
 * Fetches Bitvavo /v2/markets and upserts `assets` + `markets` for the Bitvavo exchange.
 * @param quoteFilter e.g. "EUR" — only markets with this quote (reduces row count for UI).
 */
export async function syncBitvavoMarkets(
  supabase: SupabaseClient,
  quoteFilter: string | null = "EUR",
): Promise<{ upsertedAssets: number; upsertedListings: number }> {
  const res = await fetch("https://api.bitvavo.com/v2/markets", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Bitvavo markets HTTP ${res.status}`);
  }
  const markets = (await res.json()) as BitvavoMarketRow[];

  const { data: ex, error: exErr } = await supabase
    .from("exchanges")
    .select("id")
    .eq("code", "bitvavo")
    .single();

  if (exErr || !ex) {
    throw new Error("Bitvavo exchange row missing; apply migrations.");
  }

  const exchangeId = ex.id as string;

  const filtered = markets.filter((m) => {
    if (m.status !== "trading") return false;
    if (quoteFilter && m.quote !== quoteFilter) return false;
    return true;
  });

  const uniqueBases = [...new Set(filtered.map((m) => m.base.toUpperCase()))];

  const assetRows = uniqueBases.map((code) => ({
    kind: "crypto" as const,
    code,
    name: code,
    metadata: {},
  }));

  const { error: assetsErr } = await supabase.from("assets").upsert(assetRows, {
    onConflict: "kind,code",
  });
  if (assetsErr) {
    throw new Error(assetsErr.message);
  }

  const { data: assetRowsDb, error: selErr } = await supabase
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .in("code", uniqueBases);

  if (selErr || !assetRowsDb?.length) {
    throw new Error(selErr?.message ?? "assets select failed");
  }

  const codeToAssetId = new Map(
    assetRowsDb.map((a) => [String(a.code).toUpperCase(), a.id as string]),
  );

  const listingRows = filtered.map((m) => {
    const base = m.base.toUpperCase();
    const assetId = codeToAssetId.get(base);
    if (!assetId) {
      throw new Error(`Missing asset id for base ${base}`);
    }
    return {
      exchange_id: exchangeId,
      asset_id: assetId,
      market_symbol: m.market.toUpperCase(),
      quote_code: m.quote.toUpperCase(),
      status: m.status,
      metadata: {
        minOrderInQuoteAsset: m.minOrderInQuoteAsset,
        minOrderInBaseAsset: m.minOrderInBaseAsset,
        tickSize: m.tickSize,
        orderTypes: m.orderTypes,
      },
    };
  });

  const chunkSize = 200;
  for (let i = 0; i < listingRows.length; i += chunkSize) {
    const chunk = listingRows.slice(i, i + chunkSize);
    const { error: eaErr } = await supabase.from("markets").upsert(chunk, {
      onConflict: "exchange_id,market_symbol",
    });
    if (eaErr) {
      throw new Error(eaErr.message);
    }
  }

  return {
    upsertedAssets: uniqueBases.length,
    upsertedListings: listingRows.length,
  };
}
