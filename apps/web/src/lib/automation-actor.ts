import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** `public.automation_actor.key` for the catalog pipeline system user. */
export const AUTOMATED_PROCESS_ACTOR_KEY = "automated_process" as const;

/** `public.user_profiles.username` for the same user (stable handle). */
export const AUTOMATED_PROCESS_USERNAME = "automated_process" as const;

/**
 * Resolves the `auth.users.id` for the Automated Process actor:
 * `public.automation_actor` first, then `public.user_profiles` where `username` is
 * {@link AUTOMATED_PROCESS_USERNAME}.
 */
export async function getAutomatedProcessUserId(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("automation_actor")
    .select("user_id")
    .eq("key", AUTOMATED_PROCESS_ACTOR_KEY)
    .maybeSingle();
  if (!error && data?.user_id) {
    return String(data.user_id);
  }

  const { data: prof, error: pErr } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("username", AUTOMATED_PROCESS_USERNAME)
    .maybeSingle();
  if (pErr || !prof?.user_id) return null;
  return String(prof.user_id);
}
