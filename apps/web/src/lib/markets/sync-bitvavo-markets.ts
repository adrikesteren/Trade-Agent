import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchBitvavoMarkets } from "@/lib/bitvavo/public/markets";
import { fetchQuoteAssetIdsByCodes } from "@/lib/markets/resolve-quote-asset";

export type { BitvavoMarketRow } from "@/lib/bitvavo/public/markets";

/**
 * Fetches Bitvavo /v2/markets and upserts `markets` for the Bitvavo exchange.
 * Inserts **new** `catalog.assets` rows only (`kind`+`code`); never updates existing assets (names/metrics stay as-is).
 * @param quoteFilter e.g. "EUR" — only markets with this quote (reduces row count for UI).
 */
export async function syncBitvavoMarkets(
  supabase: SupabaseClient,
  quoteFilter: string | null = "EUR",
): Promise<{ upsertedAssets: number; upsertedListings: number; skippedMissingQuote: number }> {
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
  const uniqueQuotes = [...new Set(filtered.map((m) => String(m.quote).toUpperCase()))];

  const quoteIdByCode = await fetchQuoteAssetIdsByCodes(supabase, uniqueQuotes);

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

  let skippedMissingQuote = 0;
  const listingRows = filtered.flatMap((m) => {
    const base = m.base.toUpperCase();
    const assetId = codeToAssetId.get(base);
    if (!assetId) {
      throw new Error(`Missing asset id for base ${base}`);
    }
    const quoteUpper = String(m.quote).toUpperCase();
    const quoteAssetId = quoteIdByCode.get(quoteUpper);
    if (!quoteAssetId) {
      skippedMissingQuote += 1;
      return [];
    }
    return [
      {
        exchange_id: exchangeId,
        asset_id: assetId,
        market_symbol: m.market.toUpperCase(),
        quote_asset_id: quoteAssetId,
        status: m.status,
        metadata: {
          minOrderInQuoteAsset: m.minOrderInQuoteAsset,
          minOrderInBaseAsset: m.minOrderInBaseAsset,
          tickSize: m.tickSize,
          orderTypes: m.orderTypes,
        },
      },
    ];
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
    skippedMissingQuote,
  };
}

export type UpsertBitvavoMarketsForExistingAssetsResult = {
  fetchedFromApi: number;
  tradingMarkets: number;
  marketsUpserted: number;
  skippedMissingAsset: number;
  skippedMissingQuote: number;
};

const ASSET_CODES_CHUNK = 500;
const MARKET_UPSERT_CHUNK = 200;

/**
 * Fetches Bitvavo `GET /v2/markets` and upserts `catalog.markets` only when the base symbol matches an
 * existing `catalog.assets` row (`kind` = `crypto`, `code` = uppercase base). Does **not** create assets.
 */
export async function upsertBitvavoMarketsForExistingAssets(
  supabase: SupabaseClient,
  opts: { quoteFilter?: string | null } = {},
): Promise<UpsertBitvavoMarketsForExistingAssetsResult> {
  const quoteFilter = opts.quoteFilter ?? null;
  const quoteNorm = quoteFilter != null && quoteFilter !== "" ? quoteFilter.toUpperCase() : null;

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
    if (quoteNorm && String(m.quote).toUpperCase() !== quoteNorm) return false;
    return true;
  });

  const uniqueBases = [...new Set(filtered.map((m) => String(m.base).toUpperCase()))];
  const uniqueQuotes = [...new Set(filtered.map((m) => String(m.quote).toUpperCase()))];

  const quoteIdByCode = await fetchQuoteAssetIdsByCodes(supabase, uniqueQuotes);

  const codeToAssetId = new Map<string, string>();
  for (let i = 0; i < uniqueBases.length; i += ASSET_CODES_CHUNK) {
    const slice = uniqueBases.slice(i, i + ASSET_CODES_CHUNK);
    const { data: assetRowsDb, error: selErr } = await supabase
      .schema("catalog")
      .from("assets")
      .select("id, code")
      .eq("kind", "crypto")
      .in("code", slice);

    if (selErr) {
      throw new Error(selErr.message);
    }
    for (const a of assetRowsDb ?? []) {
      codeToAssetId.set(String(a.code).toUpperCase(), a.id as string);
    }
  }

  const listingRows: {
    exchange_id: string;
    asset_id: string;
    market_symbol: string;
    quote_asset_id: string;
    status: string;
    metadata: {
      minOrderInQuoteAsset?: string;
      minOrderInBaseAsset?: string;
      tickSize: unknown;
      orderTypes: unknown;
    };
  }[] = [];

  let skippedMissingAsset = 0;
  let skippedMissingQuote = 0;
  for (const m of filtered) {
    const base = String(m.base).toUpperCase();
    const assetId = codeToAssetId.get(base);
    if (!assetId) {
      skippedMissingAsset += 1;
      continue;
    }
    const quoteUpper = String(m.quote).toUpperCase();
    const quoteAssetId = quoteIdByCode.get(quoteUpper);
    if (!quoteAssetId) {
      skippedMissingQuote += 1;
      continue;
    }
    listingRows.push({
      exchange_id: exchangeId,
      asset_id: assetId,
      market_symbol: String(m.market).toUpperCase(),
      quote_asset_id: quoteAssetId,
      status: m.status,
      metadata: {
        minOrderInQuoteAsset: m.minOrderInQuoteAsset,
        minOrderInBaseAsset: m.minOrderInBaseAsset,
        tickSize: m.tickSize,
        orderTypes: m.orderTypes,
      },
    });
  }

  for (let i = 0; i < listingRows.length; i += MARKET_UPSERT_CHUNK) {
    const chunk = listingRows.slice(i, i + MARKET_UPSERT_CHUNK);
    const { error: eaErr } = await supabase.schema("catalog").from("markets").upsert(chunk, {
      onConflict: "exchange_id,market_symbol",
    });
    if (eaErr) {
      throw new Error(eaErr.message);
    }
  }

  return {
    fetchedFromApi: markets.length,
    tradingMarkets: filtered.length,
    marketsUpserted: listingRows.length,
    skippedMissingAsset,
    skippedMissingQuote,
  };
}
