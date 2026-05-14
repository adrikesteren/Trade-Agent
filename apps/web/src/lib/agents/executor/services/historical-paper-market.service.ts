import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchExchangeIdByCode } from "./executors-lookup.service";

/** Replay + candle ingest use this quote (Bitvavo EUR pairs). */
export const HISTORICAL_EXECUTOR_REPLAY_QUOTE = "EUR" as const;

export type HistoricalExecutorPaperMarket = {
  marketId: string;
  marketSymbol: string;
  /** `catalog.markets.quote_asset_id` (authoritative for wallet + trades, may differ from `resolveQuoteAssetId("EUR")`). */
  quoteAssetId: string;
};

type MarketRow = { id: string; market_symbol: string | null; quote_asset_id: string };

/**
 * Bitvavo paper market for historical replay: executor exchange + base asset from the filter.
 * Resolves EUR by **catalog quote asset code** on the market row (fiat preferred), not by equality
 * to `resolveQuoteAssetId`, so legacy `quote_asset_id` values still match GIGA-EUR etc.
 */
export async function fetchHistoricalExecutorPaperMarket(
  admin: SupabaseClient,
  args: { executorExchangeId: string; filterBaseAssetId: string },
): Promise<HistoricalExecutorPaperMarket | null> {
  const bitvavoId = await fetchExchangeIdByCode(admin, "bitvavo");
  if (String(args.executorExchangeId) !== bitvavoId) return null;

  const { data: mkts, error: mErr } = await admin
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_asset_id")
    .eq("exchange_id", bitvavoId)
    .eq("asset_id", args.filterBaseAssetId);
  if (mErr) throw new Error(mErr.message);

  const list = (mkts ?? []) as MarketRow[];
  if (list.length === 0) return null;

  const quoteIds = [...new Set(list.map((m) => m.quote_asset_id).filter(Boolean))];
  if (quoteIds.length === 0) return null;

  const { data: assets, error: aErr } = await admin
    .schema("catalog")
    .from("assets")
    .select("id, code, kind")
    .in("id", quoteIds);
  if (aErr) throw new Error(aErr.message);

  const byQuoteId = new Map(
    (assets ?? []).map((r) => [String((r as { id: string }).id), r as { id: string; code: string; kind: string }]),
  );

  const eurMkts = list.filter((m) => String(byQuoteId.get(m.quote_asset_id)?.code ?? "").toUpperCase() === "EUR");
  if (eurMkts.length === 0) return null;

  const rank = (m: MarketRow) => (byQuoteId.get(m.quote_asset_id)?.kind === "fiat" ? 0 : 1);
  eurMkts.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

  const m = eurMkts[0]!;
  return {
    marketId: m.id,
    marketSymbol: String(m.market_symbol ?? ""),
    quoteAssetId: m.quote_asset_id,
  };
}
