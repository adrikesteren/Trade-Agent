import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AutomationActorUserIdRow = {
  user_id: string | null;
};

/** `select("user_id") .eq("key", key) .maybeSingle()` — resolves the auth.users.id for an actor key. */
export async function selectUserIdByKey(
  client: SupabaseClient,
  key: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("automation_actor")
    .select("user_id")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const userId = (data as AutomationActorUserIdRow | null)?.user_id;
  return userId ?? null;
}
