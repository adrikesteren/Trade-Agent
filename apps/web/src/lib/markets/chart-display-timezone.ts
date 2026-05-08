/**
 * IANA timezone for chart axis + crosshair + hover labels.
 * Bar `time` values stay UTC Unix seconds (same instant as Supabase `timestamptz`); only display is shifted.
 *
 * @see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
 */
export function getChartDisplayTimeZone(): string {
  const z = process.env.NEXT_PUBLIC_CHART_DISPLAY_TIMEZONE?.trim();
  if (z) return z;
  return "Europe/Amsterdam";
}
