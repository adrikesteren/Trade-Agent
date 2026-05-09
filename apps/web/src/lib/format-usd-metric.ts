/** Compact USD for tables (CoinGecko-style amounts). */
export function formatUsdMetric(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(n) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2,
  }).format(n);
}

export function numericOrNegInf(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}
