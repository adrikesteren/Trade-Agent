/** Columns on `catalog.assets` filled by CoinGecko sync (subset used by UI). */
export type AssetLiveCoingeckoDb = {
  coingecko_fetched_at: string | null;
  coingecko_coin_id: string | null;
  coingecko_price_usd: number | string | null;
  coingecko_market_cap_usd: number | string | null;
  coingecko_fdv_usd: number | string | null;
  coingecko_total_volume_usd: number | string | null;
  coingecko_high_24h_usd: number | string | null;
  coingecko_low_24h_usd: number | string | null;
  coingecko_price_change_24h_usd: number | string | null;
  coingecko_price_change_24h_pct: number | string | null;
  coingecko_price_change_7d_pct: number | string | null;
  coingecko_market_cap_rank: number | null;
  coingecko_circulating_supply: number | string | null;
  coingecko_total_supply: number | string | null;
  coingecko_max_supply: number | string | null;
  coingecko_ath_usd: number | string | null;
  coingecko_ath_change_pct: number | string | null;
};

/** Live CoinGecko fields stored on `catalog.assets` (updated each sync). */
export type AssetCoingeckoMetricsRow = {
  fetched_at: string;
  coingecko_id: string;
  price_usd: number | string | null;
  market_cap_usd: number | string | null;
  fully_diluted_valuation_usd: number | string | null;
  total_volume_usd: number | string | null;
  high_24h_usd: number | string | null;
  low_24h_usd: number | string | null;
  price_change_24h_usd: number | string | null;
  price_change_24h_pct: number | string | null;
  price_change_7d_pct: number | string | null;
  market_cap_rank: number | null;
  circulating_supply: number | string | null;
  total_supply: number | string | null;
  max_supply: number | string | null;
  ath_usd: number | string | null;
  ath_change_pct: number | string | null;
};

/**
 * Builds a metrics row when `coingecko_fetched_at` is set (post-sync snapshot).
 * Otherwise returns `null` (UI shows empty placeholders).
 */
export function buildAssetCoingeckoMetricsRow(
  asset: AssetLiveCoingeckoDb,
  metadataCoingeckoId: string | null,
): AssetCoingeckoMetricsRow | null {
  if (!asset.coingecko_fetched_at) return null;
  const cgId = asset.coingecko_coin_id?.trim() || metadataCoingeckoId?.trim() || "—";
  return {
    fetched_at: asset.coingecko_fetched_at,
    coingecko_id: cgId,
    price_usd: asset.coingecko_price_usd,
    market_cap_usd: asset.coingecko_market_cap_usd,
    fully_diluted_valuation_usd: asset.coingecko_fdv_usd,
    total_volume_usd: asset.coingecko_total_volume_usd,
    high_24h_usd: asset.coingecko_high_24h_usd,
    low_24h_usd: asset.coingecko_low_24h_usd,
    price_change_24h_usd: asset.coingecko_price_change_24h_usd,
    price_change_24h_pct: asset.coingecko_price_change_24h_pct,
    price_change_7d_pct: asset.coingecko_price_change_7d_pct,
    market_cap_rank: asset.coingecko_market_cap_rank,
    circulating_supply: asset.coingecko_circulating_supply,
    total_supply: asset.coingecko_total_supply,
    max_supply: asset.coingecko_max_supply,
    ath_usd: asset.coingecko_ath_usd,
    ath_change_pct: asset.coingecko_ath_change_pct,
  };
}
