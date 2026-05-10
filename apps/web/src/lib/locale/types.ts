/** Mirrors `public.user_timezone` (curated; map to IANA in `timezones.ts`). */
export type UserTimezone =
  | "europe_amsterdam"
  | "utc"
  | "europe_london"
  | "europe_berlin"
  | "america_new_york"
  | "america_los_angeles"
  | "asia_tokyo"
  | "australia_sydney";

/** Mirrors `public.user_decimal_format`. */
export type UserDecimalFormat = "comma_decimal" | "period_decimal" | "apostrophe_decimal";

/** Mirrors `public.user_date_format`. */
export type UserDateFormat = "dmy" | "mdy" | "ymd";

/** Mirrors `public.user_time_format`. */
export type UserTimeFormat = "h24" | "h12";

export type UserLocalePreferences = {
  timezone: UserTimezone;
  decimal_format: UserDecimalFormat;
  date_format: UserDateFormat;
  time_format: UserTimeFormat;
};
