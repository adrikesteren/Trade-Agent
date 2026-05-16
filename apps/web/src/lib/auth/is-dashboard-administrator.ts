import "server-only";

import * as UserProfilesSelector from "@/lib/selectors/user-profiles-selector";
import { createClient } from "@/lib/supabase/server";

/**
 * True when the signed-in user has `public.user_profiles.role = 'administrator'`.
 * Used for dashboard-only operations (e.g. editing `public.system_settings`).
 */
export async function isDashboardAdministrator(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const role = await UserProfilesSelector.selectRoleByUserId(supabase, user.id);
  return role === "administrator";
}
