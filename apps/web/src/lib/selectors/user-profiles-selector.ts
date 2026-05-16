import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Dashboard role (mirror of `public.app_user_role`). */
export type UserProfileRole = "user" | "administrator" | string;

/** `select("user_id") .eq("username", username) .maybeSingle()` — username → auth user id lookup. */
export async function selectUserIdByUsername(
  client: SupabaseClient,
  username: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("user_profiles")
    .select("user_id")
    .eq("username", username)
    .maybeSingle();
  if (error) return null;
  const userId = (data as { user_id: string | null } | null)?.user_id;
  return userId ? String(userId) : null;
}

/** `select("role") .eq("user_id", userId) .maybeSingle()` — role lookup for dashboard gating. */
export async function selectRoleByUserId(
  client: SupabaseClient,
  userId: string,
): Promise<UserProfileRole | null> {
  const { data, error } = await client
    .from("user_profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: UserProfileRole | null }).role ?? null;
}

/** `update({ role }) .eq("user_id", userId)` — admin-tooling role flip. */
export async function updateRoleByUserId(
  client: SupabaseClient,
  args: { userId: string; role: UserProfileRole },
): Promise<void> {
  const { error } = await client
    .from("user_profiles")
    .update({ role: args.role })
    .eq("user_id", args.userId);
  if (error) throw new Error(error.message);
}
