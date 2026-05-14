/**
 * Convert stored candle `open_time` / `close_time` strings to Unix **seconds** (UTC),
 * matching how `lightweight-charts` expects {@link UTCTimestamp}.
 *
 * Supabase/Postgres may return `2024-05-08 20:25:00+00` (space, not `T`). Without a
 * timezone suffix, `Date` parsing is implementation-defined and often treated as **local**
 * wall time — which skews the chart vs the SQL editor (`timestamptz` shown in UTC).
 */
export function candleTimeToUnixSeconds(iso: string): number {
  const s = String(iso).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return n >= 1_000_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  let candidate = s.includes("T") ? s : s.replace(" ", "T");
  const hasExplicitTz =
    /[zZ]$/.test(candidate) ||
    /[+-]\d{2}:?\d{2}$/.test(candidate) ||
    /[+-]\d{2}$/.test(candidate);
  if (!hasExplicitTz) {
    candidate = candidate.endsWith("Z") || candidate.endsWith("z") ? candidate : `${candidate}Z`;
  }

  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) {
    return Number.NaN;
  }
  return Math.floor(ms / 1000);
}
