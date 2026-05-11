import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getNumericSystemSettingDef,
  type SystemSettingNumericKey,
} from "@/lib/system-settings/registry";

function parseStoredNumeric(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object" && "n" in raw) {
    const n = Number((raw as { n: unknown }).n);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clampToDef(n: number, def: ReturnType<typeof getNumericSystemSettingDef>): number {
  if (!def) return n;
  let v = Math.min(Math.max(n, def.min), def.max);
  if (def.integer) {
    v = Math.floor(v);
    if (!Number.isFinite(v) || v < def.min) v = def.min;
    if (v > def.max) v = def.max;
  }
  return v;
}

function fromEnv(def: NonNullable<ReturnType<typeof getNumericSystemSettingDef>>): number | null {
  const raw = process.env[def.envFallbackVar]?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampToDef(n, def);
}

/**
 * Resolution order: `public.system_settings` row → `process.env[envFallbackVar]` → registry default.
 * Always clamps to the registry min/max (and optional integer floor).
 */
export async function getNumericSystemSetting(
  admin: SupabaseClient,
  key: SystemSettingNumericKey,
): Promise<number> {
  const def = getNumericSystemSettingDef(key);
  if (!def) {
    throw new Error(`Unknown system setting key: ${key}`);
  }

  const { data, error } = await admin.from("system_settings").select("value").eq("key", key).maybeSingle();

  if (error) {
    console.warn("[public.system_settings] read failed", key, error.message);
  } else {
    const parsed = parseStoredNumeric(data?.value);
    if (parsed != null) {
      return clampToDef(parsed, def);
    }
  }

  const envN = fromEnv(def);
  if (envN != null) return clampToDef(envN, def);

  return def.defaultValue;
}
