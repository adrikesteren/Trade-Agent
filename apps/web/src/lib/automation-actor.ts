import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import * as AutomationActorSelector from "@/lib/selectors/automation-actor-selector";
import * as UserProfilesSelector from "@/lib/selectors/user-profiles-selector";

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
  try {
    const userId = await AutomationActorSelector.selectUserIdByKey(
      admin,
      AUTOMATED_PROCESS_ACTOR_KEY,
    );
    if (userId) return userId;
  } catch {
    // fall through to user_profiles fallback
  }

  return UserProfilesSelector.selectUserIdByUsername(admin, AUTOMATED_PROCESS_USERNAME);
}
