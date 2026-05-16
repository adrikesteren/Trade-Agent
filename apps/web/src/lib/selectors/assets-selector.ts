import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Asset kind discriminator (mirror of `catalog.assets.kind`). */
export type AssetKind = "crypto" | "fiat";

/** Minimal projection — id + code only. */
export type AssetIdCodeRow = { id: string; code: string };

/** Display projection — id + code + name (used by reconcile / slack rendering). */
export type AssetIdCodeNameRow = { id: string; code: string; name: string | null };

/** Locale projection — id + code + kind + dollar_value. */
export type AssetLocaleRow = {
  id: string;
  code: string;
  kind: AssetKind;
  dollar_value: number | string | null;
};

/** Crypto-sync projection — id + code + metadata. */
export type AssetCryptoMetaRow = {
  id: string;
  code: string;
  metadata: Record<string, unknown> | null;
};

/** Crypto-CoinGecko-sync projection — full set used by the discovery loops. */
export type AssetCryptoCoinIdRow = {
  id: string;
  code: string;
  name: string | null;
  metadata: Record<string, unknown> | null;
  coingecko_coin_id: string | null;
};

/** Variant of {@link AssetCryptoCoinIdRow} that includes the market-cap ranking column. */
export type AssetCryptoCoinIdMcapRow = AssetCryptoCoinIdRow & {
  coingecko_market_cap_usd: number | string | null;
};

/** Variant of {@link AssetCryptoCoinIdRow} that includes `kind` (used by the per-code lookup). */
export type AssetCryptoCoinIdKindRow = AssetCryptoCoinIdRow & { kind: AssetKind };

/** Metrics-sync projection — id + code + coingecko_coin_id. */
export type AssetMetricsCryptoRow = { id: string; code: string; coingecko_coin_id: string | null };

/** Metrics-sync projection (no `code`). */
export type AssetIdAndCoinIdRow = { id: string; coingecko_coin_id: string | null };

/** Detail projection used by the assets list page. */
export type AssetListRow = {
  id: string;
  code: string;
  kind: AssetKind;
  name: string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
};

/** Wide row used by the asset edit / setCoingeckoCoinId action. */
export type AssetEditRow = {
  id: string;
  code: string;
  kind: AssetKind;
  metadata: Record<string, unknown> | null;
};

/** Narrow row used by the find-coin-id enqueue action. */
export type AssetFindCoinIdRow = {
  id: string;
  code: string;
  kind: AssetKind;
  coingecko_coin_id: string | null;
};

/** Narrow row used by the executor quote-budget conversion (id + dollar_value only). */
export type AssetIdDollarValueRow = { id: string; dollar_value: number | string | null };

/** Narrow row for the kind+id+code projection used by the historical paper-market resolver. */
export type AssetKindRow = { id: string; code: string; kind: AssetKind };

/**
 * Detail-page projection (asset metadata + every CoinGecko column the detail UI shows).
 * Kept here so the SELECT-string and the row-type stay in sync.
 */
export type AssetDetailRow = {
  id: string;
  code: string;
  kind: AssetKind;
  name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  coingecko_fetched_at: string | null;
  coingecko_coin_id: string | null;
  coingecko_price_usd: number | string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_fdv_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
  coingecko_high_24h_usd: number | string | null;
  coingecko_low_24h_usd: number | string | null;
  coingecko_price_change_24h_usd: number | string | null;
  coingecko_price_change_24h_pct: number | string | null;
  coingecko_price_change_7d_pct: number | string | null;
  coingecko_market_cap_rank: number | string | null;
  coingecko_circulating_supply: number | string | null;
  coingecko_total_supply: number | string | null;
  coingecko_max_supply: number | string | null;
  coingecko_ath_usd: number | string | null;
  coingecko_ath_change_pct: number | string | null;
};

const ASSET_DETAIL_FIELDS =
  "id, code, kind, name, metadata, created_at, coingecko_fetched_at, coingecko_coin_id, coingecko_price_usd, coingecko_market_cap_usd, coingecko_fdv_usd, coingecko_total_volume_usd, coingecko_high_24h_usd, coingecko_low_24h_usd, coingecko_price_change_24h_usd, coingecko_price_change_24h_pct, coingecko_price_change_7d_pct, coingecko_market_cap_rank, coingecko_circulating_supply, coingecko_total_supply, coingecko_max_supply, coingecko_ath_usd, coingecko_ath_change_pct";

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/** `select("id, code, kind, dollar_value") .eq("id", id) .maybeSingle()` — locale primary fiat lookup. */
export async function selectLocaleById(client: SupabaseClient, id: string): Promise<AssetLocaleRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, dollar_value")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetLocaleRow | null) ?? null;
}

