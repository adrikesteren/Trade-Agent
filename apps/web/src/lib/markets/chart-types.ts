/** Interval Bitvavo catalog sync writes to `candles`; chart API + Realtime filter must stay in sync. */
export const CATALOG_STORAGE_TIMEFRAME = "15m" as const;

/** Rows safe to pass from server → client (JSON-serializable). */
export type CandleRowJson = {
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const CHART_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

export function isChartTimeframe(s: string): s is ChartTimeframe {
  return (CHART_TIMEFRAMES as readonly string[]).includes(s);
}
