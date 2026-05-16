import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Locale + primary-asset projection used by the per-request locale loader. */
export type UserPreferencesLocaleRow = {
  user_id: string;
  timezone: string;
  decimal_format: string;
  date_format: string;
  time_format: string;
  primary_asset_id: string;
};

/** Narrow projection used by the executor quote-budget mediator (owner → primary asset). */
export type UserPreferencesPrimaryAssetRow = {
  primary_asset_id: string | null;
};

/** Patch shape accepted by the `/me/preferences` update action. */
export type UserPreferencesLocalePatch = {
  timezone: string;
  decimal_format: string;
  date_format: string;
  time_format: string;
  primary_asset_id: string;
  updated_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Selects
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `select("user_id, timezone, decimal_format, date_format, time_format, primary_asset_id")
 *  .eq("user_id", userId) .maybeSingle()` — cached per-request locale lookup
 * powering `getUserLocalePreferences`.
 */
export async function selectLocaleByUserId(
  client: SupabaseClient,
  userId: string,
): Promise<UserPreferencesLocaleRow | null> {
  const { data, error } = await client
    .from("user_preferences")
    .select("user_id, timezone, decimal_format, date_format, time_format, primary_asset_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UserPreferencesLocaleRow | null) ?? null;
}

/**
 * `select("primary_asset_id") .eq("user_id", userId) .maybeSingle()` — mediator
 * lookup used to triangulate executor quote-budgets through the owner's primary
 * fiat asset.
 */
export async function selectPrimaryAssetIdByUserId(
  client: SupabaseClient,
  userId: string,
): Promise<UserPreferencesPrimaryAssetRow | null> {
  const { data, error } = await client
    .from("user_preferences")
    .select("primary_asset_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UserPreferencesPrimaryAssetRow | null) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * `upsert(row, { onConflict: "user_id" }) .eq("user_id", userId)` — owner-scoped
 * locale write. Uses upsert against the `UNIQUE(user_id)` constraint so the
 * `/me/preferences` form works even when the bootstrap row is missing.
 */
export async function upsertLocaleByUserId(
  client: SupabaseClient,
  args: { userId: string; patch: UserPreferencesLocalePatch },
): Promise<void> {
  const { error } = await client
    .from("user_preferences")
    .upsert({ user_id: args.userId, ...args.patch }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
