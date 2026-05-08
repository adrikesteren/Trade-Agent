import type { CandleRowJson, ChartTimeframe } from "@/lib/markets/chart-types";
import { CATALOG_STORAGE_TIMEFRAME } from "@/lib/markets/chart-types";

const MINUTES: Record<ChartTimeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

const SOURCE = CATALOG_STORAGE_TIMEFRAME as ChartTimeframe;

/**
 * Roll up catalog timeframe bars into a larger chart interval. Buckets are epoch-aligned
 * (e.g. 15m: unix ms floored to multiples of 900_000), matching typical exchange grouping.
 */
export function aggregateOhlcvToTarget(rows: CandleRowJson[], target: ChartTimeframe): CandleRowJson[] {
  if (target === SOURCE) {
    return [...rows].sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
  }

  if (MINUTES[target] < MINUTES[SOURCE]) {
    throw new Error(`Cannot build ${target} candles from ${SOURCE} storage`);
  }

  const periodMs = MINUTES[target] * 60_000;
  const sorted = [...rows].sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
  if (!sorted.length) return [];

  const buckets = new Map<number, CandleRowJson[]>();
  for (const row of sorted) {
    const t = new Date(row.openTime).getTime();
    const bucketStart = Math.floor(t / periodMs) * periodMs;
    const list = buckets.get(bucketStart);
    if (list) list.push(row);
    else buckets.set(bucketStart, [row]);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out: CandleRowJson[] = [];

  for (const startMs of keys) {
    const part = buckets.get(startMs)!;
    const open = part[0]!.open;
    let high = part[0]!.high;
    let low = part[0]!.low;
    let vol = 0;
    for (const p of part) {
      high = Math.max(high, p.high);
      low = Math.min(low, p.low);
      vol += p.volume;
    }
    const close = part[part.length - 1]!.close;
    const openTime = new Date(startMs).toISOString();
    const closeTime = new Date(startMs + periodMs).toISOString();
    out.push({ openTime, closeTime, open, high, low, close, volume: vol });
  }

  return out;
}