/** `select("id, name, code") .in("id", ids)` — display lookup for slack / reconcile. */
export async function selectIdCodeNameByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<AssetIdCodeNameRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, name, code")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeNameRow[];
}

/** `select("id, code") .in("id", ids)` — bulk id→code resolution. */
export async function selectIdCodeByIds(client: SupabaseClient, ids: string[]): Promise<AssetIdCodeRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("code") .eq("id", id) .maybeSingle()` — narrow code lookup. */
export async function selectCodeById(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const code = (data as { code: string | null } | null)?.code;
  return code ?? null;
}

/** `select("id, code, metadata") .eq("kind","crypto") .in("code", codes)` — crypto sync lookup. */
export async function selectCryptoIdCodeMetaByCodes(
  client: SupabaseClient,
  codes: string[],
): Promise<AssetCryptoMetaRow[]> {
  if (codes.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, metadata")
    .eq("kind", "crypto")
    .in("code", codes);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetCryptoMetaRow[];
}

/** `select("code, metadata") .eq("kind","crypto") .in("code", codes)` — crypto sync (no id). */
export async function selectCryptoCodeMetaByCodes(
  client: SupabaseClient,
  codes: string[],
): Promise<{ code: string; metadata: Record<string, unknown> | null }[]> {
  if (codes.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("code, metadata")
    .eq("kind", "crypto")
    .in("code", codes);
  if (error) throw new Error(error.message);
  return (data ?? []) as { code: string; metadata: Record<string, unknown> | null }[];
}

/** `select("code") .eq("kind","crypto") .in("code", codes)` — existing-codes filter. */
export async function selectExistingCryptoCodes(client: SupabaseClient, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("code")
    .eq("kind", "crypto")
    .in("code", codes);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { code: string }[]).map((r) => r.code);
}

/** `select("id, code") .eq("kind","crypto") .in("code", codes)` — id resolution after upsert. */
export async function selectCryptoIdCodeByCodes(
  client: SupabaseClient,
  codes: string[],
): Promise<AssetIdCodeRow[]> {
  if (codes.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .in("code", codes);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/**
 * `select("id, code, name, metadata, coingecko_coin_id, coingecko_market_cap_usd")
 *   .eq("kind","crypto") .order(mcap desc nulls last) .order(code asc)`
 * — full crypto list ordered by market cap, used by the CoinGecko coin-id sync loop.
 */
export async function selectAllCryptoOrderedByMcap(
  client: SupabaseClient,
): Promise<AssetCryptoCoinIdMcapRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, name, metadata, coingecko_coin_id, coingecko_market_cap_usd")
    .eq("kind", "crypto")
    .order("coingecko_market_cap_usd", { ascending: false, nullsFirst: false })
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetCryptoCoinIdMcapRow[];
}

/**
 * `select("id, code, name, metadata, coingecko_coin_id, kind") .eq("kind","crypto")
 *   .ilike("code", pattern) .maybeSingle()` — single crypto by code (case-insensitive).
 */
export async function selectCryptoByCodeIlike(
  client: SupabaseClient,
  pattern: string,
): Promise<AssetCryptoCoinIdKindRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, name, metadata, coingecko_coin_id, kind")
    .eq("kind", "crypto")
    .ilike("code", pattern)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetCryptoCoinIdKindRow | null) ?? null;
}

/** `select("id, code, name, metadata, coingecko_coin_id") .eq("kind","crypto")` — full crypto list. */
export async function selectAllCryptoCoinIds(client: SupabaseClient): Promise<AssetCryptoCoinIdRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, name, metadata, coingecko_coin_id")
    .eq("kind", "crypto");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetCryptoCoinIdRow[];
}

/** `select("coingecko_coin_id") .eq("kind","crypto")` — count remaining-without-coin-id. */
export async function selectAllCryptoCoinIdValues(
  client: SupabaseClient,
): Promise<{ coingecko_coin_id: string | null }[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("coingecko_coin_id")
    .eq("kind", "crypto");
  if (error) throw new Error(error.message);
  return (data ?? []) as { coingecko_coin_id: string | null }[];
}

/** `select("id, code, coingecko_coin_id") .eq("kind","crypto") .order("code")` — metrics-sync source list. */
export async function selectAllCryptoForMetricsSync(
  client: SupabaseClient,
): Promise<AssetMetricsCryptoRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, coingecko_coin_id")
    .eq("kind", "crypto")
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetMetricsCryptoRow[];
}

/** `select("id, coingecko_coin_id") .eq("kind","crypto") .in("id", ids)` — metrics-sync narrow lookup. */
export async function selectCryptoCoinIdsByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<AssetIdAndCoinIdRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, coingecko_coin_id")
    .eq("kind", "crypto")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdAndCoinIdRow[];
}

/** `select("id, code") .eq("kind","fiat")` — list all fiat assets. */
export async function selectAllFiats(client: SupabaseClient): Promise<AssetIdCodeRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "fiat");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("id, code") .eq("kind","fiat") .order("code") .limit(N)` — preferences page fiat options. */
export async function selectFiatsOrdered(
  client: SupabaseClient,
  limit?: number,
): Promise<AssetIdCodeRow[]> {
  let q = client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "fiat")
    .order("code", { ascending: true });
  if (limit != null && Number.isFinite(limit)) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("id") .eq("id", id) .eq("kind","fiat") .maybeSingle()` — verify an id is a fiat asset. */
export async function selectFiatIdById(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id")
    .eq("id", id)
    .eq("kind", "fiat")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const out = (data as { id: string } | null)?.id;
  return out ?? null;
}

/** `select("id, code, kind") .in("id", ids)` — paper-market quote resolution. */
export async function selectIdCodeKindByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<AssetKindRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetKindRow[];
}

/** `select("id, code") .eq("kind","crypto") .ilike("code", pattern)` — crypto code matcher. */
export async function selectCryptoIdCodeByCodeIlike(
  client: SupabaseClient,
  pattern: string,
): Promise<AssetIdCodeRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", "crypto")
    .ilike("code", pattern);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("id, code, kind") .in("code", codes)` — quote-asset resolver. */
