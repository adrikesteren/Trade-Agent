"use server";

import { revalidatePath } from "next/cache";

import { isDashboardAdministrator } from "@/lib/auth/is-dashboard-administrator";
import { getNumericSystemSettingDef } from "@/lib/system-settings/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type SaveNumericSystemSettingResult = { ok: true } | { ok: false; error: string };

function revalidateSystemSettingPaths(key: string): void {
  revalidatePath("/dashboard/system-settings");
  revalidatePath(`/dashboard/system-settings/${key}`);
}

export async function saveNumericSystemSetting(
  formData: FormData,
): Promise<SaveNumericSystemSettingResult> {
  if (!(await isDashboardAdministrator())) {
    return {
      ok: false,
      error: "Administrator role required. Ask an admin to promote your account in Postgres (see docs/ops-developer.md).",
    };
  }

  const key = String(formData.get("key") ?? "").trim();
  const valueRaw = String(formData.get("value") ?? "").trim();
  const def = getNumericSystemSettingDef(key);
  if (!def) {
    return { ok: false, error: "Unknown setting key." };
  }

  if (!valueRaw) {
    return { ok: false, error: `${def.label} cannot be empty.` };
  }

  let n = Number(valueRaw);
  if (!Number.isFinite(n)) {
    return { ok: false, error: "Enter a valid number." };
  }

  if (def.integer) {
    n = Math.floor(n);
  }

  if (n < def.min || n > def.max) {
    return { ok: false, error: `Value must be between ${def.min} and ${def.max}.` };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("system_settings").upsert(
    { key: def.key, value: n, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidateSystemSettingPaths(def.key);
  return { ok: true };
}

export async function deleteAutomationSetting(
  formData: FormData,
): Promise<SaveNumericSystemSettingResult> {
  if (!(await isDashboardAdministrator())) {
    return {
      ok: false,
      error: "Administrator role required. Ask an admin to promote your account in Postgres (see docs/ops-developer.md).",
    };
  }

  const key = String(formData.get("key") ?? "").trim();
  const def = getNumericSystemSettingDef(key);
  if (!def) {
    return { ok: false, error: "Unknown setting key." };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("system_settings").delete().eq("key", key);

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidateSystemSettingPaths(key);
  return { ok: true };
}
