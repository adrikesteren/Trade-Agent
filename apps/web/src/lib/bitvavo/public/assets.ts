import { BITVAVO_REST_V2_BASE } from "@/lib/bitvavo/constants";

/** Row shape from Bitvavo `GET /v2/assets` ([docs](https://docs.bitvavo.com/docs/rest-api/get-asset-data/)). */
export type BitvavoAssetDataRow = {
  symbol: string;
  name: string;
  decimals: number;
  depositFee: string;
  depositConfirmations: number;
  depositStatus: string;
  withdrawalFee: string;
  withdrawalMinAmount: string;
  withdrawalStatus: string;
  networks: string[];
  message: string;
};

/** Public `GET https://api.bitvavo.com/v2/assets` — optional `symbol` query (e.g. `BTC`). */
export async function fetchBitvavoAssetData(opts?: { symbol?: string | null }): Promise<BitvavoAssetDataRow[]> {
  const url = new URL(`${BITVAVO_REST_V2_BASE}/assets`);
  const sym = opts?.symbol?.trim();
  if (sym) {
    url.searchParams.set("symbol", sym);
  }
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Bitvavo assets HTTP ${res.status}`);
  }
  return (await res.json()) as BitvavoAssetDataRow[];
}