export async function selectByCodes(client: SupabaseClient, codes: string[]): Promise<AssetKindRow[]> {
  if (codes.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind")
    .in("code", codes);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetKindRow[];
}

/** `select("id, dollar_value") .in("id", ids)` — dollar-value lookup for budget conversion. */
export async function selectIdDollarValueByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<AssetIdDollarValueRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, dollar_value")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdDollarValueRow[];
}

/** `select("*", { count: "exact", head: true })` — total row count for pagination. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("assets")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * `select("id, code, kind, name, coingecko_market_cap_usd, coingecko_total_volume_usd")
 *   .order(mcap desc nulls last) .order(code asc) .range(from, to)` — paginated list page.
 */
export async function selectAllPaginatedOrderedByMcap(
  client: SupabaseClient,
  range: { from: number; to: number },
): Promise<AssetListRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, name, coingecko_market_cap_usd, coingecko_total_volume_usd")
    .order("coingecko_market_cap_usd", { ascending: false, nullsFirst: false })
    .order("code", { ascending: true })
    .range(range.from, range.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetListRow[];
}

/** Detail-page lookup by uuid. Wide projection used by the asset-detail page. */
export async function selectDetailById(
  client: SupabaseClient,
  id: string,
): Promise<AssetDetailRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select(ASSET_DETAIL_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetDetailRow | null) ?? null;
}

/** Detail-page lookup by `code` restricted to `kind = "fiat"`. */
export async function selectDetailByCodeFiat(
  client: SupabaseClient,
  code: string,
): Promise<AssetDetailRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select(ASSET_DETAIL_FIELDS)
    .eq("code", code)
    .eq("kind", "fiat")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetDetailRow | null) ?? null;
}

/** Detail-page lookup by `code` restricted to a set of kinds (e.g. `["crypto", "stock"]`). */
export async function selectDetailByCodeForKinds(
  client: SupabaseClient,
  code: string,
  kinds: string[],
): Promise<AssetDetailRow | null> {
  if (kinds.length === 0) return null;
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select(ASSET_DETAIL_FIELDS)
    .eq("code", code)
    .in("kind", kinds)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetDetailRow | null) ?? null;
}

