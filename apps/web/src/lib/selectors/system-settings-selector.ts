import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type SystemSettingValueRow = {
  value: unknown;
};

export type SystemSettingRow = {
  key: string;
  value: unknown;
  updated_at: string | null;
};

/** `select("value") .eq("key", key) .maybeSingle()` — narrow lookup used by setting readers. */
export async function selectValueByKey(
  client: SupabaseClient,
  key: string,
): Promise<SystemSettingValueRow | null> {
  const { data, error } = await client
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SystemSettingValueRow | null) ?? null;
}

/** `select("key, value, updated_at") .eq("key", key) .maybeSingle()` — detail page row. */
export async function selectByKey(
  client: SupabaseClient,
  key: string,
): Promise<SystemSettingRow | null> {
  const { data, error } = await client
    .from("system_settings")
    .select("key, value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SystemSettingRow | null) ?? null;
}

/** `select("key, value, updated_at") .in("key", keys)` — bulk lookup for the list view. */
export async function selectByKeys(
  client: SupabaseClient,
  keys: string[],
): Promise<SystemSettingRow[]> {
  if (keys.length === 0) return [];
  const { data, error } = await client
    .from("system_settings")
    .select("key, value, updated_at")
    .in("key", keys);
  if (error) throw new Error(error.message);
  return (data ?? []) as SystemSettingRow[];
}

/**
 * `upsert({ key, value, updated_at }, { onConflict: "key" })` — write tunable value.
 * `updated_at` defaults to "now" when not provided.
 */
export async function upsertByKey(
  client: SupabaseClient,
  row: { key: string; value: unknown; updated_at?: string },
): Promise<void> {
  const { error } = await client.from("system_settings").upsert(
    { key: row.key, value: row.value, updated_at: row.updated_at ?? new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

/** `.delete() .eq("key", key)` — remove a tunable row (reverts to env / default). */
export async function deleteByKey(client: SupabaseClient, key: string): Promise<void> {
  const { error } = await client.from("system_settings").delete().eq("key", key);
  if (error) throw new Error(error.message);
}
