import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketStatus = "trading" | "halted" | "delisted" | string;

export type MarketRow = {
  id: string;
  market_symbol: string;
  exchange_id: string;
  asset_id: string;
  quote_asset_id: string;
  status: MarketStatus;
  metadata: Record<string, unknown> | null;
  created_at?: string;
};

export type MarketIdAndSymbolRow = { id: string; market_symbol: string };
export type MarketIdAndAssetIdRow = { id: string; asset_id: string | null };
export type MarketIdSymbolExchangeRow = { id: string; market_symbol: string; exchange_id: string };
export type MarketIdSymbolQuoteAssetExchangeRow = {
  id: string;
  market_symbol: string | null;
  quote_asset_id: string;
  exchange_id: string;
};
export type MarketQuoteAssetIdRow = { quote_asset_id: string | null };
export type MarketIdSymbolQuoteRow = { id: string; market_symbol: string; quote_asset_id: string };
export type MarketAssetIdAndSymbolWithMcapRow = {
  asset_id: string;
  market_symbol: string | null;
  assets: { coingecko_market_cap_usd: number | string | null } | { coingecko_market_cap_usd: number | string | null }[] | null;
};

/** `select("id, market_symbol") .eq("id", id) .maybeSingle()` */
export async function selectIdAndSymbolById(
  client: SupabaseClient,
  id: string,
): Promise<MarketIdAndSymbolRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketIdAndSymbolRow | null) ?? null;
}

/** `select("id, market_symbol, exchange_id, quote_asset_id") .eq("id", id) .maybeSingle()` */
export async function selectCoreById(
  client: SupabaseClient,
  id: string,
): Promise<MarketIdSymbolQuoteAssetExchangeRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, exchange_id, quote_asset_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketIdSymbolQuoteAssetExchangeRow | null) ?? null;
}

/** `select("id, market_symbol, exchange_id") .eq("id", id) .maybeSingle()` */
export async function selectIdSymbolExchangeById(
  client: SupabaseClient,
  id: string,
): Promise<MarketIdSymbolExchangeRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, exchange_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketIdSymbolExchangeRow | null) ?? null;
}

/** `select("quote_asset_id") .eq("id", id) .maybeSingle()` */
export async function selectQuoteAssetIdById(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("quote_asset_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketQuoteAssetIdRow | null)?.quote_asset_id ?? null;
}

/** `select("id, market_symbol") .in("id", ids)` — bulk display lookup. */
export async function selectIdAndSymbolByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<MarketIdAndSymbolRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketIdAndSymbolRow[];
}

/** `select("id, asset_id") .in("id", ids)` — used by executors-lookup. */
export async function selectIdAndAssetIdByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<MarketIdAndAssetIdRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, asset_id")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketIdAndAssetIdRow[];
}

/** `select("id, asset_id") .eq("exchange_id", exchangeId) .eq("market_symbol", symbol) .maybeSingle()` */
export async function selectIdAndAssetIdByExchangeAndSymbol(
  client: SupabaseClient,
  args: { exchangeId: string; marketSymbol: string },
): Promise<{ id: string; asset_id: string } | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, asset_id")
    .eq("exchange_id", args.exchangeId)
    .eq("market_symbol", args.marketSymbol)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; asset_id: string } | null) ?? null;
}

/** `select("id, market_symbol, quote_asset_id") .eq("exchange_id", x) .eq("asset_id", y)` — historical paper market. */
export async function selectByExchangeAndAsset(
  client: SupabaseClient,
  args: { exchangeId: string; assetId: string },
): Promise<MarketIdSymbolQuoteRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, quote_asset_id")
    .eq("exchange_id", args.exchangeId)
    .eq("asset_id", args.assetId);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketIdSymbolQuoteRow[];
}

/** `select("id, market_symbol") .eq("exchange_id", x) .eq("asset_id", y) .eq("quote_asset_id", z)` */
export async function selectByExchangeAssetQuote(
  client: SupabaseClient,
  args: { exchangeId: string; assetId: string; quoteAssetId: string },
): Promise<MarketIdAndSymbolRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol")
    .eq("exchange_id", args.exchangeId)
    .eq("asset_id", args.assetId)
    .eq("quote_asset_id", args.quoteAssetId);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketIdAndSymbolRow[];
}

/** `select(asset_id, market_symbol, assets!fkey (coingecko_market_cap_usd)) .eq("exchange_id", x) .eq("quote_asset_id", y)` — exchange-close pipeline asset ranking. */
export async function selectAssetIdSymbolWithMcapByExchangeAndQuote(
  client: SupabaseClient,
  args: { exchangeId: string; quoteAssetId: string },
): Promise<MarketAssetIdAndSymbolWithMcapRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select(
      `
      asset_id,
      market_symbol,
      assets!markets_asset_id_fkey (
        coingecko_market_cap_usd
      )
    `,
    )
    .eq("exchange_id", args.exchangeId)
    .eq("quote_asset_id", args.quoteAssetId);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketAssetIdAndSymbolWithMcapRow[];
}

/** `select("id, market_symbol, exchange_id, asset_id, quote_asset_id, status, metadata") .eq("id", id) .maybeSingle()` */
export async function selectById(client: SupabaseClient, id: string): Promise<MarketRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select("id, market_symbol, exchange_id, asset_id, quote_asset_id, status, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketRow | null) ?? null;
}