/** `select("id, code") .eq("kind", kind) .order("code") .limit(N)` — dropdown options for one kind. */
export async function selectIdCodeByKindOrderedLimited(
  client: SupabaseClient,
  kind: AssetKind,
  limit: number,
): Promise<AssetIdCodeRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("kind", kind)
    .order("code", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("id, code") .in("kind", kinds) .order("code") .limit(N)` — dropdown options for multiple kinds. */
export async function selectIdCodeByKindsOrderedLimited(
  client: SupabaseClient,
  kinds: AssetKind[],
  limit: number,
): Promise<AssetIdCodeRow[]> {
  if (kinds.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .in("kind", kinds)
    .order("code", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetIdCodeRow[];
}

/** `select("id, code, kind, metadata") .eq("id", id) .maybeSingle()` — edit-action lookup. */
export async function selectEditById(client: SupabaseClient, id: string): Promise<AssetEditRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetEditRow | null) ?? null;
}

/** `select("id, code, kind, coingecko_coin_id") .eq("id", id) .maybeSingle()` — find-coin-id action. */
export async function selectFindCoinIdRowById(
  client: SupabaseClient,
  id: string,
): Promise<AssetFindCoinIdRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, coingecko_coin_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetFindCoinIdRow | null) ?? null;
}

/** `select("id, code") .eq("id", id) .maybeSingle()` — minimal lookup before delete. */
export async function selectIdCodeById(client: SupabaseClient, id: string): Promise<AssetIdCodeRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .select("id, code")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssetIdCodeRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/** `update({ name, metadata }) .eq("id", id)` — bitvavo asset-data sync writeback. */
export async function updateNameAndMetadataById(
  client: SupabaseClient,
  id: string,
  patch: { name: string | null; metadata: Record<string, unknown> | null },
): Promise<void> {
  const { error } = await client.schema("catalog").from("assets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** `update({ coingecko_coin_id }) .eq("id", id)` — narrow coin-id writeback. */
export async function updateCoingeckoCoinIdById(
  client: SupabaseClient,
  id: string,
  coingecko_coin_id: string | null,
): Promise<void> {
  const { error } = await client
    .schema("catalog")
    .from("assets")
    .update({ coingecko_coin_id })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** `update({ coingecko_coin_id, metadata }) .eq("id", id)` — coin-id + metadata writeback. */
export async function updateCoingeckoCoinIdAndMetadataById(
  client: SupabaseClient,
  id: string,
  patch: { coingecko_coin_id: string | null; metadata: Record<string, unknown> | null },
): Promise<void> {
  const { error } = await client.schema("catalog").from("assets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** `update(patch) .eq("id", id)` — generic metrics-sync update (caller composes the patch). */
export async function updateById(
  client: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.schema("catalog").from("assets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** `update({ dollar_value }) .eq("id", id)` — fiat-dollar-value writeback. */
export async function updateDollarValueById(
  client: SupabaseClient,
  id: string,
  dollar_value: number,
): Promise<void> {
  const { error } = await client
    .schema("catalog")
    .from("assets")
    .update({ dollar_value })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** `upsert(rows, { onConflict: "kind,code" })` — bulk upsert keyed by (kind, code). */
export async function upsertManyByKindCode(
  client: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client
    .schema("catalog")
    .from("assets")
    .upsert(rows, { onConflict: "kind,code" });
  if (error) throw new Error(error.message);
}

/**
 * `upsert(row, { onConflict: "kind,code" }) .select("id") .single()` — single upsert returning id.
 * Used by `ensureMarket` to create-or-fetch the base asset.
 */
export async function upsertOneByKindCodeReturningId(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client
    .schema("catalog")
    .from("assets")
    .upsert(row, { onConflict: "kind,code" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error("assets upsert returned no id");
  return id;
}

/** `delete() .eq("id", id) .select("id")` — guarded delete returning rows actually removed. */
export async function deleteByIdReturningIds(
  client: SupabaseClient,
  id: string,
): Promise<{ id: string }[]> {
  const { data, error } = await client.schema("catalog").from("assets").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string }[];
}
