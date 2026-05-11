import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchBitvavoMarkets } from "@/lib/bitvavo/public/markets";

export type { BitvavoMarketRow } from "@/lib/bitvavo/public/markets";

/**
 * Fetches Bitvavo /v2/markets and upserts `markets` for the Bitvavo exchange.
 * Inserts **new** `catalog.assets` rows only (`kind`+`code`); never updates existing assets (names/metrics stay as-is).
 * @param quoteFilter e.g. "EUR" — only markets with this quote (reduces row count for UI).
 */
export async function syncBitvavoMarkets(
  supabase: SupabaseClient,
  quoteFilter: string | null = "EUR",
): Promise<{ upsertedAssets: number; upsertedListings: number }> {
  const markets = await fetchBitvavoMarkets();

  const { data: ex, error: exErr } = await supabase
    .schema("catalog")
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

  const { data: existingAssets, error: existingErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("kind", "crypto")
    .in("code", uniqueBases);

  if (existingErr) {
    throw new Error(existingErr.message);
  }

  const existingCodes = new Set(
    (existingAssets ?? []).map((a) => String(a.code).toUpperCase()),
  );

  const newBases = uniqueBases.filter((code) => !existingCodes.has(code));

  let insertedAssets = 0;
  if (newBases.length > 0) {
    const assetRows = newBases.map((code) => ({
      kind: "crypto" as const,
      code,
      name: code,
      metadata: {},
    }));

    const { error: assetsErr } = await supabase.schema("catalog").from("assets").upsert(assetRows, {
      onConflict: "kind,code",
    });
    if (assetsErr) {
      throw new Error(assetsErr.message);
    }
    insertedAssets = newBases.length;
  }

  const { data: assetRowsDb, error: selErr } = await supabase
    .schema("catalog")
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
    const { error: eaErr } = await supabase.schema("catalog").from("markets").upsert(chunk, {
      onConflict: "exchange_id,market_symbol",
    });
    if (eaErr) {
      throw new Error(eaErr.message);
    }
  }

  return {
    /** New `catalog.assets` rows inserted this run; existing assets are never updated by Bitvavo sync. */
    upsertedAssets: insertedAssets,
    upsertedListings: listingRows.length,
  };
}
