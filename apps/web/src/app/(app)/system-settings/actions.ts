"use server";

import { revalidatePath } from "next/cache";

import { isDashboardAdministrator } from "@/lib/auth/is-dashboard-administrator";
import * as SystemSettingsSelector from "@/lib/selectors/system-settings-selector";
import { getNumericSystemSettingDef } from "@/lib/system-settings/registry";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type SaveNumericSystemSettingResult = { ok: true } | { ok: false; error: string };

function revalidateSystemSettingPaths(key: string): void {
  revalidatePath("/system-settings");
  revalidatePath(`/system-settings/${key}`);
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
  try {
    await SystemSettingsSelector.upsertByKey(admin, { key: def.key, value: n });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
  try {
    await SystemSettingsSelector.deleteByKey(admin, key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidateSystemSettingPaths(key);
  return { ok: true };
}
