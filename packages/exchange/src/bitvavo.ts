import type { Candle, ExchangeAdapter, ListCandlesParams } from "./types";

/** Bitvavo REST interval names (subset). @see https://docs.bitvavo.com/ */
const TIMEFRAME_MAP: Record<string, string> = {
  "1m": "1m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const BASE = "https://api.bitvavo.com/v2";

function mapInterval(tf: string): string {
  const m = TIMEFRAME_MAP[tf];
  if (!m) throw new Error(`Unsupported timeframe for Bitvavo: ${tf}`);
  return m;
}

/**
 * Read-only public market data. No API keys required for candles endpoint.
 */
export class BitvavoAdapter implements ExchangeAdapter {
  readonly exchangeId = "bitvavo";

  async listCandles(params: ListCandlesParams): Promise<Candle[]> {
    const interval = mapInterval(params.timeframe);
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 1440);
    const market = params.symbol.toUpperCase();
    const u = new URL(`${BASE}/${market}/candles`);
    u.searchParams.set("interval", interval);
    u.searchParams.set("limit", String(limit));
    if (params.endTime) u.searchParams.set("end", params.endTime);

    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bitvavo candles failed: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) throw new Error("Bitvavo candles: expected array");

    const candles: Candle[] = raw.map((row) => {
      if (!Array.isArray(row) || row.length < 6) {
        throw new Error("Bitvavo candles: invalid row");
      }
      const openMs = Number(row[0]);
      const [open, high, low, close, volume] = row.slice(1, 6).map(String);
      const closeMs = openMs + intervalMs(interval);
      return {
        exchange: this.exchangeId,
        symbol: market,
        timeframe: params.timeframe,
        openTime: new Date(openMs).toISOString(),
        closeTime: new Date(closeMs).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      } satisfies Candle;
    });
    /** Bitvavo returns newest-first; normalize to oldest-first for pipelines. */
    return candles.reverse();
  }
}

/** Approximate bar duration for close_time when API only returns open timestamp. */
function intervalMs(interval: string): number {
  const unit = interval.slice(-1);
  const n = Number(interval.slice(0, -1));
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  switch (unit) {
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return 60_000;
  }
}
