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

export type CoinGeckoSearchCoin = {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank?: number | null;
};

/**
 * Pure pick logic for `/search` results: symbol filter, then optional **name** disambiguation
 * when multiple coins share the ticker symbol.
 */
export function resolveCoinGeckoIdFromSearchCoins(
  coins: CoinGeckoSearchCoin[],
  code: string,
  assetName: string | null | undefined,
): string | null {
  const want = code.trim().toUpperCase();
  if (!want) return null;
  const matches = coins.filter((c) => (c.symbol ?? "").toUpperCase() === want);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0]!.id;

  const nameTrim = (assetName ?? "").trim().toLowerCase();
  if (!nameTrim) return null;

  const nameMatches = matches.filter((c) => (c.name ?? "").trim().toLowerCase() === nameTrim);
  if (nameMatches.length === 1) return nameMatches[0]!.id;
  return null;
}

async function coingeckoFetchSearchCoins(query: string): Promise<CoinGeckoSearchCoin[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/search?query=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: cgHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`CoinGecko search HTTP ${res.status}`);
  }
  const body = (await res.json()) as { coins?: CoinGeckoSearchCoin[] };
  return body.coins ?? [];
}

/**
 * Resolve CoinGecko coin `id` (e.g. `bitcoin`) from asset `code` (e.g. `BTC`) and optional catalog `name`.
 * Uses `/search`; multiple symbol matches require a unique **case-insensitive name** hit.
 */
export async function coingeckoResolveCoinIdForAsset(
  code: string,
  assetName: string | null | undefined,
): Promise<{ coinId: string | null; coins: CoinGeckoSearchCoin[] }> {
  const coins = await coingeckoFetchSearchCoins(code);
  return { coinId: resolveCoinGeckoIdFromSearchCoins(coins, code, assetName), coins };
}

/**
 * @deprecated Prefer {@link coingeckoResolveCoinIdForAsset} with catalog `name` for ambiguous tickers.
 */
export async function coingeckoSearchCoinId(ticker: string): Promise<string | null> {
  const { coinId } = await coingeckoResolveCoinIdForAsset(ticker, null);
  return coinId;
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
