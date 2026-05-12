"use server";

import { revalidatePath } from "next/cache";

import { runCoingeckoCoinIdSyncWithSyncRun } from "@/lib/markets/run-coingecko-coin-id-sync-with-sync-run";
import { runCoingeckoMetricsSyncWithSyncRun } from "@/lib/markets/run-coingecko-sync-with-sync-run";
import { upsertCatalogCryptoAssetsFromBitvavo } from "@/lib/markets/sync-bitvavo-asset-data";
import { upsertBitvavoMarketsForExistingAssets } from "@/lib/markets/sync-bitvavo-markets";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RetrieveBitvavoCatalogAssetsResult =
  | {
      ok: true;
      fetchedFromApi: number;
      assetsUpserted: number;
      inserted: number;
      updated: number;
    }
  | { ok: false; error: string };

export async function retrieveBitvavoCatalogAssets(): Promise<RetrieveBitvavoCatalogAssetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await upsertCatalogCryptoAssetsFromBitvavo(admin);
    revalidatePath("/overview");
    revalidatePath("/assets");
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type SyncCoingeckoCoinIdsFromOverviewResult =
  | {
      ok: true;
      copiedFromMetadata: number;
      filledViaSearch: number;
      searchAttempts: number;
      stillMissingCoinId: number;
      failureCount: number;
      syncRunId: string | null;
    }
  | { ok: false; error: string };

/** Same job as `POST /api/markets/coingecko/coin-id-sync?source=manual`: fills `coingecko_coin_id` where empty. */
export async function syncCoingeckoCoinIdsFromOverview(): Promise<SyncCoingeckoCoinIdsFromOverviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await runCoingeckoCoinIdSyncWithSyncRun(admin, "manual");
    revalidatePath("/overview");
    revalidatePath("/assets");
    revalidatePath("/sync-runs");
    return {
      ok: true,
      copiedFromMetadata: r.copiedFromMetadata,
      filledViaSearch: r.filledViaSearch,
      searchAttempts: r.searchAttempts,
      stillMissingCoinId: r.stillMissingCoinId,
      failureCount: r.failures.length,
      syncRunId: r.syncRunId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type SyncCoingeckoMetricsFromOverviewResult =
  | {
      ok: true;
      assetsConsidered: number;
      resolvedThisRun: number;
      assetsUpdated: number;
      stillMissingCoingeckoId: number;
      searchAttemptsThisRun: number;
      searchFailureCount: number;
      syncRunId: string | null;
    }
  | { ok: false; error: string };

/** Same job as `POST /api/markets/coingecko/metrics-sync?source=manual`: live USD metrics on `catalog.assets`. */
export async function syncCoingeckoMetricsFromOverview(): Promise<SyncCoingeckoMetricsFromOverviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await runCoingeckoMetricsSyncWithSyncRun(admin, "manual", {});
    revalidatePath("/overview");
    revalidatePath("/assets");
    revalidatePath("/markets");
    revalidatePath("/sync-runs");
    return {
      ok: true,
      assetsConsidered: r.assetsConsidered,
      resolvedThisRun: r.resolvedThisRun,
      assetsUpdated: r.assetsUpdated,
      stillMissingCoingeckoId: r.stillMissingCoingeckoId,
      searchAttemptsThisRun: r.searchAttemptsThisRun,
      searchFailureCount: r.searchFailures.length,
      syncRunId: r.syncRunId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}

export type RetrieveBitvavoMarketsResult =
  | {
      ok: true;
      fetchedFromApi: number;
      tradingMarkets: number;
      marketsUpserted: number;
      skippedMissingAsset: number;
    }
  | { ok: false; error: string };

/** Upserts Bitvavo markets only when `asset.code` matches the pair base (no new assets). */
export async function retrieveBitvavoMarketsLinkedToAssets(): Promise<RetrieveBitvavoMarketsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  try {
    const admin = createServiceRoleClient();
    const r = await upsertBitvavoMarketsForExistingAssets(admin, { quoteFilter: null });
    revalidatePath("/overview");
    revalidatePath("/markets");
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error.";
    return { ok: false, error: msg };
  }
}
