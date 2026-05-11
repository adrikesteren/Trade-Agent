import "server-only";

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

  const { data, error } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return false;
  return data.role === "administrator";
}