/** `count(*) .eq("asset_id", id)` — used as base-asset reference count. */
export async function countByAssetId(client: SupabaseClient, assetId: string): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("markets")
    .select("*", { count: "exact", head: true })
    .eq("asset_id", assetId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `count(*) .eq("quote_asset_id", id)` — used as quote-asset reference count. */
export async function countByQuoteAssetId(client: SupabaseClient, quoteAssetId: string): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("markets")
    .select("*", { count: "exact", head: true })
    .eq("quote_asset_id", quoteAssetId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `count(*) .eq("exchange_id", id)` (+ optional `eq("quote_asset_id", q)`) — used by mediator/executor/signal `totalMarkets`. */
export async function countByExchangeAndOptionalQuote(
  client: SupabaseClient,
  args: { exchangeId: string; quoteAssetId?: string | null },
): Promise<number> {
  let q = client
    .schema("catalog")
    .from("markets")
    .select("id", { count: "exact", head: true })
    .eq("exchange_id", args.exchangeId);
  if (args.quoteAssetId) {
    q = q.eq("quote_asset_id", args.quoteAssetId);
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Markets list page projection: full row with embedded `quote_asset` + `exchanges`. */
export type MarketListRow = {
  id: string;
  market_symbol: string;
  exchange_id: string;
  status: MarketStatus;
  created_at: string;
  metadata: Record<string, unknown> | null;
  quote_asset: { code: string | null; kind: string | null } | { code: string | null; kind: string | null }[] | null;
  exchanges: { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null;
  assets:
    | { code: string | null; kind: string | null; name: string | null; coingecko_market_cap_usd: number | string | null; coingecko_total_volume_usd: number | string | null }
    | { code: string | null; kind: string | null; name: string | null; coingecko_market_cap_usd: number | string | null; coingecko_total_volume_usd: number | string | null }[]
    | null;
};

const MARKET_LIST_FIELDS = `
  id,
  market_symbol,
  exchange_id,
  status,
  created_at,
  metadata,
  quote_asset:assets!markets_quote_asset_id_fkey ( code, kind ),
  exchanges ( code, name ),
  assets!markets_asset_id_fkey ( code, kind, name, coingecko_market_cap_usd, coingecko_total_volume_usd )
`;

/** Markets list page total count. */
export async function countListForExchange(
  client: SupabaseClient,
  args: { exchangeId: string },
): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("markets")
    .select("*", { count: "exact", head: true })
    .eq("exchange_id", args.exchangeId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Markets list page rows. */
export async function selectListPaginatedForExchange(
  client: SupabaseClient,
  args: { exchangeId: string; from: number; to: number },
): Promise<MarketListRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select(MARKET_LIST_FIELDS)
    .eq("exchange_id", args.exchangeId)
    .order("market_symbol", { ascending: true })
    .range(args.from, args.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as MarketListRow[];
}

/** Market detail page wide row (with embedded asset + quote_asset + exchange). */
export type MarketDetailRow = {
  id: string;
  market_symbol: string;
  quote_asset_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  exchange_id: string;
  asset_id: string;
  assets: { id: string; code: string; kind: string; name: string | null } | { id: string; code: string; kind: string; name: string | null }[] | null;
  quote_asset: { id: string; code: string; kind: string; name: string | null } | { id: string; code: string; kind: string; name: string | null }[] | null;
  exchanges: { id: string; code: string; name: string | null } | { id: string; code: string; name: string | null }[] | null;
};

const MARKET_DETAIL_FIELDS = `
  id,
  market_symbol,
  quote_asset_id,
  status,
  metadata,
  created_at,
  exchange_id,
  asset_id,
  assets!markets_asset_id_fkey ( id, code, kind, name ),
  quote_asset:assets!markets_quote_asset_id_fkey ( id, code, kind, name ),
  exchanges ( id, code, name )
`;

/** Detail page lookup. */
export async function selectDetailById(client: SupabaseClient, id: string): Promise<MarketDetailRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .select(MARKET_DETAIL_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketDetailRow | null) ?? null;
}

/** Markets referenced by an asset (detail page related). */
export type MarketRelatedToAssetRow = {
  id: string;
  market_symbol: string;
  status: string;
  quote_asset: { code: string | null; kind: string | null } | { code: string | null; kind: string | null }[] | null;
  exchanges: { id: string; code: string | null; name: string | null } | { id: string; code: string | null; name: string | null }[] | null;
};

export async function selectRelatedByAssetId(
  client: SupabaseClient,
  args: { assetId: string; limit: number },
): Promise<{ rows: MarketRelatedToAssetRow[]; count: number | null }> {
  const { data, error, count } = await client
    .schema("catalog")
    .from("markets")
    .select(
      `
      id,
      market_symbol,
      status,
      quote_asset:assets!markets_quote_asset_id_fkey ( code, kind ),
      exchanges ( id, code, name )
    `,
      { count: "exact" },
    )
    .eq("asset_id", args.assetId)
    .order("market_symbol", { ascending: true })
    .limit(args.limit);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as MarketRelatedToAssetRow[], count: count ?? null };
}

/** Bulk upsert by `(exchange_id, market_symbol)`. */
export async function upsertManyByExchangeAndSymbol(
  client: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .schema("catalog")
    .from("markets")
    .upsert(rows, { onConflict: "exchange_id,market_symbol" });
  if (error) throw new Error(error.message);
}

/** Single upsert by `(exchange_id, market_symbol)` returning id. */
export async function upsertOneByExchangeAndSymbolReturningId(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client
    .schema("catalog")
    .from("markets")
    .upsert(row, { onConflict: "exchange_id,market_symbol" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error("markets upsert returned no id");
  return id;
}
