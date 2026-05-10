import { DEFAULT_USER_LOCALE_PREFERENCES } from "@/lib/locale/defaults";
import { formatUsdAmount } from "@/lib/locale/format";
import type { UserLocalePreferences } from "@/lib/locale/types";

/** Compact USD for tables (CoinGecko-style amounts); grouping follows user `decimal_format` when `prefs` is passed. */
export function formatUsdMetric(
  value: number | string | null | undefined,
  prefs: UserLocalePreferences = DEFAULT_USER_LOCALE_PREFERENCES,
): string {
  return formatUsdAmount(value, prefs, { compactAbove: 1_000_000 });
}

export function numericOrNegInf(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}
