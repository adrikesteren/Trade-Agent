import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { coingeckoFetchMarketsByIds, type CoinGeckoMarketRow } from "@/lib/agents/ingest/services/coingecko-client.service";
import { syncFiatAssetDollarValues } from "@/lib/agents/ingest/services/fiat-dollar-values-sync.service";
import * as AssetsSelector from "@/lib/selectors/assets-selector";

function parsePositiveInt(envVal: string | undefined, fallback: number): number {
  if (envVal === undefined || envVal === "") return fallback;
  const n = Number.parseInt(envVal, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** Parallel Supabase `assets` updates after /coins/markets (default 25). */
const MARKETS_DB_CONCURRENCY = parsePositiveInt(process.env.COINGECKO_MARKETS_DB_CONCURRENCY, 25);

type AssetRow = { id: string; code: string; coingecko_coin_id: string | null };

/** Patches catalog `assets` with live CoinGecko /coins/markets fields (one row per asset, overwritten each sync). */
function marketRowToAssetPatch(row: CoinGeckoMarketRow) {
  const now = new Date().toISOString();
  const displayName =
    typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : null;
  const price = row.current_price;
  const dollarValue =
    price != null && Number.isFinite(price) && price > 0 ? price : undefined;
  return {
    ...(displayName != null ? { name: displayName } : {}),
    coingecko_fetched_at: now,
    coingecko_coin_id: row.id,
    coingecko_price_usd: row.current_price,
    ...(dollarValue != null ? { dollar_value: dollarValue } : {}),
    coingecko_market_cap_usd: row.market_cap,
    coingecko_fdv_usd: row.fully_diluted_valuation,
    coingecko_total_volume_usd: row.total_volume,
    coingecko_high_24h_usd: row.high_24h,
    coingecko_low_24h_usd: row.low_24h,
    coingecko_price_change_24h_usd: row.price_change_24h,
    coingecko_price_change_24h_pct: row.price_change_percentage_24h,
    coingecko_price_change_7d_pct: row.price_change_percentage_7d_in_currency ?? null,
    coingecko_market_cap_rank: row.market_cap_rank,
    coingecko_circulating_supply: row.circulating_supply,
    coingecko_total_supply: row.total_supply,
    coingecko_max_supply: row.max_supply,
    coingecko_ath_usd: row.ath,
    coingecko_ath_change_pct: row.ath_change_percentage,
    coingecko_raw: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
  };
}

/**
 * Build CoinGecko id → asset id map for `/coins/markets` only for rows that already have
 * `catalog.assets.coingecko_coin_id`. Coin id discovery is handled by the coin-id sync, not here.
 */
export async function syncCoingeckoAssetMetricsResolvePhase(supabase: SupabaseClient): Promise<{
  idByCoingecko: Map<string, string>;
  assetsConsidered: number;
  resolvedThisRun: number;
  searchAttemptsThisRun: number;
  /** Crypto assets without `coingecko_coin_id` (skipped this run; not an error). */
  stillMissingCoingeckoId: number;
  searchFailures: string[];
}> {
  const rows = (await AssetsSelector.selectAllCryptoForMetricsSync(supabase)) as AssetRow[];
  const idByCoingecko = new Map<string, string>();
  let missingCoinId = 0;

  for (const a of rows) {
    const cid = typeof a.coingecko_coin_id === "string" ? a.coingecko_coin_id.trim() : "";
    if (cid) {
      idByCoingecko.set(cid, a.id);
    } else {
      missingCoinId += 1;
    }
  }

  return {
    idByCoingecko,
    assetsConsidered: rows.length,
    resolvedThisRun: 0,
    searchAttemptsThisRun: 0,
    stillMissingCoingeckoId: missingCoinId,
    searchFailures: [],
  };
}

/**
 * Build `coingecko_coin_id` → `asset.id` only for the given catalog asset ids (crypto rows).
 * For full-catalog metrics sync, use `syncCoingeckoAssetMetricsResolvePhase`; this helper is for scoped subsets.
 */
export async function buildCoingeckoIdMapForAssetIds(
  supabase: SupabaseClient,
  assetIds: string[],
): Promise<{
  idByCoingecko: Map<string, string>;
  stillMissingCoingeckoId: number;
}> {
  const unique = [...new Set(assetIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { idByCoingecko: new Map(), stillMissingCoingeckoId: 0 };
  }

  const assets = await AssetsSelector.selectCryptoCoinIdsByIds(supabase, unique);

  const idByCoingecko = new Map<string, string>();
  let stillMissingCoingeckoId = 0;

  for (const a of assets) {
    const cid = typeof a.coingecko_coin_id === "string" ? a.coingecko_coin_id.trim() : "";
    if (cid) {
      idByCoingecko.set(cid, a.id);
    } else {
      stillMissingCoingeckoId += 1;
    }
  }

  return { idByCoingecko, stillMissingCoingeckoId };
}

/**
 * Phase 2 (CoinGecko /coins/markets): fetch markets and PATCH catalog `assets` (live columns, no history table).
 */
export async function syncCoingeckoAssetMetricsMarketsPhase(
  supabase: SupabaseClient,
  idByCoingecko: Map<string, string>,
): Promise<{ assetsUpdated: number }> {
  const ids = [...idByCoingecko.keys()];
  if (!ids.length) {
    return { assetsUpdated: 0 };
  }

  const markets = await coingeckoFetchMarketsByIds(ids);

  const work = markets
    .map((m) => {
      const assetId = idByCoingecko.get(m.id);
      if (!assetId) return null;
      return { assetId, patch: marketRowToAssetPatch(m) };
    })
    .filter((x): x is { assetId: string; patch: ReturnType<typeof marketRowToAssetPatch> } => x != null);

  let assetsUpdated = 0;
  for (let i = 0; i < work.length; i += MARKETS_DB_CONCURRENCY) {
    const chunk = work.slice(i, i + MARKETS_DB_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ assetId, patch }) => {
        await AssetsSelector.updateById(supabase, assetId, patch as Record<string, unknown>);
      }),
    );
    assetsUpdated += chunk.length;
  }

  return { assetsUpdated };
}

/**
 * Full metrics sync (resolve map from `coingecko_coin_id`, then markets). Prefer
 * `runCoingeckoMetricsSyncWithSyncRun` from workers/UI so `sync_runs` is updated.
 */
export async function syncCoingeckoAssetMetrics(supabase: SupabaseClient): Promise<{
  assetsConsidered: number;
  resolvedThisRun: number;
  assetsUpdated: number;
  searchFailures: string[];
  stillMissingCoingeckoId: number;
  searchAttemptsThisRun: number;
  fiatDollarValuesUpdated: number;
}> {
  const p1 = await syncCoingeckoAssetMetricsResolvePhase(supabase);
  const p2 = await syncCoingeckoAssetMetricsMarketsPhase(supabase, p1.idByCoingecko);
  let fiatDollarValuesUpdated = 0;
  try {
    const f = await syncFiatAssetDollarValues(supabase);
    fiatDollarValuesUpdated = f.updated;
  } catch {
    /* soft-fail */
  }
  return {
    assetsConsidered: p1.assetsConsidered,
    resolvedThisRun: p1.resolvedThisRun,
    assetsUpdated: p2.assetsUpdated,
    searchFailures: p1.searchFailures,
    stillMissingCoingeckoId: p1.stillMissingCoingeckoId,
    searchAttemptsThisRun: p1.searchAttemptsThisRun,
    fiatDollarValuesUpdated,
  };
}
