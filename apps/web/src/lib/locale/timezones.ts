import type { UserTimezone } from "./types";

const TZ_MAP: Record<UserTimezone, string> = {
  europe_amsterdam: "Europe/Amsterdam",
  utc: "UTC",
  europe_london: "Europe/London",
  europe_berlin: "Europe/Berlin",
  america_new_york: "America/New_York",
  america_los_angeles: "America/Los_Angeles",
  asia_tokyo: "Asia/Tokyo",
  australia_sydney: "Australia/Sydney",
};

export function userTimezoneToIana(tz: UserTimezone): string {
  return TZ_MAP[tz] ?? TZ_MAP.europe_amsterdam;
}

/**
 * Chart / crosshair display: explicit env wins (local dev override), else user preference IANA zone.
 */
export function resolveChartDisplayIana(userIana: string): string {
  const env = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE?.trim() : "";
  if (env) return env;
  return userIana;
}
