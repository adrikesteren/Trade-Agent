import { BITVAVO_REST_V2_BASE } from "@/lib/bitvavo/constants";

/** Row from Bitvavo `GET /v2/markets`. */
export type BitvavoMarketRow = {
  market: string;
  status: string;
  base: string;
  quote: string;
  minOrderInQuoteAsset?: string;
  minOrderInBaseAsset?: string;
  [key: string]: unknown;
};

/** Public `GET https://api.bitvavo.com/v2/markets` (no auth). */
export async function fetchBitvavoMarkets(): Promise<BitvavoMarketRow[]> {
  const res = await fetch(`${BITVAVO_REST_V2_BASE}/markets`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Bitvavo markets HTTP ${res.status}`);
  }
  return (await res.json()) as BitvavoMarketRow[];
}
