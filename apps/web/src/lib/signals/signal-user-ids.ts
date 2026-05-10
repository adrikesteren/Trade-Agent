import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

/**
 * Trusted user UUIDs for service-role signal writes (env only — never from unsigned clients).
 *
 * **Precedence:** `SIGNAL_DEFAULT_USER_ID` when set (typical single-user / personal setup).
 * `SIGNAL_USER_IDS` is only used when the default is unset (comma-separated; legacy multi-user).
 *
 * Non-UUID tokens are ignored (warned per entry).
 */
export function parseSignalUserIdsFromEnv(): string[] {
  const single = process.env.SIGNAL_DEFAULT_USER_ID?.trim();
  const multi = process.env.SIGNAL_USER_IDS?.trim();

  const raw =
    single != null && single.length > 0
      ? [single]
      : multi != null && multi.length > 0
        ? multi.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

  if (raw.length === 0) return [];

  const valid = raw.filter((id) => isUuid(id));
  const invalid = raw.filter((id) => !isUuid(id));
  for (const id of invalid) {
    console.warn(`[signal-user-ids] ignoring non-UUID env user id entry: ${JSON.stringify(id)}`);
  }
  if (raw.length > 0 && valid.length === 0) {
    console.error(
      "[signal-user-ids] SIGNAL_DEFAULT_USER_ID / SIGNAL_USER_IDS contained no valid UUIDs; signal workers will skip until env is fixed.",
    );
  }
  return valid;
}

/**
 * Drops env-configured ids that are not real `auth.users` rows in **this** Supabase project
 * (e.g. production UUIDs in local `.env` → `signals_user_id_fkey` failures).
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
