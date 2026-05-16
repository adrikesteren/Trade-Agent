import "server-only";

import * as SystemSettingsSelector from "@/lib/selectors/system-settings-selector";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/** `public.system_settings.key` for inline / Relay worker `Authorization: Bearer …`. */
export const WORKER_CRON_SECRET_SETTINGS_KEY = "cron_secret" as const;

function parseCronSecretFromJsonb(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const s = o.secret ?? o.value;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

/**
 * Worker auth secret: **`public.system_settings`** row `cron_secret` first (JSON string or `{"secret":"…"}`),
 * then `CRON_SECRET` env. Operators can store the secret in Postgres and omit it from `.env`.
 */
export async function resolveWorkerCronSecret(): Promise<string | null> {
  try {
    const admin = createServiceRoleClient();
    const row = await SystemSettingsSelector.selectValueByKey(admin, WORKER_CRON_SECRET_SETTINGS_KEY);

    if (row?.value != null) {
      const parsed = parseCronSecretFromJsonb(row.value);
      if (parsed) return parsed;
    }
  } catch (e) {
    console.warn("[resolveWorkerCronSecret] read public.system_settings failed:", e);
  }

  const fromEnv = process.env.CRON_SECRET?.trim();
  return fromEnv || null;
}
