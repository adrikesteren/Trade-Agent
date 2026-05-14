import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutomatedProcessUserId } from "@/lib/automation-actor";

/**
 * User ids for catalog-close signal/mediator/executor pipelines: **only** the Automated Process user
 * ({@link getAutomatedProcessUserId}: `automation_actor` then `user_profiles.username = automated_process`),
 * validated against `auth.users`. Overrides use {@link RunSignalsCatalogCloseBody.signalUserIdsOverride}.
 */
export async function getCatalogPipelineUserIds(admin: SupabaseClient): Promise<string[]> {
  const automated = await getAutomatedProcessUserId(admin);
  if (!automated) return [];
  return filterSignalUserIdsToExistingAuthUsers(admin, [automated]);
}

/**
 * Drops ids that are not real `auth.users` rows in **this** Supabase project.
 */
export async function filterSignalUserIdsToExistingAuthUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<string[]> {
  const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const checks = await Promise.all(
    unique.map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data?.user) {
        console.warn(
          `[signal-user-ids] skipping user id not present in auth.users: ${id}${error?.message ? ` (${error.message})` : ""}`,
        );
        return null;
      }
      return id;
    }),
  );

  return checks.filter((x): x is string => x != null);
}
