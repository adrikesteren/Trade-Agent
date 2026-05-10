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

function rowToPrefs(row: UserPreferencesRow): UserLocalePreferences {
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
    .select("user_id, timezone, decimal_format, date_format, time_format")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_USER_LOCALE_PREFERENCES;
  return rowToPrefs(data as UserPreferencesRow);
});
