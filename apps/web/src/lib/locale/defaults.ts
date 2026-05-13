import type { UserLocalePreferences } from "./types";

/** Defaults when no row exists (matches migration column defaults — Amsterdam-style). */
export const DEFAULT_USER_LOCALE_PREFERENCES: UserLocalePreferences = {
  timezone: "europe_amsterdam",
  decimal_format: "comma_decimal",
  date_format: "dmy",
  time_format: "h24",
  primary_asset: null,
};
