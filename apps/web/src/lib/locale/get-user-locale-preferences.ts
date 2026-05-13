import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_USER_LOCALE_PREFERENCES } from "./defaults";
import type { UserDecimalFormat, UserDateFormat, UserLocalePreferences, UserTimeFormat, UserTimezone } from "./types";

type UserPreferencesRow = {
  user_id: string;
  timezone: string;
  decimal_format: string;
  date_format: string;
  time_format: string;
  primary_asset_id: string;
};

function isUserTimezone(v: string): v is UserTimezone {
  return (
    v === "europe_amsterdam" ||
    v === "utc" ||
    v === "europe_london" ||
    v === "europe_berlin" ||
    v === "america_new_york" ||
    v === "america_los_angeles" ||
    v === "asia_tokyo" ||
    v === "australia_sydney"
  );
}

function isUserDecimalFormat(v: string): v is UserDecimalFormat {
  return v === "comma_decimal" || v === "period_decimal" || v === "apostrophe_decimal";
}

function isUserDateFormat(v: string): v is UserDateFormat {
  return v === "dmy" || v === "mdy" || v === "ymd";
}

function isUserTimeFormat(v: string): v is UserTimeFormat {
  return v === "h24" || v === "h12";
}

function rowToPrefs(row: UserPreferencesRow): Omit<UserLocalePreferences, "primary_asset"> {
  return {
    timezone: isUserTimezone(row.timezone) ? row.timezone : DEFAULT_USER_LOCALE_PREFERENCES.timezone,
    decimal_format: isUserDecimalFormat(row.decimal_format)
      ? row.decimal_format
      : DEFAULT_USER_LOCALE_PREFERENCES.decimal_format,
    date_format: isUserDateFormat(row.date_format) ? row.date_format : DEFAULT_USER_LOCALE_PREFERENCES.date_format,
    time_format: isUserTimeFormat(row.time_format) ? row.time_format : DEFAULT_USER_LOCALE_PREFERENCES.time_format,
  };
}

/**
 * Cached per request: load `public.user_preferences` for the signed-in user.
 * Falls back to Amsterdam-style defaults when unauthenticated or row missing.
 */
export const getUserLocalePreferences = cache(async (): Promise<UserLocalePreferences> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT_USER_LOCALE_PREFERENCES;

  const { data, error } = await supabase
    .from("user_preferences")
    .select("user_id, timezone, decimal_format, date_format, time_format, primary_asset_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_USER_LOCALE_PREFERENCES;

  const row = data as UserPreferencesRow;
  const base = rowToPrefs(row);

  const pid = String(row.primary_asset_id ?? "").trim();
  if (!pid) {
    return { ...base, primary_asset: null };
  }

  const { data: pa, error: paErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, kind, dollar_value")
    .eq("id", pid)
    .maybeSingle();

  if (paErr || !pa || String(pa.kind) !== "fiat") {
    return { ...base, primary_asset: null };
  }

  const dvRaw = pa.dollar_value;
  const dollar_value =
    dvRaw != null && String(dvRaw).trim() !== ""
      ? (() => {
          const n = typeof dvRaw === "number" ? dvRaw : Number.parseFloat(String(dvRaw));
          return Number.isFinite(n) && n > 0 ? n : null;
        })()
      : null;

  return {
    ...base,
    primary_asset: {
      id: pa.id as string,
      code: String(pa.code ?? "").trim() || pid.slice(0, 8),
      dollar_value,
    },
  };
});
