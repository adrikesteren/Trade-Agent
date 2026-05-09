import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coingeckoFetchMarketsByIds,
  coingeckoSearchCoinId,
  sleep,
  type CoinGeckoMarketRow,
} from "@/lib/markets/coingecko-client";

function parsePositiveInt(envVal: string | undefined, fallback: number): number {
  if (envVal === undefined || envVal === "") return fallback;
  const n = Number.parseInt(envVal, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * Max CoinGecko /search calls in one HTTP invocation (serverless time limit).
 * The sync always targets the full crypto catalog; QStash chains until everyone has `coingecko_id` or max depth.
 */
const MAX_SEARCH_CALLS_PER_JOB = parsePositiveInt(
  process.env.COINGECKO_MAX_SEARCH_CALLS_PER_JOB ?? process.env.COINGECKO_MAX_SEARCH_ATTEMPTS_PER_RUN,
  200,
);

const SEARCH_DELAY_MS = parsePositiveInt(process.env.COINGECKO_SEARCH_DELAY_MS, 1200);

type AssetRow = { id: string; code: string; metadata: unknown };

function asRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function getCoingeckoId(meta: unknown): string | null {
  const v = asRecord(meta).coingecko_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Patches catalog `assets` with live CoinGecko /coins/markets fields (one row per asset, overwritten each sync). */
function marketRowToAssetPatch(row: CoinGeckoMarketRow) {
  const now = new Date().toISOString();
  return {
    coingecko_fetched_at: now,
    coingecko_coin_id: row.id,
    coingecko_price_usd: row.current_price,
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
 * Phase 1 (callout: CoinGecko /search + DB): for every crypto asset missing `metadata.coingecko_id`,
 * call `/search` (up to MAX_SEARCH_CALLS_PER_JOB per invocation — then QStash continues the same sync run).
 */
export async function syncCoingeckoAssetMetricsResolvePhase(supabase: SupabaseClient): Promise<{
  idByCoingecko: Map<string, string>;
  assetsConsidered: number;
  resolvedThisRun: number;
  searchAttemptsThisRun: number;
  stillMissingCoingeckoId: number;
  searchFailures: string[];
}> {
  const searchFailures: string[] = [];
  let resolvedThisRun = 0;
  let searchAttemptsThisRun = 0;

  const { data: assets, error: selErr } = await supabase
    .schema("catalog")
    .from("assets")
    .select("id, code, metadata")
    .eq("kind", "crypto")
    .order("code", { ascending: true });

  if (selErr) {
    throw new Error(selErr.message);
  }

  const rows = (assets ?? []) as AssetRow[];
  const idByCoingecko = new Map<string, string>();

  for (const a of rows) {
    let cgId = getCoingeckoId(a.metadata);
    const canTrySearch = !cgId && searchAttemptsThisRun < MAX_SEARCH_CALLS_PER_JOB;
    if (canTrySearch) {
      searchAttemptsThisRun += 1;
      try {
        const found = await coingeckoSearchCoinId(a.code);
        await sleep(SEARCH_DELAY_MS);
        if (found) {
          const meta = { ...asRecord(a.metadata), coingecko_id: found };
          const { error: upErr } = await supabase
            .schema("catalog")
            .from("assets")
            .update({ metadata: meta })
            .eq("id", a.id);
          if (upErr) {
            searchFailures.push(`${a.code}: ${upErr.message}`);
          } else {
            cgId = found;
            a.metadata = meta;
            resolvedThisRun += 1;
          }
        } else {
          searchFailures.push(`${a.code}: no CoinGecko match`);
        }
      } catch (e) {
        searchFailures.push(`${a.code}: ${e instanceof Error ? e.message : "search error"}`);
      }
    }
    if (cgId) {
      idByCoingecko.set(cgId, a.id);
    }
  }

  const stillMissingCoingeckoId = rows.filter((a) => !getCoingeckoId(a.metadata)).length;

  return {
    idByCoingecko,
    assetsConsidered: rows.length,
    resolvedThisRun,
    searchAttemptsThisRun,
    stillMissingCoingeckoId,
    searchFailures,
  };
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
  let assetsUpdated = 0;
  for (const m of markets) {
    const assetId = idByCoingecko.get(m.id);
    if (!assetId) continue;
    const patch = marketRowToAssetPatch(m);
    const { error: upErr } = await supabase.schema("catalog").from("assets").update(patch).eq("id", assetId);
    if (upErr) {
      throw new Error(upErr.message);
    }
    assetsUpdated += 1;
  }

  return { assetsUpdated };
}

/**
 * Full metrics sync (both phases). Prefer `runCoingeckoMetricsSyncWithSyncRun` from workers/UI so `sync_runs` is updated.
 */
export async function syncCoingeckoAssetMetrics(supabase: SupabaseClient): Promise<{
  assetsConsidered: number;
  resolvedThisRun: number;
  assetsUpdated: number;
  searchFailures: string[];
  stillMissingCoingeckoId: number;
  searchAttemptsThisRun: number;
}> {
  const p1 = await syncCoingeckoAssetMetricsResolvePhase(supabase);
  const p2 = await syncCoingeckoAssetMetricsMarketsPhase(supabase, p1.idByCoingecko);
  return {
    assetsConsidered: p1.assetsConsidered,
    resolvedThisRun: p1.resolvedThisRun,
    assetsUpdated: p2.assetsUpdated,
    searchFailures: p1.searchFailures,
    stillMissingCoingeckoId: p1.stillMissingCoingeckoId,
    searchAttemptsThisRun: p1.searchAttemptsThisRun,
  };
}
