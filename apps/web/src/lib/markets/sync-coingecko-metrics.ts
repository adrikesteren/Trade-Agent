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

function marketRowToInsert(assetId: string, row: CoinGeckoMarketRow) {
  return {
    asset_id: assetId,
    coingecko_id: row.id,
    price_usd: row.current_price,
    market_cap_usd: row.market_cap,
    fully_diluted_valuation_usd: row.fully_diluted_valuation,
    total_volume_usd: row.total_volume,
    high_24h_usd: row.high_24h,
    low_24h_usd: row.low_24h,
    price_change_24h_usd: row.price_change_24h,
    price_change_24h_pct: row.price_change_percentage_24h,
    price_change_7d_pct: row.price_change_percentage_7d_in_currency ?? null,
    market_cap_rank: row.market_cap_rank,
    circulating_supply: row.circulating_supply,
    total_supply: row.total_supply,
    max_supply: row.max_supply,
    ath_usd: row.ath,
    ath_change_pct: row.ath_change_percentage,
    raw: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
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
          const { error: upErr } = await supabase.from("assets").update({ metadata: meta }).eq("id", a.id);
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
 * Phase 2 (callout: CoinGecko /coins/markets + DB): fetch markets for resolved ids and append metrics rows.
 */
export async function syncCoingeckoAssetMetricsMarketsPhase(
  supabase: SupabaseClient,
  idByCoingecko: Map<string, string>,
): Promise<{ snapshotsInserted: number }> {
  const ids = [...idByCoingecko.keys()];
  if (!ids.length) {
    return { snapshotsInserted: 0 };
  }

  const markets = await coingeckoFetchMarketsByIds(ids);
  const inserts = [];
  for (const m of markets) {
    const assetId = idByCoingecko.get(m.id);
    if (!assetId) continue;
    inserts.push(marketRowToInsert(assetId, m));
  }

  if (inserts.length) {
    const { error: insErr } = await supabase.from("asset_coingecko_metrics").insert(inserts);
    if (insErr) {
      throw new Error(insErr.message);
    }
  }

  return { snapshotsInserted: inserts.length };
}

/**
 * Full metrics sync (both phases). Prefer `runCoingeckoMetricsSyncWithSyncRun` from workers/UI so `sync_runs` is updated.
 */
export async function syncCoingeckoAssetMetrics(supabase: SupabaseClient): Promise<{
  assetsConsidered: number;
  resolvedThisRun: number;
  snapshotsInserted: number;
  searchFailures: string[];
  stillMissingCoingeckoId: number;
  searchAttemptsThisRun: number;
}> {
  const p1 = await syncCoingeckoAssetMetricsResolvePhase(supabase);
  const p2 = await syncCoingeckoAssetMetricsMarketsPhase(supabase, p1.idByCoingecko);
  return {
    assetsConsidered: p1.assetsConsidered,
    resolvedThisRun: p1.resolvedThisRun,
    snapshotsInserted: p2.snapshotsInserted,
    searchFailures: p1.searchFailures,
    stillMissingCoingeckoId: p1.stillMissingCoingeckoId,
    searchAttemptsThisRun: p1.searchAttemptsThisRun,
  };
}
