import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveQuoteAssetId } from "@/lib/agents/ingest/services/quote-asset-resolve.service";
import * as ExchangesSelector from "@/lib/selectors/exchanges-selector";

/** Escape `%`, `_`, and `\` for use as a literal in PostgREST `ilike` without wildcards. */
export function escapeIlikeExactPattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type ResolvedPrimaryMarket = {
  marketId: string;
  marketSymbol: string;
  assetId: string;
  /** Canonical `catalog.assets.code` */
  assetCode: string;
  exchangeId: string;
  /** Canonical `catalog.exchanges.code` */
  exchangeCode: string;
  quoteCode: string;
};

export class ResolvePrimaryMarketError extends Error {
  readonly code:
    | "unknown_exchange_code"
    | "ambiguous_exchange_code"
    | "unknown_asset_code"
    | "ambiguous_asset_code"
    | "market_not_found_for_asset_exchange_quote"
    | "ambiguous_market_for_asset_exchange_quote";

  constructor(
    code: ResolvePrimaryMarketError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ResolvePrimaryMarketError";
    this.code = code;
  }
}

/**
 * Resolve the single catalog market for `assetCode` + `exchangeCode` + `quote` (default EUR).
 * Codes are matched case-insensitively against `catalog.assets` / `catalog.exchanges`.
 */
export async function resolvePrimaryMarketByCodes(
  supabase: SupabaseClient,
  args: { assetCode: string; exchangeCode: string; quote?: string },
): Promise<ResolvedPrimaryMarket> {
  const assetIn = args.assetCode.trim();
  const exchangeIn = args.exchangeCode.trim();
  if (!exchangeIn) {
    throw new ResolvePrimaryMarketError("unknown_exchange_code", "exchangeCode must be non-empty");
  }
  if (!assetIn) {
    throw new ResolvePrimaryMarketError("unknown_asset_code", "assetCode must be non-empty");
  }

  const quoteCode = (args.quote ?? "EUR").trim().toUpperCase() || "EUR";
  const exPattern = escapeIlikeExactPattern(exchangeIn);

  const exchanges = await ExchangesSelector.selectByCodeIlike(supabase, exPattern);
  if (exchanges.length === 0) {
    throw new ResolvePrimaryMarketError("unknown_exchange_code", `No exchange matches code: ${exchangeIn}`);
  }
  if (exchanges.length > 1) {
    throw new ResolvePrimaryMarketError(
      "ambiguous_exchange_code",
      `Multiple exchanges match code: ${exchangeIn}`,
    );
  }
  const exchange = exchanges[0]!;
  const exchangeId = exchange.id as string;
  const exchangeCode = String(exchange.code);

  const assetPattern = escapeIlikeExactPattern(assetIn);
  const { data: assetRows, error: assetErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .ilike("code", assetPattern);

  if (assetErr) throw new Error(assetErr.message);
  const assets = (assetRows ?? []) as { id: string; code: string }[];
  if (assets.length === 0) {
    throw new ResolvePrimaryMarketError("unknown_asset_code", `No crypto asset matches code: ${assetIn}`);
  }
  if (assets.length > 1) {
    throw new ResolvePrimaryMarketError("ambiguous_asset_code", `Multiple assets match code: ${assetIn}`);
  }
  const asset = assets[0]!;
  const assetId = asset.id as string;
  const assetCode = String(asset.code);

  const quoteAssetId = await resolveQuoteAssetId(supabase, quoteCode);
  if (!quoteAssetId) {
    throw new ResolvePrimaryMarketError(
      "market_not_found_for_asset_exchange_quote",
      `No catalog asset for quote ${quoteCode} (fiat ISO or crypto code)`,
    );
  }

  const { data: mRows, error: mErr } = await supabase
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("exchange_id", exchangeId)
    .eq("asset_id", assetId)
    .eq("quote_asset_id", quoteAssetId);

  if (mErr) throw new Error(mErr.message);
  const markets = (mRows ?? []) as { id: string; market_symbol: string }[];
  if (markets.length === 0) {
    throw new ResolvePrimaryMarketError(
      "market_not_found_for_asset_exchange_quote",
      `No market for asset ${assetCode} on exchange ${exchangeCode} with quote ${quoteCode}`,
    );
  }
  if (markets.length > 1) {
    throw new ResolvePrimaryMarketError(
      "ambiguous_market_for_asset_exchange_quote",
      `Multiple markets for asset ${assetCode} on exchange ${exchangeCode} with quote ${quoteCode}`,
    );
  }
  const m = markets[0]!;

  return {
    marketId: m.id as string,
    marketSymbol: String(m.market_symbol),
    assetId,
    assetCode,
    exchangeId,
    exchangeCode,
    quoteCode,
  };
}
