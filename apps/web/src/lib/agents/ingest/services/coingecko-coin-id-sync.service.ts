import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutomatedProcessUserId } from "@/lib/automation-actor";
import {
  type CoinGeckoSearchCoin,
  coingeckoResolveCoinIdForAsset,
  sleep,
} from "@/lib/agents/ingest/services/coingecko-client.service";
import {
  JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID,
  TASK_TYPE_REQUIRES_MANUAL_COINGECKO_SEARCH,
} from "@/lib/tasks/constants";
import { escapeIlikeExactPattern } from "@/lib/agents/ingest/services/primary-market-by-codes-resolve.service";
import * as AssetsSelector from "@/lib/selectors/assets-selector";
import * as TasksSelector from "@/lib/selectors/tasks-selector";

function parsePositiveInt(envVal: string | undefined, fallback: number): number {
  if (envVal === undefined || envVal === "") return fallback;
  const n = Number.parseInt(envVal, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export const COINGECKO_COIN_ID_SEARCH_MAX_PER_RUN = parsePositiveInt(
  process.env.COINGECKO_COIN_ID_SEARCH_MAX_PER_RUN,
  60,
);
const SEARCH_DELAY_MS = parsePositiveInt(process.env.COINGECKO_SEARCH_DELAY_MS, 1200);

function asRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function coingeckoIdFromMetadata(metadata: unknown): string | null {
  const v = asRecord(metadata).coingecko_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isCoinIdEmpty(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

function searchCandidatesPayload(coins: CoinGeckoSearchCoin[], cap = 24): unknown[] {
  return coins.slice(0, cap).map((c) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    market_cap_rank: c.market_cap_rank ?? null,
  }));
}

export type CryptoAssetCoinIdRow = {
  id: string;
  code: string;
  name: string | null;
  metadata: unknown;
  coingecko_coin_id: string | null;
};

export type SingleAssetCoinIdSyncResult = {
  assetCode: string;
  copiedFromMetadata: 0 | 1;
  filledViaSearch: 0 | 1;
  tasksCreated: 0 | 1;
  searchAttempted: boolean;
  failures: string[];
  skippedReason?:
    | "not_found"
    | "not_crypto"
    | "already_has_coin_id"
    | "skip_task_open"
    | "no_automated_actor"
    | "duplicate_task";
};

/**
 * Crypto assets with empty `coingecko_coin_id` (caller typically runs metadata copy first).
 * Ordered by market cap descending (same spirit as exchange-close fan-out).
 */
export async function listCryptoAssetsNeedingCoinIdSearch(
  admin: SupabaseClient,
): Promise<{ rows: CryptoAssetCoinIdRow[]; error?: string }> {
  let data: Awaited<ReturnType<typeof AssetsSelector.selectAllCryptoOrderedByMcap>>;
  try {
    data = await AssetsSelector.selectAllCryptoOrderedByMcap(admin);
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }

  const rows = data.filter((r) => isCoinIdEmpty(r.coingecko_coin_id)) as CryptoAssetCoinIdRow[];
  return { rows };
}

/**
 * One catalog crypto asset by `code`: metadata `coingecko_id` first, then CoinGecko /search, then optional task.
 * Does **not** increment global caps — intended for per-asset worker and Relay jobs.
 */
export async function syncCoingeckoCoinIdForAssetByCode(
  admin: SupabaseClient,
  assetCode: string,
): Promise<SingleAssetCoinIdSyncResult> {
  const code = assetCode.trim();
  const empty: SingleAssetCoinIdSyncResult = {
    assetCode: code,
    copiedFromMetadata: 0,
    filledViaSearch: 0,
    tasksCreated: 0,
    searchAttempted: false,
    failures: [],
  };

  if (!code) {
    return { ...empty, failures: ["empty assetCode"], skippedReason: "not_found" };
  }

  let r: Awaited<ReturnType<typeof AssetsSelector.selectCryptoByCodeIlike>>;
  try {
    r = await AssetsSelector.selectCryptoByCodeIlike(admin, escapeIlikeExactPattern(code));
  } catch (e) {
    return { ...empty, failures: [e instanceof Error ? e.message : String(e)] };
  }
  if (!r) {
    return { ...empty, failures: [`no crypto asset with code ${code}`], skippedReason: "not_found" };
  }

  const row = r as CryptoAssetCoinIdRow & { kind?: string };
  if (row.kind !== "crypto") {
    return { ...empty, assetCode: String(row.code), skippedReason: "not_crypto" };
  }

  if (!isCoinIdEmpty(row.coingecko_coin_id)) {
    return {
      ...empty,
      assetCode: String(row.code),
      skippedReason: "already_has_coin_id",
    };
  }

  const mid = coingeckoIdFromMetadata(row.metadata);
  if (mid) {
    try {
      await AssetsSelector.updateCoingeckoCoinIdById(admin, row.id, mid);
    } catch (e) {
      return { ...empty, assetCode: String(row.code), failures: [e instanceof Error ? e.message : String(e)] };
    }
    return {
      assetCode: String(row.code),
      copiedFromMetadata: 1,
      filledViaSearch: 0,
      tasksCreated: 0,
      searchAttempted: false,
      failures: [],
    };
  }

  let skipRow: Awaited<ReturnType<typeof TasksSelector.selectOpenIdForRelatedJob>>;
  try {
    skipRow = await TasksSelector.selectOpenIdForRelatedJob(admin, {
      relatedSchema: "catalog",
      relatedTable: "assets",
      relatedId: row.id,
      jobIdentifier: JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID,
    });
  } catch (e) {
    return {
      ...empty,
      assetCode: String(row.code),
      failures: [`skip-task query: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  if (skipRow?.id) {
    return { ...empty, assetCode: String(row.code), skippedReason: "skip_task_open" };
  }

  const automatedUserId = await getAutomatedProcessUserId(admin);
  if (!automatedUserId) {
    return {
      ...empty,
      assetCode: String(row.code),
      failures: ["automated_process user id not found (apply automation_actor migration)."],
      skippedReason: "no_automated_actor",
    };
  }

  let searchAttempted = false;
  try {
    searchAttempted = true;
    const { coinId, coins } = await coingeckoResolveCoinIdForAsset(
      String(row.code),
      (row.name as string | null | undefined) ?? null,
    );
    await sleep(SEARCH_DELAY_MS);

    if (coinId) {
      const meta = { ...asRecord(row.metadata), coingecko_id: coinId };
      try {
        await AssetsSelector.updateCoingeckoCoinIdAndMetadataById(admin, row.id, {
          coingecko_coin_id: coinId,
          metadata: meta,
        });
      } catch (e) {
        return {
          assetCode: String(row.code),
          copiedFromMetadata: 0,
          filledViaSearch: 0,
          tasksCreated: 0,
          searchAttempted: true,
          failures: [e instanceof Error ? e.message : String(e)],
        };
      }
      return {
        assetCode: String(row.code),
        copiedFromMetadata: 0,
        filledViaSearch: 1,
        tasksCreated: 0,
        searchAttempted: true,
        failures: [],
      };
    }

    let existingOpen: Awaited<ReturnType<typeof TasksSelector.selectOpenIdForRelatedJob>> = null;
    try {
      existingOpen = await TasksSelector.selectOpenIdForRelatedJob(admin, {
        relatedSchema: "catalog",
        relatedTable: "assets",
        relatedId: row.id,
        jobIdentifier: JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID,
        taskType: TASK_TYPE_REQUIRES_MANUAL_COINGECKO_SEARCH,
      });
    } catch {
      /* preserve original soft-fail behavior (data only, no error returned) */
    }

    if (existingOpen?.id) {
      return {
        assetCode: String(row.code),
        copiedFromMetadata: 0,
        filledViaSearch: 0,
        tasksCreated: 0,
        searchAttempted: true,
        failures: [],
        skippedReason: "duplicate_task",
      };
    }

    const title = `Set CoinGecko coin id for ${String(row.code)}`;
    const description =
      coins.length === 0
        ? "CoinGecko /search returned no coins for this ticker. Set `coingecko_coin_id` manually or add metadata.coingecko_id."
        : "CoinGecko /search did not resolve to a unique coin id for this asset (ambiguous symbol or name mismatch). Pick the correct id manually.";

    const insErr = await TasksSelector.insertOne(admin, {
      user_id: automatedUserId,
      title,
      description,
      status: "open",
      related_schema: "catalog",
      related_table: "assets",
      related_id: row.id,
      parent_task_id: null,
      task_type: TASK_TYPE_REQUIRES_MANUAL_COINGECKO_SEARCH,
      job_identifier: JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID,
      metadata: {
        asset_code: row.code,
        asset_name: row.name ?? null,
        search_query: row.code,
        symbol_matches: searchCandidatesPayload(coins),
      },
    });

    if (insErr) {
      if (insErr.code === "23505") {
        return {
          assetCode: String(row.code),
          copiedFromMetadata: 0,
          filledViaSearch: 0,
          tasksCreated: 0,
          searchAttempted: true,
          failures: [],
          skippedReason: "duplicate_task",
        };
      }
      return {
        assetCode: String(row.code),
        copiedFromMetadata: 0,
        filledViaSearch: 0,
        tasksCreated: 0,
        searchAttempted: true,
        failures: [`task insert: ${insErr.message}`],
      };
    }

    return {
      assetCode: String(row.code),
      copiedFromMetadata: 0,
      filledViaSearch: 0,
      tasksCreated: 1,
      searchAttempted: true,
      failures: [],
    };
  } catch (e) {
    return {
      assetCode: String(row.code),
      copiedFromMetadata: 0,
      filledViaSearch: 0,
      tasksCreated: 0,
      searchAttempted,
      failures: [e instanceof Error ? e.message : "search error"],
    };
  }
}

export type SyncCoingeckoCoinIdResult = {
  copiedFromMetadata: number;
  filledViaSearch: number;
  searchAttempts: number;
  stillMissingCoinId: number;
  tasksCreated: number;
  failures: string[];
};

/**
 * Ensures `assets.coingecko_coin_id` is set: first copies `metadata.coingecko_id`, then runs CoinGecko /search
 * for remaining crypto rows (capped per invocation). Ambiguous search results create a **task** instead of guessing.
 */
export async function syncCoingeckoCoinIds(admin: SupabaseClient): Promise<SyncCoingeckoCoinIdResult> {
  const failures: string[] = [];
  let tasksCreated = 0;

  const list = await AssetsSelector.selectAllCryptoCoinIds(admin);
  let copiedFromMetadata = 0;

  for (const r of list) {
    if (!isCoinIdEmpty(r.coingecko_coin_id as string | null)) continue;
    const mid = coingeckoIdFromMetadata(r.metadata);
    if (!mid) continue;
    try {
      await AssetsSelector.updateCoingeckoCoinIdById(admin, r.id, mid);
      copiedFromMetadata += 1;
    } catch (e) {
      failures.push(`${r.code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { rows: needRows, error: listErr } = await listCryptoAssetsNeedingCoinIdSearch(admin);
  if (listErr) {
    failures.push(`list assets: ${listErr}`);
  }

  let searchAttempts = 0;
  let filledViaSearch = 0;

  const automatedUserId = await getAutomatedProcessUserId(admin);
  if (!automatedUserId && needRows.length > 0) {
    failures.push("CoinGecko search skipped: automated_process user id not found (apply automation_actor migration).");
  }

  for (const r of needRows) {
    if (searchAttempts >= COINGECKO_COIN_ID_SEARCH_MAX_PER_RUN) break;

    let skipRow: Awaited<ReturnType<typeof TasksSelector.selectOpenIdForRelatedJob>> = null;
    try {
      skipRow = await TasksSelector.selectOpenIdForRelatedJob(admin, {
        relatedSchema: "catalog",
        relatedTable: "assets",
        relatedId: r.id,
        jobIdentifier: JOB_IDENTIFIER_SKIP_AUTO_COINGECKO_COIN_ID,
      });
    } catch (e) {
      failures.push(`${r.code}: skip-task query: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (skipRow?.id) {
      continue;
    }

    if (!automatedUserId) {
      continue;
    }

    const one = await syncCoingeckoCoinIdForAssetByCode(admin, String(r.code));
    if (one.searchAttempted) {
      searchAttempts += 1;
    }
    if (one.failures.length) {
      failures.push(...one.failures.map((f) => `${one.assetCode}: ${f}`));
    }
    filledViaSearch += one.filledViaSearch;
    tasksCreated += one.tasksCreated;
    if (one.copiedFromMetadata) {
      copiedFromMetadata += one.copiedFromMetadata;
    }
  }

  let finalRows: Awaited<ReturnType<typeof AssetsSelector.selectAllCryptoCoinIdValues>> = [];
  try {
    finalRows = await AssetsSelector.selectAllCryptoCoinIdValues(admin);
  } catch {
    /* preserve original soft-fail behavior — final count is non-critical */
  }
  const stillMissingCoinId = finalRows.filter((a) =>
    isCoinIdEmpty(a.coingecko_coin_id as string | null),
  ).length;

  return {
    copiedFromMetadata,
    filledViaSearch,
    searchAttempts,
    stillMissingCoinId,
    tasksCreated,
    failures,
  };
}
