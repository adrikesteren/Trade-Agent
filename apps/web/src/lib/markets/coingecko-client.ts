import "server-only";

const BASE = "https://api.coingecko.com/api/v3";

export type CoinGeckoMarketRow = {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number | null;
  high_24h: number | null;
  low_24h: number | null;
  price_change_24h: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  last_updated?: string | null;
};

function cgHeaders(): Headers {
  const h = new Headers({ Accept: "application/json" });
  const k = process.env.COINGECKO_API_KEY?.trim();
  if (k) h.set("x-cg-demo-api-key", k);
  return h;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve CoinGecko coin `id` (e.g. `bitcoin`) from our asset ticker (e.g. `BTC`).
 * Uses /search and picks the best-ranked coin whose symbol matches (case-insensitive).
 */
export async function coingeckoSearchCoinId(ticker: string): Promise<string | null> {
  const q = ticker.trim();
  if (!q) return null;
  const url = `${BASE}/search?query=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: cgHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`CoinGecko search HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    coins?: { id: string; name: string; symbol: string; market_cap_rank?: number | null }[];
  };
  const coins = body.coins ?? [];
  const want = q.toUpperCase();
  const matches = coins.filter((c) => (c.symbol ?? "").toUpperCase() === want);
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ra = a.market_cap_rank ?? 999_999;
    const rb = b.market_cap_rank ?? 999_999;
    return ra - rb;
  });
  return matches[0]!.id;
}

const MAX_IDS_PER_MARKETS_CALL = 200;

/**
 * `/coins/markets` for a set of CoinGecko ids (chunked). vs_currency=usd.
 */
export async function coingeckoFetchMarketsByIds(ids: string[]): Promise<CoinGeckoMarketRow[]> {
  const uniq = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  const out: CoinGeckoMarketRow[] = [];
  for (let i = 0; i < uniq.length; i += MAX_IDS_PER_MARKETS_CALL) {
    const chunk = uniq.slice(i, i + MAX_IDS_PER_MARKETS_CALL);
    const u = new URL(`${BASE}/coins/markets`);
    u.searchParams.set("vs_currency", "usd");
    u.searchParams.set("ids", chunk.join(","));
    u.searchParams.set("per_page", String(chunk.length));
    u.searchParams.set("page", "1");
    u.searchParams.set("sparkline", "false");
    u.searchParams.set("price_change_percentage", "24h,7d");
    const res = await fetch(u.toString(), { headers: cgHeaders(), cache: "no-store" });
    if (!res.ok) {
      throw new Error(`CoinGecko markets HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const rows = (await res.json()) as CoinGeckoMarketRow[];
    out.push(...rows);
    if (i + MAX_IDS_PER_MARKETS_CALL < uniq.length) {
      await sleep(1100);
    }
  }
  return out;
}

export { sleep };
