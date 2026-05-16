import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ExchangeRow = {
  id: string;
  code: string;
  name: string | null;
};

export type ExchangeWithCreatedAtRow = ExchangeRow & {
  created_at: string;
};

export type ExchangeCapabilitiesRow = {
  supports_spot_buy: boolean;
  supports_spot_sell: boolean;
  supports_margin_long: boolean;
  supports_margin_short: boolean;
};

export type ExchangeWithCapabilitiesRow = { id: string } & ExchangeCapabilitiesRow;

/** `select("id, code, name") .eq("id", id) .maybeSingle()` */
export async function selectById(client: SupabaseClient, id: string): Promise<ExchangeRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExchangeRow | null) ?? null;
}

/** `select("id, code, name, created_at") .eq("id", id) .maybeSingle()` — used by the exchange detail page. */
export async function selectFullById(
  client: SupabaseClient,
  id: string,
): Promise<ExchangeWithCreatedAtRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExchangeWithCreatedAtRow | null) ?? null;
}

/** `select("code") .eq("id", id) .maybeSingle()` — narrow lookup when only the code is needed. */
export async function selectCodeById(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("code")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const code = (data as { code: string | null } | null)?.code;
  return code ?? null;
}

/**
 * `select("id") .eq("code", code) .single()` — narrow lookup that throws when the row is absent
 * (callers like Bitvavo-only flows expect the exchange to exist).
 */
export async function selectIdByCode(client: SupabaseClient, code: string): Promise<string> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id")
    .eq("code", code)
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error(`${code} exchange not found`);
  return id;
}

/** `select("id, code, name") .eq("code", code) .maybeSingle()` — null-tolerant variant. */
export async function selectByCode(client: SupabaseClient, code: string): Promise<ExchangeRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExchangeRow | null) ?? null;
}

/** `select("id, name, code") .in("id", ids)` — bulk lookup for reconcile / executor rendering. */
export async function selectByIds(client: SupabaseClient, ids: string[]): Promise<ExchangeRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, name, code")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExchangeRow[];
}

/** `select("id, code, name") .order("code")` — listing (full set, ordered). */
export async function selectAllOrderedByCode(client: SupabaseClient): Promise<ExchangeRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as ExchangeRow[];
}

/** `select("id, code, name") .order("code", { ascending: true }) .range(from, to)` — paginated list. */
export async function selectAllPaginatedOrderedByCode(
  client: SupabaseClient,
  range: { from: number; to: number },
): Promise<ExchangeRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code, name")
    .order("code", { ascending: true })
    .range(range.from, range.to);
  if (error) throw new Error(error.message);
  return (data ?? []) as ExchangeRow[];
}

/** `select("id, code") .ilike("code", pattern)` — case-insensitive code matcher. */
export async function selectByCodeIlike(
  client: SupabaseClient,
  pattern: string,
): Promise<{ id: string; code: string }[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, code")
    .ilike("code", pattern);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; code: string }[];
}

/** `select("supports_*") .eq("id", id) .maybeSingle()` — capabilities-only narrow lookup. */
export async function selectCapabilitiesById(
  client: SupabaseClient,
  id: string,
): Promise<ExchangeCapabilitiesRow | null> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("supports_spot_buy, supports_spot_sell, supports_margin_long, supports_margin_short")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExchangeCapabilitiesRow | null) ?? null;
}

/** `select("id, supports_*")` — all rows with capabilities (executor form options). */
export async function selectAllCapabilities(
  client: SupabaseClient,
): Promise<ExchangeWithCapabilitiesRow[]> {
  const { data, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("id, supports_spot_buy, supports_spot_sell, supports_margin_long, supports_margin_short");
  if (error) throw new Error(error.message);
  return (data ?? []) as ExchangeWithCapabilitiesRow[];
}

/** `select("*", { count: "exact", head: true })` — total row count for pagination. */
export async function countAll(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .schema("catalog")
    .from("exchanges")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
